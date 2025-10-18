import fs from 'fs'
import path from 'path'
// proof generation is offloaded to worker pool
import { GasPrice, calculateFee } from '@cosmjs/stargate'

import { fetchAllVotesLogs, fetchRound } from '../vota/indexer'
import { getContractSignerClient, withRetry, withBroadcastRetry } from '../lib/client/utils'
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
import { loadProofCache, saveProofCache, buildInputsSignature } from '../storage/proofCache'
import { createSubmitter } from './submitter'

const zkeyRoot = process.env.ZKEY_PATH || path.join(process.env.WORK_PATH || './work', 'zkey')

const inputsPath = path.join(process.env.WORK_PATH || './work', 'cache')
if (!fs.existsSync(inputsPath)) {
  fs.mkdirSync(inputsPath, { recursive: true })
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

  const usePipeline = Number(process.env.PROVER_PIPELINE || 0) > 0

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

      // Fast-path: if there are votes but NO signups, skip proving and finalize directly
      if (logs.signup.length === 0) {
        info(
          'No signups detected. Skipping proof generation and finalizing directly.',
          'TALLY-TASK',
        )

        // Build zeroed tally results and zero salt
        const zeroResults = new Array(Number(maxVoteOptions)).fill('0')
        const zeroSalt = '0'

        // Ensure contract is in tallying period before finalization
        const ensureTallyingNoSignup = async () => {
          const pollMax = 20
          const pollInterval = 3000
          try {
            // Wait for stopProcessingPeriod to be confirmed on-chain
            await withBroadcastRetry(() => maciClient.stopProcessingPeriod('auto'), {
              context: 'RPC-STOP-PROCESSING-PERIOD-GATE-NO-SIGNUP',
              maxRetries: 3,
            })
          } catch (e) {
            // best-effort: ignore and rely on subsequent period checks
          }
          for (let i = 0; i < pollMax; i++) {
            const p = await withRetry(() => maciClient.getPeriod(), {
              context: 'RPC-GET-PERIOD-TALLYING-NO-SIGNUP',
              maxRetries: 3,
            })
            if (p.status === 'tallying') return true
            await sleep(pollInterval)
          }
          return false
        }

        const pBeforeNoSignup = await withRetry(() => maciClient.getPeriod(), {
          context: 'RPC-GET-PERIOD-BEFORE-TALLY-NO-SIGNUP',
          maxRetries: 3,
        })
        if (pBeforeNoSignup.status !== 'tallying') {
          const ok = await ensureTallyingNoSignup()
          if (!ok) {
            logError(
              new TallyError('Contract not in tallying period', 'CONTRACT_ERROR', {
                roundId: id,
                operation: 'tally',
                timestamp: Date.now(),
              }),
              'TALLY-TASK',
            )
            endOperation('tally', false, operationContext)
            return { error: { msg: 'period_not_tallying' } }
          }
        }

        // Finalize: stop tallying and claim with zeroed results
        try {
          info(
            'Executing stopTallying and claim as batch operation (no-signup fast-path)...',
            'TALLY-TASK',
          )
          const batchResult = await withRetry(
            () =>
              maciClient.stopTallyingAndClaim(
                {
                  results: zeroResults,
                  salt: zeroSalt,
                },
                1.5,
              ),
            {
              context: 'RPC-STOP-TALLYING-AND-CLAIM-NO-SIGNUP',
              maxRetries: 3,
            },
          )
          info(
            `Batch operation completed successfully✅, tx hash: ${batchResult.transactionHash}`,
            'TALLY-TASK',
          )
        } catch (error) {
          warn(`Error during batch operation (no-signup fast-path): ${error}`, 'TALLY-TASK')

          info('Trying operations separately (no-signup fast-path)...', 'TALLY-TASK')
          try {
            await withRetry(
              () =>
                maciClient.stopTallyingPeriod(
                  {
                    results: zeroResults,
                    salt: zeroSalt,
                  },
                  1.5,
                ),
              {
                context: 'RPC-STOP-TALLYING-PERIOD-NO-SIGNUP',
                maxRetries: 3,
              },
            )

            info('Executing claim operation (no-signup fast-path).....', 'TALLY-TASK')
            const claimResult = await withRetry(() => maciClient.claim(1.5), {
              context: 'RPC-CLAIM-NO-SIGNUP',
              maxRetries: 3,
            })
            info(
              `Claim operation completed successfully✅, tx hash: ${claimResult.transactionHash}`,
              'TALLY-TASK',
            )
          } catch (fallbackError) {
            logError(
              new TallyError(
                'Error during fallback operations (no-signup fast-path)',
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

        info(`Completed round Tally for ${id} (no-signup fast-path)`, 'TALLY-TASK')

        // logger: end the operation - 使用保存的上下文
        endOperation('tally', true, operationContext)
        // Metrics: record the task success
        recordTaskSuccess('tally')
        // Metrics: record the round completion
        recordRoundCompletion(id)
        // Metrics: record the task end
        recordTaskEnd('tally', id)
        return {}
      }

      // Try reuse cached inputs (skip genMaciInputs if signature matches)
      const inputsSig = buildInputsSignature({
        circuitPower: maciRound.circuitPower,
        circuitType: maciRound.circuitType,
        maxVoteOptions: Number(maxVoteOptions),
        signupCount: logs.signup.length,
        lastSignupId: logs.signup[logs.signup.length - 1]?.id,
        msgCount: logs.msg.length,
        lastMsgId: logs.msg[logs.msg.length - 1]?.id,
        dmsgCount: logs.dmsg.length,
        lastDmsgId: logs.dmsg[logs.dmsg.length - 1]?.id,
        processedDMsgCount: Number(dc),
      })
      let res: any
      if (cache && cache.inputsSig === inputsSig && cache.inputs?.msgInputs && cache.inputs?.tallyInputs && cache.result && cache.salt) {
        res = {
          msgInputs: cache.inputs.msgInputs,
          tallyInputs: cache.inputs.tallyInputs,
          result: cache.result,
        }
      } else {
        res = genMaciInputs(
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
        // Save inputs + signature immediately to speed up restarts
        saveProofCache(id, {
          circuitPower: maciRound.circuitPower,
          inputsSig,
          inputs: { msgInputs: res.msgInputs, tallyInputs: res.tallyInputs },
          result: res.result.map((x: any) => x.toString()),
          salt: (res.tallyInputs.length ? res.tallyInputs[res.tallyInputs.length - 1].newResultsRootSalt.toString() : '0'),
        })
      }

      const lastTallyInput = res.tallyInputs[res.tallyInputs.length - 1]
      const result = (cache && cache.inputsSig === inputsSig && cache.result) ? cache.result : res.result.map((i: any) => i.toString())
      const salt = (cache && cache.inputsSig === inputsSig && cache.salt)
        ? cache.salt
        : (lastTallyInput ? lastTallyInput.newResultsRootSalt.toString() : '0')

      const msg: ProofData[] = []
      const tally: ProofData[] = []

      // Sequential phases; each internally parallel via worker pool
      // usePipeline is determined at function scope
      info('Start to generate proof for msgs', 'TALLY-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      const msgWasm = path.join(zkeyRoot, `${maciRound.circuitPower}_v3`, 'msg.wasm')
      const msgZkey = path.join(zkeyRoot, `${maciRound.circuitPower}_v3`, 'msg.zkey')
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
      // if pipeline enabled, submit cached prefix (>= mi) first
      const miStart = Math.ceil(Number(mc) / params.batchSize)
      const submitBatchMsg = Math.max(
        1,
        Number(process.env.SUBMIT_BATCH_MSG || 0) ||
          Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          Number(process.env.PROVER_CONCURRENCY || 1),
      )
      let nextSubmitMsg = miStart
      // Background submitter for MSG when pipeline is enabled
      let msgSubmitter: any = null
      if (usePipeline) {
        msgSubmitter = createSubmitter(
          (items: any[]) => maciClient.processMessagesBatch(items, 'auto'),
          (item: any) => maciClient.processMessage(item, 'auto'),
          {
            batchLimit: submitBatchMsg,
            contextBatch: 'RPC-PROCESS-MESSAGE-BATCH',
            contextSingle: 'RPC-PROCESS-MESSAGE',
            phaseLabel: 'MSG',
          },
        )
        // seed cached region [miStart, msg.length)
        if (nextSubmitMsg < msg.length) {
          let si = nextSubmitMsg
          while (si < msg.length) {
            const end = Math.min(si + submitBatchMsg, msg.length)
            const items = msg.slice(si, end).map((x) => ({
              groth16Proof: x.proofHex as any,
              newStateCommitment: x.commitment as any,
            }))
            msgSubmitter.enqueue(items)
            si = end
          }
          nextSubmitMsg = msg.length
        }
      }

      while (startMsg < res.msgInputs.length) {
        const end = Math.min(startMsg + chunk, res.msgInputs.length)
        const sliceInputs = res.msgInputs.slice(startMsg, end)
        const _p0 = Date.now()
        const proofs = await proveMany(sliceInputs, msgWasm, msgZkey, { phase: 'msg', baseIndex: startMsg })
        const _pd = Date.now() - _p0
        info(`Generated MSG proof batch [${startMsg}..${end - 1}] in ${_pd}ms`, 'TALLY-TASK')
        for (let i = 0; i < sliceInputs.length; i++) {
          const input = sliceInputs[i]
          const proofHex = proofs[i]
          const commitment = input.newStateCommitment.toString()
          msg.push({ proofHex, commitment })
          debug(`Generated proof with msg #${startMsg + i}`, 'TALLY-TASK', { proofHex, commitment })
        }
        saveProofCache(id, { circuitPower: maciRound.circuitPower, msg: { proofs: msg }, result, salt })

        if (usePipeline && msgSubmitter) {
          const submitStart = Math.max(nextSubmitMsg, startMsg)
          if (submitStart < end) {
            const items = msg.slice(submitStart, end).map((x) => ({
              groth16Proof: x.proofHex as any,
              newStateCommitment: x.commitment as any,
            }))
            msgSubmitter.enqueue(items)
            nextSubmitMsg = end
          }
        }
        startMsg = end
      }
      recordProverPhaseDuration(id, 'msg', (Date.now() - msgStart) / 1000)

      // Ensure all message submissions flushed before moving to tallying gate
      if (usePipeline && msgSubmitter) {
        await msgSubmitter.close()
      }

      info('Start to generate proof for tally', 'TALLY-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      // Gate: ensure contract period is tallying BEFORE any tally submission (including cached region)
      const ensureTallying = async () => {
        try {
          // Wait a bit for processed messages to reflect on-chain
          for (let i = 0; i < 10; i++) {
            const pmc = await withRetry(() => maciClient.getProcessedMsgCount(), {
              context: 'RPC-GET-MSG-COUNT-CONFIRM',
              maxRetries: 3,
            })
            if (Number(pmc) >= (allData?.msg?.length || 0)) break
            await sleep(3000)
          }
          // Try stopping processing (idempotent) then wait for tallying
          await withBroadcastRetry(() => maciClient.stopProcessingPeriod('auto'), {
            context: 'RPC-STOP-PROCESSING-PERIOD-GATE',
            maxRetries: 3,
          })
          const pollMax = 20
          const pollInterval = 1000
          for (let i = 0; i < pollMax; i++) {
            const p = await withRetry(() => maciClient.getPeriod(), {
              context: 'RPC-GET-PERIOD-TALLYING',
              maxRetries: 3,
            })
            if (p.status === 'tallying') return true
            await sleep(pollInterval)
          }
          return false
        } catch {
          return false
        }
      }
      const pBefore = await withRetry(() => maciClient.getPeriod(), {
        context: 'RPC-GET-PERIOD-BEFORE-TALLY',
        maxRetries: 3,
      })
      if (pBefore.status !== 'tallying') {
        const ok = await ensureTallying()
        if (!ok) {
          logError(
            new TallyError('Contract not in tallying period', 'CONTRACT_ERROR', {
              roundId: id,
              operation: 'tally',
              timestamp: Date.now(),
            }),
            'TALLY-TASK',
          )
          endOperation('tally', false, operationContext)
          return { error: { msg: 'period_not_tallying' } }
        }
      }
      const tallyWasm = path.join(zkeyRoot, `${maciRound.circuitPower}_v3`, 'tally.wasm')
      const tallyZkey = path.join(zkeyRoot, `${maciRound.circuitPower}_v3`, 'tally.zkey')
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
      const uiStart = Math.ceil(Number(uc) / 5 ** params.intStateTreeDepth)
      const submitBatchTally = Math.max(
        1,
        Number(process.env.SUBMIT_BATCH_TALLY || 0) ||
          Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          Number(process.env.PROVER_CONCURRENCY || 1),
      )
      let nextSubmitTally = uiStart
      // Background submitter for TALLY when pipeline is enabled
      let tallySubmitter: any = null
      if (usePipeline) {
        tallySubmitter = createSubmitter(
          (items: any[]) => maciClient.processTallyBatch(items, 'auto'),
          (item: any) => maciClient.processTally(item, 'auto'),
          {
            batchLimit: submitBatchTally,
            contextBatch: 'RPC-PROCESS-TALLY-BATCH',
            contextSingle: 'RPC-PROCESS-TALLY',
            phaseLabel: 'TALLY',
          },
        )
        if (nextSubmitTally < tally.length) {
          let si = nextSubmitTally
          while (si < tally.length) {
            const end = Math.min(si + submitBatchTally, tally.length)
            const items = tally.slice(si, end).map((x) => ({ groth16Proof: x.proofHex as any, newTallyCommitment: x.commitment as any }))
            tallySubmitter.enqueue(items)
            si = end
          }
          nextSubmitTally = tally.length
        }
      }

      while (startTally < res.tallyInputs.length) {
        const end = Math.min(startTally + chunk, res.tallyInputs.length)
        const slice = res.tallyInputs.slice(startTally, end)
        const _p0 = Date.now()
        const proofs = await proveMany(slice, tallyWasm, tallyZkey, {
          phase: 'tally',
          baseIndex: startTally,
        })
        const _pd = Date.now() - _p0
        info(`Generated TALLY proof batch [${startTally}..${end - 1}] in ${_pd}ms`, 'TALLY-TASK')
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
        if (usePipeline && tallySubmitter) {
          const submitStart = Math.max(nextSubmitTally, startTally)
          if (submitStart < end) {
            const items = tally.slice(submitStart, end).map((x) => ({ groth16Proof: x.proofHex as any, newTallyCommitment: x.commitment as any }))
            tallySubmitter.enqueue(items)
            nextSubmitTally = end
          }
        }
        startTally = end
      }
      recordProverPhaseDuration(id, 'tally', (Date.now() - tallyStart) / 1000)

      // Drain tally submitter before finalization
      if (usePipeline && tallySubmitter) {
        await tallySubmitter.close()
      }

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
    if (!usePipeline && mi < allData.msg.length) {
      const submitBatch = Math.max(
        1,
        Number(process.env.SUBMIT_BATCH_MSG || 0) ||
          Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          Number(process.env.PROVER_CONCURRENCY || 1),
      )
      while (mi < allData.msg.length) {
        const end = Math.min(mi + submitBatch, allData.msg.length)
        const items = allData.msg.slice(mi, end).map((x) => ({
          groth16Proof: x.proofHex as any,
          newStateCommitment: x.commitment as any,
        }))
        // try batch, degrade to smaller if fails
        let left = 0
        let right = items.length
        while (left < right) {
          const size = right - left
          const slice = items.slice(left, right)
          try {
            const res = await withRetry(
              () => maciClient.processMessagesBatch(slice, 'auto'), 
              { context: 'RPC-PROCESS-MESSAGE-BATCH', maxRetries: 3 },
            )
            info(`Processed MSG batch [${mi + left}..${mi + right - 1}] ✅ tx=${res.transactionHash}`,'TALLY-TASK')
            break
          } catch (e) {
            if (size === 1) {
              // fallback to single
              const single = slice[0]
              const res = await withRetry(
                () =>
                  maciClient.processMessage(
                    {
                      groth16Proof: single.groth16Proof,
                      newStateCommitment: single.newStateCommitment,
                    },
                    'auto',
                  ),
                { context: 'RPC-PROCESS-MESSAGE', maxRetries: 3 },
              )
              info(`Processed MSG #${mi + left} ✅ tx=${res.transactionHash}`,'TALLY-TASK')
              break
            } else {
              // split range: try first half
              right = left + Math.floor(size / 2)
            }
          }
        }
        mi = end
      }

      await withRetry(() => maciClient.stopProcessingPeriod('auto'), {
        context: 'RPC-STOP-PROCESSING-PERIOD',
        maxRetries: 3,
      })
    } else if (!usePipeline) {
      const period = await withRetry(() => maciClient.getPeriod(), {
        context: 'RPC-GET-PERIOD-FINAL',
        maxRetries: 3,
      })
      if (period.status === 'processing') {
        await withRetry(() => maciClient.stopProcessingPeriod('auto'), {
          context: 'RPC-STOP-PROCESSING-PERIOD',
          maxRetries: 3,
        })

        await sleep(6000)
      }
    }

    let ui = Math.ceil(Number(uc) / 5 ** params.intStateTreeDepth)
    info(`Prepare to process tally`, 'TALLY-TASK')
    if (!usePipeline && ui < allData.tally.length) {
      const submitBatch = Math.max(
        1,
        Number(process.env.SUBMIT_BATCH_TALLY || 0) ||
          Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          Number(process.env.PROVER_CONCURRENCY || 1),
      )
      while (ui < allData.tally.length) {
        const end = Math.min(ui + submitBatch, allData.tally.length)
        const items = allData.tally.slice(ui, end).map((x) => ({
          groth16Proof: x.proofHex as any,
          newTallyCommitment: x.commitment as any,
        }))
        let left = 0
        let right = items.length
        while (left < right) {
          const size = right - left
          const slice = items.slice(left, right)
          try {
            const res = await withBroadcastRetry(
              () => maciClient.processTallyBatch(slice, 'auto'),
              { context: 'RPC-PROCESS-TALLY-BATCH', maxRetries: 3 },
            )
            info(`Processed TALLY batch [${ui + left}..${ui + right - 1}] ✅ tx=${res.transactionHash}`,'TALLY-TASK')
            break
          } catch (e) {
            if (size === 1) {
              const single = slice[0]
              const res = await withBroadcastRetry(
                () =>
                  maciClient.processTally(
                    {
                      groth16Proof: single.groth16Proof,
                      newTallyCommitment: single.newTallyCommitment,
                    },
                    'auto',
                  ),
                { context: 'RPC-PROCESS-TALLY', maxRetries: 3 },
              )
              info(`Processed TALLY #${ui + left} ✅ tx=${res.transactionHash}`,'TALLY-TASK')
              break
            } else {
              right = left + Math.floor(size / 2)
            }
          }
        }
        ui = end
      }

      try {
        info(
          'Executing stopTallying and claim as batch operation...',
          'TALLY-TASK',
        )
        const batchResult = await withBroadcastRetry(
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
          await withBroadcastRetry(
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
          const claimResult = await withBroadcastRetry(() => maciClient.claim(1.5), {
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
