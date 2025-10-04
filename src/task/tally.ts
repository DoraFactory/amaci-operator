import fs from 'fs'
import path from 'path'
// proof generation is offloaded to worker pool
import { GasPrice, calculateFee } from '@cosmjs/stargate'

import { fetchAllVotesLogs, fetchRound } from '../vota/indexer'
import { getContractSignerClient, withRetry } from '../lib/client/utils'
import { maciParamsFromCircuitPower, ProofData, TaskAct } from '../types'
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
import { recordProverPhaseDuration } from '../metrics'
import { recordTaskStart, recordTaskEnd } from '../metrics'
import {
  NetworkError,
  ContractError,
  TallyError,
  categorizeError,
} from '../error'

import { genMaciInputs } from '../operator/genInputs'
import { proveMany } from '../prover/pool'
import { loadProofCache, saveProofCache } from '../storage/proofCache'

const zkeyPath = './zkey/'

const inputsPath = path.join(process.env.WORK_PATH || './work', 'inputs')
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
  // logger: set the current round ID
  setCurrentRound(id)

  // logger: start the operation
  const operationContext = startOperation('tally', 'TALLY-TASK')

  // Metrics: Record the task start
  recordTaskStart('tally', id)

  try {
    const maciRound = await withRetry(() => fetchRound(id), {
      context: 'INDEXER-FETCH-ROUND',
      maxRetries: 3,
    })
    info(`Current round period:' ${maciRound.period}`, 'TALLY-TASK')

    info('Start round Tally ', 'TALLY-TASK')
    const now = Date.now()

    if (
      !['Pending', 'Voting', 'Processing', 'Tallying'].includes(
        maciRound.period,
      ) &&
      now < Number(maciRound.votingEnd) / 1e6
    ) {
      logError('Round not in proper state for tally', 'TALLY-TASK')
      endOperation('tally', false, operationContext)
      return {
        error: {
          msg: 'error_status: not end',
          details: 'Round not in proper state',
        },
      }
    }

    // Get the maci contract signer client
    const maciClient = await getContractSignerClient(id)

    // If the round is pending or voting, start the process period
    if (['Pending', 'Voting'].includes(maciRound.period)) {
      const period = await withRetry(() => maciClient.getPeriod(), {
        context: 'RPC-GET-PERIOD',
        maxRetries: 5, // 增加重试次数
      })

      if (['pending', 'voting'].includes(period.status)) {
        const startProcessRes = await withRetry(
          () => maciClient.startProcessPeriod(1.5),
          {
            context: 'RPC-START-PROCESS-PERIOD',
            maxRetries: 5,
          },
        )

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
    const cache = loadProofCache(id)

    const dc = await withRetry(() => maciClient.getProcessedDMsgCount(), {
      context: 'RPC-GET-DMSG-COUNT',
      maxRetries: 3,
    })

    const mc = await withRetry(() => maciClient.getProcessedMsgCount(), {
      context: 'RPC-GET-MSG-COUNT',
      maxRetries: 3,
    })

    const uc = await withRetry(() => maciClient.getProcessedUserCount(), {
      context: 'RPC-GET-USER-COUNT',
      maxRetries: 3,
    })

    /**
     * 如果线上还没有开始处理交易，则总是重新生成证明
     */
    if (Number(mc) === 0 && Number(uc) === 0 && !cache) {
      if (allData) {
        debug('Prove again...', 'TALLY-TASK')
      }
      allData = undefined
    }

    if (!allData) {
      const logs = await withRetry(() => fetchAllVotesLogs(id), {
        context: 'INDEXER-FETCH-VOTES-LOGS',
        maxRetries: 3,
      })

      info(
        `The current round has ${logs.signup.length} signups, ${logs.msg.length} messages, ${logs.dmsg.length} dmessages`,
        'TALLY-TASK',
      )

      const maxVoteOptions = await withRetry(
        () => maciClient.maxVoteOptions(),
        {
          context: 'RPC-GET-MAX-VOTE-OPTIONS',
          maxRetries: 3,
        },
      )

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
      const tally: ProofData[] = []

      // Sequential phases; each internally parallel via worker pool
      info('Start to generate proof for msgs', 'TALLY-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      const msgWasm = zkeyPath + maciRound.circuitPower + '_v3/msg.wasm'
      const msgZkey = zkeyPath + maciRound.circuitPower + '_v3/msg.zkey'
      const cachedMsg = cache?.msg?.proofs || []
      let startMsg = 0
      for (let i = 0; i < Math.min(cachedMsg.length, res.msgInputs.length); i++) {
        const expected = res.msgInputs[i].newStateCommitment.toString()
        if (cachedMsg[i]?.commitment === expected) {
          msg.push(cachedMsg[i])
          startMsg = i + 1
        } else {
          break
        }
      }
      const msgStart = Date.now()
      const chunk = Math.max(
        1,
        Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          Number(process.env.PROVER_CONCURRENCY || 2),
      )
      while (startMsg < res.msgInputs.length) {
        const end = Math.min(startMsg + chunk, res.msgInputs.length)
        const slice = res.msgInputs.slice(startMsg, end)
        const proofs = await proveMany(slice, msgWasm, msgZkey, { phase: 'msg' })
        for (let i = 0; i < slice.length; i++) {
          const input = slice[i]
          const proofHex = proofs[i]
          const commitment = input.newStateCommitment.toString()
          msg.push({ proofHex, commitment })
          debug(`Generated proof with msg #${startMsg + i}`, 'TALLY-TASK', {
            proofHex,
            commitment,
          })
        }
        saveProofCache(id, {
          circuitPower: maciRound.circuitPower,
          msg: { proofs: msg },
          result,
          salt,
        })
        startMsg = end
      }
      recordProverPhaseDuration(id, 'msg', (Date.now() - msgStart) / 1000)

      info('Start to generate proof for tally', 'TALLY-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      const tallyWasm = zkeyPath + maciRound.circuitPower + '_v3/tally.wasm'
      const tallyZkey = zkeyPath + maciRound.circuitPower + '_v3/tally.zkey'
      const cachedTally = cache?.tally?.proofs || []
      let startTally = 0
      for (let i = 0; i < Math.min(cachedTally.length, res.tallyInputs.length); i++) {
        const expected = res.tallyInputs[i].newTallyCommitment.toString()
        if (cachedTally[i]?.commitment === expected) {
          tally.push(cachedTally[i])
          startTally = i + 1
        } else {
          break
        }
      }
      const tallyStart = Date.now()
      while (startTally < res.tallyInputs.length) {
        const end = Math.min(startTally + chunk, res.tallyInputs.length)
        const slice = res.tallyInputs.slice(startTally, end)
        const proofs = await proveMany(slice, tallyWasm, tallyZkey, {
          phase: 'tally',
        })
        for (let i = 0; i < slice.length; i++) {
          const input = slice[i]
          const proofHex = proofs[i]
          const commitment = input.newTallyCommitment.toString()
          tally.push({ proofHex, commitment })
          debug(`Generated proof with tally #${startTally + i}`, 'TALLY-TASK', {
            proofHex,
            commitment,
          })
        }
        saveProofCache(id, {
          circuitPower: maciRound.circuitPower,
          msg: { proofs: msg },
          tally: { proofs: tally },
          result,
          salt,
        })
        startTally = end
      }
      recordProverPhaseDuration(id, 'tally', (Date.now() - tallyStart) / 1000)

      allData = {
        result,
        salt,
        msg,
        tally,
      }
      try {
        saveProofCache(id, {
          circuitPower: maciRound.circuitPower,
          result,
          salt,
          msg: { proofs: msg },
          tally: { proofs: tally },
        })
      } catch (saveError) {
        debug(`Failed to save data: ${saveError}`, 'TALLY-TASK')
      }
    }

    let mi = Math.ceil(Number(mc) / params.batchSize)
    info(`Prepare to process msg`, 'TALLY-TASK')
    if (mi < allData.msg.length) {
      for (; mi < allData.msg.length; mi++) {
        const { proofHex, commitment } = allData.msg[mi]
        const res = await withRetry(
          () =>
            maciClient.processMessage(
              {
                groth16Proof: proofHex,
                newStateCommitment: commitment,
              },
              1.5,
            ),
          {
            context: 'RPC-PROCESS-MESSAGE',
            maxRetries: 3,
          },
        )
        debug(
          `processedMessage #${mi} 🛠️🛠️🛠️🛠️ with tx hash successfully ✅: ${res.transactionHash}`,
          'TALLY-TASK',
        )
      }

      await withRetry(() => maciClient.stopProcessingPeriod(1.5), {
        context: 'RPC-STOP-PROCESSING-PERIOD',
        maxRetries: 3,
      })
    } else {
      const period = await withRetry(() => maciClient.getPeriod(), {
        context: 'RPC-GET-PERIOD-FINAL',
        maxRetries: 3,
      })
      if (period.status === 'processing') {
        await withRetry(() => maciClient.stopProcessingPeriod(1.5), {
          context: 'RPC-STOP-PROCESSING-PERIOD',
          maxRetries: 3,
        })

        await sleep(6000)
      }
    }

    let ui = Math.ceil(Number(uc) / 5 ** params.intStateTreeDepth)
    info(`Prepare to process tally`, 'TALLY-TASK')
    if (ui < allData.tally.length) {
      for (; ui < allData.tally.length; ui++) {
        const { proofHex, commitment } = allData.tally[ui]
        const res = await withRetry(
          () =>
            maciClient.processTally(
              {
                groth16Proof: proofHex,
                newTallyCommitment: commitment,
              },
              1.5,
            ),
          {
            context: 'RPC-PROCESS-TALLY',
            maxRetries: 3,
          },
        )
        debug(
          `processedTally #${ui} 🛠️🛠️🛠️🛠️ with tx hash successfully ✅: ${res.transactionHash}`,
          'TALLY-TASK',
        )
      }

      try {
        info(
          'Executing stopTallying and claim as batch operation...',
          'TALLY-TASK',
        )
        const batchResult = await withRetry(
          () =>
            maciClient.stopTallyingAndClaim(
              {
                results: allData.result,
                salt: allData.salt,
              },
              1.5,
            ),
          {
            context: 'RPC-STOP-TALLYING-AND-CLAIM',
            maxRetries: 3,
          },
        )
        info(
          `Batch operation completed successfully✅, tx hash: ${batchResult.transactionHash}`,
          'TALLY-TASK',
        )
      } catch (error) {
        warn(`Error during batch operation: ${error}`, 'TALLY-TASK')

        info('Trying operations separately...', 'TALLY-TASK')
        try {
          await withRetry(
            () =>
              maciClient.stopTallyingPeriod(
                {
                  results: allData.result,
                  salt: allData.salt,
                },
                1.5,
              ),
            {
              context: 'RPC-STOP-TALLYING-PERIOD',
              maxRetries: 3,
            },
          )

          info('Executing claim operation.....', 'TALLY-TASK')
          const claimResult = await withRetry(() => maciClient.claim(1.5), {
            context: 'RPC-CLAIM',
            maxRetries: 3,
          })
          info(
            `Claim operation completed successfully✅, tx hash: ${claimResult.transactionHash}`,
            'TALLY-TASK',
          )
        } catch (fallbackError) {
          logError(
            new TallyError(
              'Error during fallback operations',
              'FALLBACK_ERROR',
              {
                roundId: id,
                operation: 'tally',
                timestamp: Date.now(),
                originalError: fallbackError,
              },
            ),
            'TALLY-TASK',
          )
          endOperation('tally', false, operationContext)
          return {
            error: {
              msg: 'fallback_error',
              details: String(fallbackError),
            },
          }
        }
      }
    } else {
      const period = await withRetry(() => maciClient.getPeriod(), {
        context: 'RPC-GET-PERIOD-FINAL',
        maxRetries: 3,
      })
      if (period.status === 'tallying') {
        try {
          info(
            'Executing stopTallying and claim as batch operation...',
            'TALLY-TASK',
          )
          const batchResult = await withRetry(
            () =>
              maciClient.stopTallyingAndClaim(
                {
                  results: allData.result,
                  salt: allData.salt,
                },
                1.5,
              ),
            {
              context: 'RPC-STOP-TALLYING-AND-CLAIM-FINAL',
              maxRetries: 3,
            },
          )
          info(
            `Batch operation completed successfully✅, tx hash: ${batchResult.transactionHash}`,
            'TALLY-TASK',
          )
        } catch (error) {
          warn(`Error during batch operation: ${error}`, 'TALLY-TASK')

          info('Trying operations separately...', 'TALLY-TASK')
          try {
            await withRetry(
              () =>
                maciClient.stopTallyingPeriod(
                  {
                    results: allData.result,
                    salt: allData.salt,
                  },
                  1.5,
                ),
              {
                context: 'RPC-STOP-TALLYING-PERIOD-FINAL',
                maxRetries: 3,
              },
            )

            info('Executing claim operation.....', 'TALLY-TASK')
            const claimResult = await withRetry(() => maciClient.claim(1.5), {
              context: 'RPC-CLAIM',
              maxRetries: 3,
            })
            info(
              `Claim operation completed successfully✅, tx hash: ${claimResult.transactionHash}`,
              'TALLY-TASK',
            )
          } catch (fallbackError) {
            logError(
              new TallyError(
                'Error during fallback operations',
                'FALLBACK_ERROR',
                {
                  roundId: id,
                  operation: 'tally',
                  timestamp: Date.now(),
                  originalError: fallbackError,
                },
              ),
              'TALLY-TASK',
            )
            endOperation('tally', false, operationContext)
            return {
              error: {
                msg: 'fallback_error',
                details: String(fallbackError),
              },
            }
          }
        }
      }
    }

    info(`Completed round Tally for ${id}`, 'TALLY-TASK')

    // logger: end the operation - 使用保存的上下文
    endOperation('tally', true, operationContext)
    // Metrics: record the task success
    recordTaskSuccess('tally')
    // Metrics: record the round completion
    recordRoundCompletion(id)
    // Metrics: record the task end
    recordTaskEnd('tally', id)
    return {}
  } catch (err) {
    const errorContext = {
      roundId: id,
      operation: 'tally',
      timestamp: Date.now(),
    }

    const categorizedError = categorizeError(err)

    // Record network error
    if (categorizedError instanceof NetworkError) {
      logError(
        new TallyError(
          'Network error during tally operation',
          'NETWORK_ERROR',
          errorContext,
        ),
        'TALLY-TASK',
      )
      endOperation('tally', false, operationContext)
      return {
        error: { msg: 'network_error', details: categorizedError.message },
      }
    }

    // Record contract error
    if (categorizedError instanceof ContractError) {
      logError(
        new TallyError(
          'Contract error during tally operation',
          'CONTRACT_ERROR',
          errorContext,
        ),
        'TALLY-TASK',
      )
      endOperation('tally', false, operationContext)
      return {
        error: { msg: 'contract_error', details: categorizedError.message },
      }
    }

    // Record unknown error
    logError(
      new TallyError(
        'Unexpected error during tally operation',
        'UNKNOWN_ERROR',
        { ...errorContext, originalError: categorizedError },
      ),
      'TALLY-TASK',
    )

    endOperation('tally', false, operationContext)
    throw categorizedError
  } finally {
    // Always record task end in finally block
    recordTaskEnd('tally', id)
  }
}
