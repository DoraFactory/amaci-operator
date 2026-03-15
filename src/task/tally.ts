import fs from 'fs'
import path from 'path'
// proof generation is offloaded to worker pool
import { GasPrice, calculateFee } from '@cosmjs/stargate'

import { fetchAllDeactivateLogs, fetchAllVotesLogs, fetchRound, streamPublishMessageEvents } from '../vota/indexer'
import { getContractSignerClient, withRetry, withBroadcastRetry } from '../lib/client/utils'
import { resolveRoundCircuitArtifacts } from '../lib/circuitArtifacts'
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
import { recordTaskFailure, recordTaskSuccess, recordRoundCompletion } from '../metrics'
import { recordProverPhaseDuration } from '../metrics'
import { recordTaskStart, recordTaskEnd } from '../metrics'
import {
  NetworkError,
  ContractError,
  TallyError,
  categorizeError,
} from '../error'
import { getProverConcurrency } from '../prover/concurrency'

import { genMaciInputs, genMaciInputsFromStore } from '../operator/genInputs'
import { proveMany } from '../prover/pool'
import { loadProofCache, saveProofCache, buildInputsSignature } from '../storage/proofCache'
import { markRoundTallyCompleted } from '../storage/roundStatus'
import { clearInputsDir, loadInputFiles, saveInputFiles } from '../storage/inputFiles'
import { DiskMessageStore } from '../storage/messageStore'
import { createSubmitter } from './submitter'
import { parseMessageNumbers } from './messageParsing'

const zkeyRoot = process.env.ZKEY_PATH || path.join(process.env.WORK_PATH || './work', 'zkey')
const highScaleCircuitPowers = new Set(['6-3-3-125', '9-4-3-125'])

