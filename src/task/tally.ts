import fs from 'fs'
import path from 'path'
import { groth16 } from 'snarkjs'
import { GasPrice, calculateFee } from '@cosmjs/stargate'

import { adaptToUncompressed } from '../vota/adapt'
import { fetchAllVotesLogs, fetchRound } from '../vota/indexer'
import { getContractSignerClient } from '../lib/client/utils'
import { maciParamsFromCircuitPower, ProofData, TaskAct } from '../types'
// import { log } from '../log'
import {
  info,
  error as logError,
  warn,
  debug,
  startOperation,
  endOperation,
  setCurrentRound,
} from '../logger'
import { recordTaskSuccess, recordRoundCompletion } from '../metrics'
import { recordTaskStart, recordTaskEnd } from '../metrics'

import { genMaciInputs } from '../operator/genInputs'

const zkeyPath = './zkey/'

const inputsPath = path.join(process.env.WORK_PATH, 'inputs')
if (!fs.existsSync(inputsPath)) {
  fs.mkdirSync(inputsPath)
}

interface AllData {
  result: string[]
  salt: string
  msg: ProofData[]
  tally: ProofData[]
}

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })

export const tally: TaskAct = async (_, { id }: { id: string }) => {
  // 设置当前处理的 round ID
  setCurrentRound(id)

  // 记录操作开始
  startOperation('tally', 'TALLY-TASK')

  // Metrics: Record the task start
  recordTaskStart('tally', id);

  try {
    
    const maciRound = await fetchRound(id)
    info(`Current round period:' ${maciRound.period}`, 'TALLY-TASK')

    info('Start round Tally ', 'TALLY-TASK')
    const now = Date.now()

    if (
      !['Pending', 'Voting', 'Processing', 'Tallying'].includes(
        maciRound.period,
      ) &&
      now < Number(maciRound.votingEnd) / 1e6
    ) {
      logError('error status: not end', 'TALLY-TASK')
      return { error: { msg: 'error status: not end' } }
    }

    /**
     * 主要和 vota 交互的对象
     */
    const maciClient = await getContractSignerClient(id)

    /**
     * 先结束当前 round
     */
    if (['Pending', 'Voting'].includes(maciRound.period)) {
      const preiod = await maciClient.getPeriod()
      if (['pending', 'voting'].includes(preiod.status)) {
        const spGasPrice = GasPrice.fromString('100000000000peaka')
        const spGfee = calculateFee(20000000, spGasPrice)
        const startProcessRes = await maciClient.startProcessPeriod(spGfee)

        await sleep(6000)

        debug(`startProcessRes: ${startProcessRes}`, 'TALLY-TASK')
      }
    }

    const params = maciParamsFromCircuitPower(maciRound.circuitPower)

    /**
     * 尝试查看本地是否已经生成了所有证明信息
     *
     * 如果没有，则下载合约记录并且生成
     */
    let allData: AllData | undefined
    const saveFile = path.join(inputsPath, id + '.json')
    if (fs.existsSync(saveFile)) {
      /**
       * 现在基于确定性的 proof，即使中途失败也可以重新生成所有证明，不需要读取缓存
       */
      // const file = fs.readFileSync(saveFile).toString()
      // try {
      //   allData = JSON.parse(file)
      // } catch {}
    }

    const dc = await maciClient.getProcessedDMsgCount()

    const mc = await maciClient.getProcessedMsgCount()
    const uc = await maciClient.getProcessedUserCount()

    /**
     * 如果线上还没有开始处理交易，则总是重新生成证明
     */
    if (Number(mc) === 0 && Number(uc) === 0) {
      if (allData) {
        debug('Prove again...', 'TALLY-TASK')
      }
      allData = undefined
    }

    if (!allData) {
      const logs = await fetchAllVotesLogs(id)

      info(
        `The current round has ${logs.signup.length} signups, ${logs.msg.length} messages, ${logs.dmsg.length} dmessages`,
        'TALLY-TASK',
      )

      const maxVoteOptions = await maciClient.maxVoteOptions()
      const res = genMaciInputs(
        {
          ...params,
          coordPriKey: BigInt(process.env.COORDINATOR_PRI_KEY),
          maxVoteOptions: Number(maxVoteOptions),
          isQuadraticCost: !!Number(maciRound.circuitType),
        },
        {
          states: logs.signup.map((s) => ({
            idx: s.stateIdx,
            balance: BigInt(s.balance),
            pubkey: (s.pubKey.match(/\d+/g) || []).map((n: string) =>
              BigInt(n),
            ) as [bigint, bigint],
            c: [BigInt(s.d0), BigInt(s.d1), BigInt(s.d2), BigInt(s.d3)],
          })),
          messages: logs.msg.map((m) => ({
            idx: m.msgChainLength,
            msg: (m.message.match(/(?<=\()\d+(?=\))/g) || []).map((s) =>
              BigInt(s),
            ),
            pubkey: (m.encPubKey.match(/\d+/g) || []).map((n: string) =>
              BigInt(n),
            ) as [bigint, bigint],
          })),
          dmessages: logs.dmsg.map((m) => ({
            idx: m.dmsgChainLength,
            numSignUps: m.numSignUps,
            msg: (m.message.match(/(?<=\()\d+(?=\))/g) || []).map((s) =>
              BigInt(s),
            ),
            pubkey: (m.encPubKey.match(/\d+/g) || []).map((n: string) =>
              BigInt(n),
            ) as [bigint, bigint],
          })),
        },
        Number(dc),
      )

      const lastTallyInput = res.tallyInputs[res.tallyInputs.length - 1]
      const result = res.result.map((i) => i.toString())
      const salt = lastTallyInput
        ? lastTallyInput.newResultsRootSalt.toString()
        : '0'

      const msg: ProofData[] = []
      info('Start to generate proof for msgs', 'TALLY-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      for (let i = 0; i < res.msgInputs.length; i++) {
        const input = res.msgInputs[i]

        const { proof } = await groth16.fullProve(
          input,
          zkeyPath + maciRound.circuitPower + '_v2/msg.wasm',
          zkeyPath + maciRound.circuitPower + '_v2/msg.zkey',
        )

        const proofHex = await adaptToUncompressed(proof)
        const commitment = input.newStateCommitment.toString()
        msg.push({ proofHex, commitment })
        debug(`Generated proof with msg #${i}`, 'TALLY-TASK', {
          proofHex,
          commitment,
        })
      }

      const tally: ProofData[] = []
      info('Start to generate proof for tally', 'TALLY-TASK',{
          period: maciRound.period,
          circuitPower: maciRound.circuitPower,
      })
      for (let i = 0; i < res.tallyInputs.length; i++) {
        const input = res.tallyInputs[i]

        const { proof } = await groth16.fullProve(
          input,
          zkeyPath + maciRound.circuitPower + '_v2/tally.wasm',
          zkeyPath + maciRound.circuitPower + '_v2/tally.zkey',
        )

        const proofHex = await adaptToUncompressed(proof)
        const commitment = input.newTallyCommitment.toString()
        tally.push({ proofHex, commitment })
        debug(`Generated proof with tally #${i}`, 'TALLY-TASK', {
          proofHex,
          commitment,
        })
      }

      allData = {
        result,
        salt,
        msg,
        tally,
      }

      fs.writeFileSync(saveFile, JSON.stringify(allData))
    }

    let mi = Math.ceil(Number(mc) / params.batchSize)
    info(`Prepare to process msg`, 'TALLY-TASK')
    if (mi < allData.msg.length) {
      for (; mi < allData.msg.length; mi++) {
        const { proofHex, commitment } = allData.msg[mi]
        const res = await maciClient.processMessage({
          groth16Proof: proofHex,
          newStateCommitment: commitment,
        })
        debug(`processedMessage #${mi} 🛠️🛠️🛠️🛠️ with tx hash successfully ✅: ${res.transactionHash}`, 'TALLY-TASK')
      }

      await maciClient.stopProcessingPeriod()
    } else {
      const period = await maciClient.getPeriod()
      if (period.status === 'processing') {
        await maciClient.stopProcessingPeriod()

        await sleep(6000)
      }
    }

    let ui = Math.ceil(Number(uc) / 5 ** params.intStateTreeDepth)
    info(`Prepare to process tally`, 'TALLY-TASK')
    if (ui < allData.tally.length) {
      for (; ui < allData.tally.length; ui++) {
        const { proofHex, commitment } = allData.tally[ui]
        const res = await maciClient.processTally({
          groth16Proof: proofHex,
          newTallyCommitment: commitment,
        })
        debug(`processedTally #${ui} 🛠️🛠️🛠️🛠️ with tx hash successfully ✅: ${res.transactionHash}`, 'TALLY-TASK')
      }

      try {
        info('Executing stopTallying and claim as batch operation...', 'TALLY-TASK')
        const batchResult = await maciClient.stopTallyingAndClaim(
          {
            results: allData.result,
            salt: allData.salt,
          },
          'auto',
        )
        info(
          `Batch operation completed successfully✅, tx hash: ${batchResult.transactionHash}`,
          'TALLY-TASK',
        )
      } catch (error) {
        warn(`Error during batch operation: ${error}`, 'TALLY-TASK')

        info('Trying operations separately...', 'TALLY-TASK')
        try {
          await maciClient.stopTallyingPeriod({
            results: allData.result,
            salt: allData.salt,
          })

          info('Executing claim operation.....', 'TALLY-TASK')
          const claimResult = await maciClient.claim('auto')
          info(
            `Claim operation completed successfully✅, tx hash: ${claimResult.transactionHash}`,
            'TALLY-TASK',
          )
        } catch (fallbackError) {
          console.error('Error during fallback operations:', fallbackError)
        }
      }
    } else {
      const period = await maciClient.getPeriod()
      if (period.status === 'tallying') {
        try {
          info('Executing stopTallying and claim as batch operation...', 'TALLY-TASK')
          const batchResult = await maciClient.stopTallyingAndClaim(
            {
              results: allData.result,
              salt: allData.salt,
            },
            'auto',
          )
          info(
            `Batch operation completed successfully✅, tx hash: ${batchResult.transactionHash}`,
            'TALLY-TASK',
          )
        } catch (error) {
          warn(`Error during batch operation: ${error}`, 'TALLY-TASK')

          info('Trying operations separately...', 'TALLY-TASK')
          try {
            await maciClient.stopTallyingPeriod({
              results: allData.result,
              salt: allData.salt,
            })

            info('Executing claim operation.....', 'TALLY-TASK')
            const claimResult = await maciClient.claim('auto')
            info(
              `Claim operation completed successfully✅, tx hash: ${claimResult.transactionHash}`,
              'TALLY-TASK',
            )
          } catch (fallbackError) {
            logError(`Error during fallback operations: ${fallbackError}`, 'TALLY-TASK')
          }
        }
      }
    }

    info(`Completed round Tally for ${id}`, 'TALLY-TASK')
    endOperation('tally', true, 'TALLY-TASK')

    // Metrics: record the task success
    recordTaskSuccess('tally')
    // Metrics: record the round completion
    recordRoundCompletion(id)
    // 记录任务结束
    recordTaskEnd('tally', id);
    return {}
  } catch (err) {
    logError(err, 'TALLY-TASK', { operation: 'tally' })
    endOperation('tally', false, 'TALLY-TASK')
    // 记录任务失败和结束
    recordTaskEnd('tally', id);
    throw err
  }
}