// New layout: inputs/proof cache under 'data'
const inputsPath = path.join(process.env.WORK_PATH || './work', 'data')
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
  // Track submitters for cleanup on error
  let globalMsgSubmitter: any = null
  let globalTallySubmitter: any = null
  let finalized = false
  let finalizeTxHash: string | undefined

  // Metrics: Record the task start
  recordTaskStart('tally', id)

  try {
    const maciRound = await withRetry(() => fetchRound(id), {
      context: 'INDEXER-FETCH-ROUND',
      maxRetries: 3,
    })
    info(`Current round period:' ${maciRound.period}`, 'TALLY-TASK')

    info('Start round Tally ', 'TALLY-TASK')
    const circuitConcurrency = getProverConcurrency(maciRound.circuitPower)
    const now = Date.now()

    if (
      !['Pending', 'Voting', 'Processing', 'Tallying'].includes(
        maciRound.period,
      ) &&
      now < Number(maciRound.votingEnd) / 1e6
    ) {
      logError('Round not in proper state for tally', 'TALLY-TASK')
      recordTaskFailure('tally')
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
        const startProcessRes = await withBroadcastRetry(
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
    const artifact = await resolveRoundCircuitArtifacts(
      maciClient as any,
      maciRound.codeId,
      maciRound.circuitPower,
    )
    const pollId = artifact.pollId

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

    const waitForProcessedMessages = async (
      contextSuffix: string,
      waitRounds: number,
      intervalMs: number,
    ) => {
      const expected = Number(
        await withRetry(() => maciClient.getMsgChainLength(), {
          context: `RPC-GET-MSG-CHAIN-LENGTH-${contextSuffix}`,
          maxRetries: 3,
        }),
      )
      let processed = Number(
        await withRetry(() => maciClient.getProcessedMsgCount(), {
          context: `RPC-GET-MSG-COUNT-CONFIRM-${contextSuffix}`,
          maxRetries: 3,
        }),
      )

      for (let i = 0; i < waitRounds && processed < expected; i++) {
        await sleep(intervalMs)
        processed = Number(
          await withRetry(() => maciClient.getProcessedMsgCount(), {
            context: `RPC-GET-MSG-COUNT-CONFIRM-${contextSuffix}`,
            maxRetries: 3,
          }),
        )
      }

      return {
        expected,
        processed,
        ready: processed >= expected,
      }
    }

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
      const useMessageStore = highScaleCircuitPowers.has(maciRound.circuitPower)
      const env = process.env as Record<string, string | undefined>
      const indexerSyncRetries = Math.max(
        0,
        Number(env.INDEXER_SYNC_MAX_RETRIES || 10),
      )
      const indexerSyncIntervalMs = Math.max(
        500,
        Number(env.INDEXER_SYNC_INTERVAL_MS || 3000),
      )
      let logs: any
      let msgCount = 0
      let lastMsgId = ''
      let messageStore: DiskMessageStore | null = null

      const loadLogsFromIndexer = async () => {
        if (useMessageStore) {
          const baseLogs = await withRetry(() => fetchAllDeactivateLogs(id), {
            context: 'INDEXER-FETCH-VOTES-LOGS',
            maxRetries: 3,
          })
          logs = baseLogs

          const messagesDir = path.join(inputsPath, 'messages', id)
          messageStore = new DiskMessageStore(messagesDir, params.batchSize)
          messageStore.reset()

          const streamResult = await withRetry(
            () =>
              streamPublishMessageEvents(id, async (nodes) => {
                for (const m of nodes) {
                  const msg = parseMessageNumbers(
                    m.message,
                    'msg',
                    m.msgChainLength,
                    'TALLY-TASK',
                  )
                  const pubkey = (m.encPubKey.match(/\d+/g) || []).map(
                    (n: string) => BigInt(n),
                  ) as [bigint, bigint]
                  messageStore?.appendMessage(msg, pubkey)
                }
              }),
            {
              context: 'INDEXER-STREAM-MESSAGES',
              maxRetries: 3,
            },
          )

          messageStore.finalize()
          msgCount = streamResult.count
          lastMsgId = streamResult.lastId
          return
        }

        logs = await withRetry(() => fetchAllVotesLogs(id), {
          context: 'INDEXER-FETCH-VOTES-LOGS',
          maxRetries: 3,
        })
        msgCount = logs.msg.length
        lastMsgId = logs.msg[logs.msg.length - 1]?.id || ''
      }

      const chainMsgLength = Number(
        await withRetry(() => maciClient.getMsgChainLength(), {
          context: 'RPC-GET-MSG-CHAIN-LENGTH-INDEXER-SYNC',
          maxRetries: 3,
        }),
      )
      await loadLogsFromIndexer()

      let syncAttempt = 0
      while (msgCount < chainMsgLength && syncAttempt < indexerSyncRetries) {
        syncAttempt += 1
        warn(
          `Indexer lagging behind chain messages: indexer=${msgCount}, chain=${chainMsgLength}, retry=${syncAttempt}/${indexerSyncRetries}`,
          'TALLY-TASK',
        )
        await sleep(indexerSyncIntervalMs)
        await loadLogsFromIndexer()
      }

      if (msgCount < chainMsgLength) {
        throw new TallyError('Indexer not synced with message chain', 'CONTRACT_ERROR', {
          roundId: id,
          operation: 'tally',
          timestamp: Date.now(),
          details: `indexer_msg_count=${msgCount}, chain_msg_chain_length=${chainMsgLength}`,
        })
      }

      info(
        `The current round has ${logs.signup.length} signups, ${msgCount} messages, ${logs.dmsg.length} dmessages`,
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
            recordTaskFailure('tally')
            endOperation('tally', false, operationContext)
            return { error: { msg: 'period_not_tallying' } }
          }
        }

        // Finalize: stop tallying and claim with zeroed results
        let noSignupFinalizeTxHash: string | undefined
        try {
          info(
            'Executing stopTallying and claim as batch operation (no-signup fast-path)...',
            'TALLY-TASK',
          )
          const batchResult = await withBroadcastRetry(
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
          noSignupFinalizeTxHash = batchResult.transactionHash
        } catch (error) {
          warn(`Error during batch operation (no-signup fast-path): ${error}`, 'TALLY-TASK')

          info('Trying operations separately (no-signup fast-path)...', 'TALLY-TASK')
          try {
            await withBroadcastRetry(
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
            const claimResult = await withBroadcastRetry(() => maciClient.claim(1.5), {
              context: 'RPC-CLAIM-NO-SIGNUP',
              maxRetries: 3,
            })
            info(
              `Claim operation completed successfully✅, tx hash: ${claimResult.transactionHash}`,
              'TALLY-TASK',
            )
            noSignupFinalizeTxHash = claimResult.transactionHash
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
            recordTaskFailure('tally')
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
        markRoundTallyCompleted(id, { txHash: noSignupFinalizeTxHash })
        // Metrics: record the task end
        recordTaskEnd('tally', id)
        return {}
      }

      // Try reuse cached inputs (skip genMaciInputs if signature matches)
      const inputsSig = buildInputsSignature({
        circuitPower: maciRound.circuitPower,
        circuitType: maciRound.circuitType,
        pollId,
        maxVoteOptions: Number(maxVoteOptions),
        signupCount: logs.signup.length,
        lastSignupId: logs.signup[logs.signup.length - 1]?.id,
        msgCount,
        lastMsgId,
        dmsgCount: logs.dmsg.length,
        lastDmsgId: logs.dmsg[logs.dmsg.length - 1]?.id,
        processedDMsgCount: Number(dc),
      })
      let res: any
      const useFileInputs = highScaleCircuitPowers.has(maciRound.circuitPower)
      if (cache && cache.inputsSig === inputsSig && cache.result && cache.salt) {
        if (
          useFileInputs &&
          cache.inputsMeta?.mode === 'files' &&
          Number.isFinite(cache.inputsMeta.msgCount) &&
          Number.isFinite(cache.inputsMeta.tallyCount)
        ) {
          try {
            res = {
              msgInputs: loadInputFiles(id, 'msg', cache.inputsMeta.msgCount),
              tallyInputs: loadInputFiles(id, 'tally', cache.inputsMeta.tallyCount),
              result: cache.result,
            }
          } catch (e) {
            warn(`Failed to load cached inputs from files, regenerating: ${e}`, 'TALLY-TASK')
          }
        } else if (cache.inputs?.msgInputs && cache.inputs?.tallyInputs) {
          res = {
            msgInputs: cache.inputs.msgInputs,
            tallyInputs: cache.inputs.tallyInputs,
            result: cache.result,
          }
        }
      }

      if (!res) {
        if (useMessageStore && !messageStore) {
          throw new Error('Message store not initialized')
        }
        res = useMessageStore
          ? genMaciInputsFromStore(
              {
                ...params,
                coordPriKey: BigInt(process.env.COORDINATOR_PRI_KEY),
                maxVoteOptions: Number(maxVoteOptions),
                isQuadraticCost: !!Number(maciRound.circuitType),
                pollId,
              },
              {
                states: logs.signup.map((s: any) => ({
                  idx: s.stateIdx,
                  balance: BigInt(s.balance),
                  pubkey: (s.pubKey.match(/\d+/g) || []).map((n: string) =>
                    BigInt(n),
                  ) as [bigint, bigint],
                  c: [BigInt(s.d0), BigInt(s.d1), BigInt(s.d2), BigInt(s.d3)],
                })),
                dmessages: logs.dmsg.map((m: any) => ({
                  idx: m.dmsgChainLength,
                  numSignUps: m.numSignUps,
                  msg: parseMessageNumbers(
                    m.message,
                    'dmsg',
                    m.dmsgChainLength,
                    'TALLY-TASK',
                  ),
                  pubkey: (m.encPubKey.match(/\d+/g) || []).map((n: string) =>
                    BigInt(n),
                  ) as [bigint, bigint],
                })),
              },
              messageStore!,
              msgCount,
              Number(dc),
            )
          : genMaciInputs(
              {
                ...params,
                coordPriKey: BigInt(process.env.COORDINATOR_PRI_KEY),
                maxVoteOptions: Number(maxVoteOptions),
                isQuadraticCost: !!Number(maciRound.circuitType),
                pollId,
              },
              {
                states: logs.signup.map((s: any) => ({
                  idx: s.stateIdx,
                  balance: BigInt(s.balance),
                  pubkey: (s.pubKey.match(/\d+/g) || []).map((n: string) =>
                    BigInt(n),
                  ) as [bigint, bigint],
                  c: [BigInt(s.d0), BigInt(s.d1), BigInt(s.d2), BigInt(s.d3)],
                })),
                messages: logs.msg.map((m: any) => ({
                  idx: m.msgChainLength,
                  msg: parseMessageNumbers(
                    m.message,
                    'msg',
                    m.msgChainLength,
                    'TALLY-TASK',
                  ),
                  pubkey: (m.encPubKey.match(/\d+/g) || []).map((n: string) =>
                    BigInt(n),
                  ) as [bigint, bigint],
                })),
                dmessages: logs.dmsg.map((m: any) => ({
                  idx: m.dmsgChainLength,
                  numSignUps: m.numSignUps,
                  msg: parseMessageNumbers(
                    m.message,
                    'dmsg',
                    m.dmsgChainLength,
                    'TALLY-TASK',
                  ),
                  pubkey: (m.encPubKey.match(/\d+/g) || []).map((n: string) =>
                    BigInt(n),
                  ) as [bigint, bigint],
                })),
              },
              Number(dc),
            )
        // Save inputs + signature immediately to speed up restarts
        if (useFileInputs) {
          clearInputsDir(id)
          saveInputFiles(id, 'msg', res.msgInputs)
          saveInputFiles(id, 'tally', res.tallyInputs)
          saveProofCache(id, {
            circuitPower: maciRound.circuitPower,
            inputsSig,
            inputsMeta: {
              mode: 'files',
              msgCount: res.msgInputs.length,
              tallyCount: res.tallyInputs.length,
            },
            result: res.result.map((x: any) => x.toString()),
            salt: (res.tallyInputs.length ? res.tallyInputs[res.tallyInputs.length - 1].newResultsRootSalt.toString() : '0'),
          })
        } else {
          saveProofCache(id, {
            circuitPower: maciRound.circuitPower,
            inputsSig,
            inputs: { msgInputs: res.msgInputs, tallyInputs: res.tallyInputs },
            result: res.result.map((x: any) => x.toString()),
            salt: (res.tallyInputs.length ? res.tallyInputs[res.tallyInputs.length - 1].newResultsRootSalt.toString() : '0'),
          })
        }
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
      const msgBin = path.join(zkeyRoot, artifact.bundle, 'msg.bin')
      const msgZkey = path.join(zkeyRoot, artifact.bundle, 'msg.zkey')
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
          circuitConcurrency,
      )
      // if pipeline enabled, submit cached prefix (>= mi) first
      const miStart = Math.ceil(Number(mc) / params.batchSize)
      const submitBatchMsg = Math.max(
        1,
        Number(process.env.SUBMIT_BATCH_MSG || 0) ||
          Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          circuitConcurrency,
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
      globalMsgSubmitter = msgSubmitter

      while (startMsg < res.msgInputs.length) {
        const end = Math.min(startMsg + chunk, res.msgInputs.length)
        const sliceInputs = res.msgInputs.slice(startMsg, end)
        const _p0 = Date.now()
        const proofs = await proveMany(sliceInputs, msgBin, msgZkey, {
          phase: 'msg',
          baseIndex: startMsg,
          concurrency: circuitConcurrency,
        })
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

      const ensureTallying = async (contextSuffix: string) => {
        try {
          const sync = await waitForProcessedMessages(
            contextSuffix,
            20,
            3000,
          )
          if (!sync.ready) {
            warn(
              `Skip stopProcessingPeriod because processed messages are incomplete: processed=${sync.processed}, expected=${sync.expected}`,
              'TALLY-TASK',
            )
            return false
          }

          const beforeStop = await withRetry(() => maciClient.getPeriod(), {
            context: `RPC-GET-PERIOD-BEFORE-TALLY-${contextSuffix}`,
            maxRetries: 3,
          })
          if (beforeStop.status === 'processing') {
            await withBroadcastRetry(() => maciClient.stopProcessingPeriod('auto'), {
              context: `RPC-STOP-PROCESSING-PERIOD-GATE-${contextSuffix}`,
              maxRetries: 3,
            })
          }

          for (let i = 0; i < 20; i++) {
            const p = await withRetry(() => maciClient.getPeriod(), {
              context: `RPC-GET-PERIOD-TALLYING-${contextSuffix}`,
              maxRetries: 3,
            })
            if (p.status === 'tallying') return true
            await sleep(1000)
          }
        } catch {
          // fallback below
        }
        return false
      }

      // Pipeline mode submits message proofs while generating them,
      // so we must gate on-chain period transition here.
      if (usePipeline) {
        const ok = await ensureTallying('PIPELINE')
        if (!ok) {
          logError(
            new TallyError('Contract not in tallying period', 'CONTRACT_ERROR', {
              roundId: id,
              operation: 'tally',
              timestamp: Date.now(),
            }),
            'TALLY-TASK',
          )
          recordTaskFailure('tally')
          endOperation('tally', false, operationContext)
          return { error: { msg: 'period_not_tallying' } }
        }
      }

      info('Start to generate proof for tally', 'TALLY-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      const tallyBin = path.join(zkeyRoot, artifact.bundle, 'tally.bin')
      const tallyZkey = path.join(zkeyRoot, artifact.bundle, 'tally.zkey')
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
          circuitConcurrency,
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
      globalTallySubmitter = tallySubmitter

      while (startTally < res.tallyInputs.length) {
        const end = Math.min(startTally + chunk, res.tallyInputs.length)
        const slice = res.tallyInputs.slice(startTally, end)
        const _p0 = Date.now()
      const proofs = await proveMany(slice, tallyBin, tallyZkey, {
        phase: 'tally',
        baseIndex: startTally,
        concurrency: circuitConcurrency,
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
          circuitConcurrency,
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
            const res = await withBroadcastRetry(
              () => maciClient.processMessagesBatch(slice, 'auto'), 
              { context: 'RPC-PROCESS-MESSAGE-BATCH', maxRetries: 3 },
            )
            info(`Processed MSG batch [${mi + left}..${mi + right - 1}] ✅ tx=${res.transactionHash}`,'TALLY-TASK')
            break
          } catch (e) {
            if (size === 1) {
              // fallback to single
              const single = slice[0]
              const res = await withBroadcastRetry(
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

      const sync = await waitForProcessedMessages('NON-PIPELINE', 20, 1000)
      if (!sync.ready) {
        throw new TallyError('Messages are not fully processed yet', 'CONTRACT_ERROR', {
          roundId: id,
          operation: 'tally',
          timestamp: Date.now(),
          details: `processed_msg_count=${sync.processed}, msg_chain_length=${sync.expected}`,
        })
      }

      await withBroadcastRetry(() => maciClient.stopProcessingPeriod('auto'), {
        context: 'RPC-STOP-PROCESSING-PERIOD',
        maxRetries: 3,
      })
    } else if (!usePipeline) {
      const period = await withRetry(() => maciClient.getPeriod(), {
        context: 'RPC-GET-PERIOD-FINAL',
        maxRetries: 3,
      })
      if (period.status === 'processing') {
        const sync = await waitForProcessedMessages('NON-PIPELINE', 20, 1000)
        if (!sync.ready) {
          throw new TallyError('Messages are not fully processed yet', 'CONTRACT_ERROR', {
            roundId: id,
            operation: 'tally',
            timestamp: Date.now(),
            details: `processed_msg_count=${sync.processed}, msg_chain_length=${sync.expected}`,
          })
        }

        await withBroadcastRetry(() => maciClient.stopProcessingPeriod('auto'), {
          context: 'RPC-STOP-PROCESSING-PERIOD',
          maxRetries: 3,
        })

        await sleep(6000)
      }
    }

    // Non-pipeline mode submits message proofs only after all proofs are generated.
    // Ensure period has moved to tallying before submitting tally proofs.
    if (!usePipeline) {
      let tallying = false
      for (let i = 0; i < 20; i++) {
        const period = await withRetry(() => maciClient.getPeriod(), {
          context: 'RPC-GET-PERIOD-TALLYING-POST-MSG',
          maxRetries: 3,
        })
        if (period.status === 'tallying') {
          tallying = true
          break
        }
        await sleep(1000)
      }
      if (!tallying) {
        logError(
          new TallyError('Contract not in tallying period', 'CONTRACT_ERROR', {
            roundId: id,
            operation: 'tally',
            timestamp: Date.now(),
          }),
          'TALLY-TASK',
        )
        recordTaskFailure('tally')
        endOperation('tally', false, operationContext)
        return { error: { msg: 'period_not_tallying' } }
      }
    }

    let ui = Math.ceil(Number(uc) / 5 ** params.intStateTreeDepth)
    info(`Prepare to process tally`, 'TALLY-TASK')
    if (!usePipeline && ui < allData.tally.length) {
      const submitBatch = Math.max(
        1,
        Number(process.env.SUBMIT_BATCH_TALLY || 0) ||
          Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          circuitConcurrency,
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
        finalized = true
        finalizeTxHash = batchResult.transactionHash
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
          finalized = true
          finalizeTxHash = claimResult.transactionHash
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
          recordTaskFailure('tally')
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
              context: 'RPC-STOP-TALLYING-AND-CLAIM-FINAL',
              maxRetries: 3,
            },
          )
          info(
            `Batch operation completed successfully✅, tx hash: ${batchResult.transactionHash}`,
            'TALLY-TASK',
          )
          finalized = true
          finalizeTxHash = batchResult.transactionHash
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
                context: 'RPC-STOP-TALLYING-PERIOD-FINAL',
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
            finalized = true
            finalizeTxHash = claimResult.transactionHash
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
            recordTaskFailure('tally')
            endOperation('tally', false, operationContext)
            return {
              error: {
                msg: 'fallback_error',
                details: String(fallbackError),
              },
            }
          }
        }
      } else if (period.status === 'ended') {
        info(`Round ${id} already ended on-chain, skipping finalize broadcast`, 'TALLY-TASK')
        finalized = true
      } else {
        logError(
          new TallyError('Round is not ready for finalize', 'CONTRACT_ERROR', {
            roundId: id,
            operation: 'tally',
            timestamp: Date.now(),
            details: `period=${period.status}`,
          }),
          'TALLY-TASK',
        )
        recordTaskFailure('tally')
        endOperation('tally', false, operationContext)
        return {
          error: {
            msg: 'period_not_ready_for_finalize',
            details: `period=${period.status}`,
          },
        }
      }
    }

    if (!finalized) {
      logError(
        new TallyError('Tally finalize did not complete', 'CONTRACT_ERROR', {
          roundId: id,
          operation: 'tally',
          timestamp: Date.now(),
        }),
        'TALLY-TASK',
      )
      recordTaskFailure('tally')
      endOperation('tally', false, operationContext)
      return {
        error: {
          msg: 'tally_finalize_incomplete',
        },
      }
    }

    info(`Completed round Tally for ${id}`, 'TALLY-TASK')

    // logger: end the operation - 使用保存的上下文
    endOperation('tally', true, operationContext)
    // Metrics: record the task success
    recordTaskSuccess('tally')
    // Metrics: record the round completion
    recordRoundCompletion(id)
    markRoundTallyCompleted(id, { txHash: finalizeTxHash })
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
      recordTaskFailure('tally')
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
      recordTaskFailure('tally')
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

    recordTaskFailure('tally')
    endOperation('tally', false, operationContext)
    throw categorizedError
  } finally {
    // Ensure background submitters are closed on any exit path
    try { if (globalMsgSubmitter) await globalMsgSubmitter.close() } catch {}
    try { if (globalTallySubmitter) await globalTallySubmitter.close() } catch {}
    // Always record task end in finally block
    recordTaskEnd('tally', id)
  }
}
