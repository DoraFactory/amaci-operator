import fs from 'fs'
import path from 'path'
// proof generation is offloaded to worker pool

import { getContractSignerClient, withRetry, withBroadcastRetry } from '../lib/client/utils'
import { uploadDeactivateHistory } from '../lib/client/Deactivate.client'
import { genDeacitveMaciInputs } from '../operator/genDeactivateInputs'
import {
  MaciParams,
  ProofData,
  TaskAct,
  maciParamsFromCircuitPower,
} from '../types'
import { fetchAllDeactivateLogs, fetchRound } from '../vota/indexer'
// adaptToUncompressed is handled inside worker
import { proveMany } from '../prover/pool'
import { loadProofCache, saveProofCache, buildInputsSignature } from '../storage/proofCache'
import { recordProverPhaseDuration } from '../metrics'
import { Timer } from '../storage/timer'
import {
  info,
  error as logError,
  debug,
  warn,
  startOperation,
  endOperation,
  setCurrentRound,
} from '../logger'
import { recordTaskFailure, recordTaskSuccess, recordTaskStart, recordTaskEnd } from '../metrics'
import { createSubmitter } from './submitter'
import {
  NetworkError,
  ContractError,
  DeactivateError,
  categorizeError,
} from '../error'
const zkeyRoot = process.env.ZKEY_PATH || path.join(process.env.WORK_PATH || './work', 'zkey')

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL || 60000)

export const deactivate: TaskAct = async (_, { id }: { id: string }) => {
  // log the round id
  setCurrentRound(id)

  // 保存startOperation返回的上下文对象
  const operationContext = startOperation('deactivate', 'DEACTIVATE-TASK')

  // Metrics: record the task starttrics: record the task start
  recordTaskStart('deactivate', id)

  // Track submitter for cleanup across the task
  let deactSubmitterGlobal: any = null
  try {
    const isAllProcessedError = (e: any) =>
      typeof e?.message === 'string' &&
      e.message.toLowerCase().includes('all deactivate messages have been processed')
    const maciRound = await withRetry(() => fetchRound(id), {
      context: 'INDEXER-FETCH-ROUND',
      maxRetries: 3,
    })
    info(`Current round period: ${maciRound.period}`, 'DEACTIVATE-TASK')

    info('Start round deactivate', 'DEACTIVATE-TASK')

    const now = Date.now()

    // If the round has already ended, you can ignore the condition
    // and execute a deactivate task.
    if (now < Number(maciRound.votingEnd) / 1e6) {
      if (!['Pending', 'Voting'].includes(maciRound.period)) {
        logError('Round not in proper state for deactivate', 'DEACTIVATE-TASK')
        recordTaskFailure('deactivate')
        endOperation('deactivate', false, operationContext)
        return { error: { msg: 'error status' } }
      }

      const latestdeactivateAt = Timer.get(id)

      if (latestdeactivateAt + deactivateInterval > now) {
        logError('Too early to deactivate again', 'DEACTIVATE-TASK')
        recordTaskFailure('deactivate')
        endOperation('deactivate', false, operationContext)
        return { error: { msg: 'too earlier' } }
      }
    }

    const params = maciParamsFromCircuitPower(maciRound.circuitPower)

    const maciClient = await getContractSignerClient(id)

    const dc = await withRetry(() => maciClient.getProcessedDMsgCount(), {
      context: 'RPC-GET-DMSG-COUNT',
      maxRetries: 3,
    })

    const logs = await withRetry(() => fetchAllDeactivateLogs(id), {
      context: 'INDEXER-FETCH-DEACTIVATE-LOGS',
      maxRetries: 3,
    })

    info('Fetched deactivate logs', 'DEACTIVATE-TASK', {
      signup: logs.signup.length,
      dmsg: logs.dmsg.length,
      processedCount: Number(dc),
    })

    if (logs.dmsg.length > Number(dc)) {
      const maxVoteOptions = await withRetry(
        () => maciClient.maxVoteOptions(),
        {
          context: 'RPC-GET-MAX-VOTE-OPTIONS',
          maxRetries: 3,
        },
      )

      // Try reuse cached inputs for deactivate
      const inputsSig = buildInputsSignature({
        circuitPower: maciRound.circuitPower,
        circuitType: maciRound.circuitType,
        maxVoteOptions: Number(maxVoteOptions),
        signupCount: logs.signup.length,
        lastSignupId: logs.signup[logs.signup.length - 1]?.id,
        msgCount: 0,
        lastMsgId: '',
        dmsgCount: logs.dmsg.length,
        lastDmsgId: logs.dmsg[logs.dmsg.length - 1]?.id,
        processedDMsgCount: Number(dc),
      })
      let res: any
      const cache = loadProofCache(id)
      if (cache && cache.inputsSig === inputsSig && cache.inputs?.dMsgInputs) {
        res = {
          dMsgInputs: cache.inputs.dMsgInputs,
          newDeactivates: cache.inputs?.newDeactivates || [],
        }
        // Backfill missing newDeactivates for older cache versions
        if (!res.newDeactivates || res.newDeactivates.length === 0) {
          const recompute = genDeacitveMaciInputs(
            {
              ...params,
              coordPriKey: BigInt(process.env.COORDINATOR_PRI_KEY),
              maxVoteOptions: Number(maxVoteOptions),
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
              messages: [],
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
          res.newDeactivates = recompute.newDeactivates
          saveProofCache(id, {
            circuitPower: maciRound.circuitPower,
            inputsSig,
            inputs: {
              dMsgInputs: cache.inputs.dMsgInputs,
              newDeactivates: recompute.newDeactivates,
            },
          })
        }
      } else {
        const computed = genDeacitveMaciInputs(
        {
          ...params,
          coordPriKey: BigInt(process.env.COORDINATOR_PRI_KEY),
          maxVoteOptions: Number(maxVoteOptions),
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
          messages: [],
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
        res = computed
        // Save inputs + signature for deactivate
        saveProofCache(id, {
          circuitPower: maciRound.circuitPower,
          inputsSig,
          inputs: { dMsgInputs: computed.dMsgInputs, newDeactivates: computed.newDeactivates },
        })
      }

      const dmsg: (ProofData & { root: string; size: string })[] = []

      const usePipeline = Number(process.env.PROVER_PIPELINE || 0) > 0
      info('Start generating proof for deactivate', 'DEACTIVATE-TASK', {
        period: maciRound.period,
        circuitPower: maciRound.circuitPower,
      })
      const cached = (loadProofCache(id)?.deactivate?.proofs || []) as (ProofData & { root: string; size: string })[]
      let start = 0
      for (let i = 0; i < Math.min(cached.length, res.dMsgInputs.length); i++) {
        const expected = res.dMsgInputs[i].input.newDeactivateCommitment.toString()
        if (cached[i]?.commitment === expected) {
          dmsg.push(cached[i])
          start = i + 1
        } else {
          break
        }
      }
      const phaseStart = Date.now()
      const wasm = path.join(zkeyRoot, `${maciRound.circuitPower}_v3`, 'deactivate.wasm')
      const zkey = path.join(zkeyRoot, `${maciRound.circuitPower}_v3`, 'deactivate.zkey')
      const chunk = Math.max(1, Number(process.env.PROVER_SAVE_CHUNK || 0) || Number(process.env.PROVER_CONCURRENCY || 2))
      // If pipeline: submit cached prefix first
      const submitBatch = Math.max(
        1,
        Number(process.env.SUBMIT_BATCH_DEACTIVATE || 0) ||
          Number(process.env.PROVER_SAVE_CHUNK || 0) ||
          Number(process.env.PROVER_CONCURRENCY || 1),
      )
      // Background submitter for DEACTIVATE
      let stopSubmitting = false
      let deactSubmitter: any = null
      if (usePipeline) {
        deactSubmitter = createSubmitter(
          (items: any[]) => maciClient.processDeactivateMessageBatch(items, 'auto'),
          (item: any) =>
            maciClient.processDeactivateMessage(
              item,
              'auto',
            ),
          {
            batchLimit: submitBatch,
            contextBatch: 'RPC-PROCESS-DEACTIVATE-BATCH',
            contextSingle: 'RPC-PROCESS-DEACTIVATE',
            phaseLabel: 'DEACTIVATE',
            shouldStop: (e: any) => isAllProcessedError(e),
          },
        )
        deactSubmitterGlobal = deactSubmitter
        // seed cached region
        if (dmsg.length > 0) {
          let si = 0
          while (si < dmsg.length) {
            const end = Math.min(si + submitBatch, dmsg.length)
            const items = dmsg.slice(si, end).map((x) => ({
              groth16Proof: x.proofHex as any,
              newDeactivateCommitment: x.commitment as any,
              newDeactivateRoot: x.root as any,
              size: x.size as any,
            }))
            deactSubmitter.enqueue(items)
            si = end
          }
        }
      }
      while (start < res.dMsgInputs.length && !stopSubmitting) {
        const end = Math.min(start + chunk, res.dMsgInputs.length)
        const slice = res.dMsgInputs.slice(start, end)
        const _p0 = Date.now()
        const proofs = await proveMany(
          slice.map((s: any) => s.input),
          wasm,
          zkey,
          { phase: 'deactivate', baseIndex: start },
        )
        const _pd = Date.now() - _p0
        info(`Generated DEACTIVATE proof batch [${start}..${end - 1}] in ${_pd}ms`, 'DEACTIVATE-TASK')
        for (let i = 0; i < slice.length; i++) {
          const { input, size } = slice[i]
          const proofHex = proofs[i]
          const commitment = input.newDeactivateCommitment.toString()
          const root = input.newDeactivateRoot.toString()
          debug(`Generated deactivate proof #${start + i}`, 'DEACTIVATE-TASK')
          dmsg.push({ proofHex, commitment, root, size })
        }
        saveProofCache(id, { circuitPower: maciRound.circuitPower, deactivate: { proofs: dmsg } })
        if (usePipeline && deactSubmitter) {
          const submitStart = end - slice.length
          const items = dmsg.slice(submitStart, end).map((x) => ({
            groth16Proof: x.proofHex as any,
            newDeactivateCommitment: x.commitment as any,
            newDeactivateRoot: x.root as any,
            size: x.size as any,
          }))
          deactSubmitter.enqueue(items)
        }
        start = end
      }
      recordProverPhaseDuration(id, 'deactivate', (Date.now() - phaseStart) / 1000)
      if (usePipeline && deactSubmitter) {
        await deactSubmitter.close()
      }
      // If not pipeline, submit remaining accumulated dmsg in one pass
      if (!usePipeline && dmsg.length > 0 && !stopSubmitting) {
        info(`Prepare to send ${dmsg.length} deactivate messages`, 'DEACTIVATE-TASK')
        let di = 0
        while (di < dmsg.length && !stopSubmitting) {
          const end = Math.min(di + submitBatch, dmsg.length)
          const items = dmsg.slice(di, end).map((x) => ({
            groth16Proof: x.proofHex as any,
            newDeactivateCommitment: x.commitment as any,
            newDeactivateRoot: x.root as any,
            size: x.size as any,
          }))
          let left = 0
          let right = items.length
          while (left < right && !stopSubmitting) {
            const size = right - left
            const slice = items.slice(left, right)
            try {
              const res = await withBroadcastRetry(
                () => maciClient.processDeactivateMessageBatch(slice, 'auto'),
                { context: 'RPC-PROCESS-DEACTIVATE-BATCH', maxRetries: 3 },
              )
              info(`Processed deactivate batch [${di + left}..${di + right - 1}] ✅`, 'DEACTIVATE-TASK', { txHash: res.transactionHash })
              break
            } catch (e) {
              if (isAllProcessedError(e)) {
                warn('All deactivate messages already processed on-chain, stopping submissions', 'DEACTIVATE-TASK')
                stopSubmitting = true
                break
              }
              if (size === 1) {
                const single = slice[0]
                try {
                const res = await withBroadcastRetry(
                  () =>
                    maciClient.processDeactivateMessage(
                        {
                          groth16Proof: single.groth16Proof,
                          newDeactivateCommitment: single.newDeactivateCommitment,
                          newDeactivateRoot: single.newDeactivateRoot,
                          size: single.size,
                        },
                        'auto',
                      ),
                  { context: 'RPC-PROCESS-DEACTIVATE', maxRetries: 3 },
                )
                  info(`Processed deactivate #${di + left} ✅`, 'DEACTIVATE-TASK', { txHash: res.transactionHash })
                  break
                } catch (e2) {
                  if (isAllProcessedError(e2)) {
                    warn('All deactivate messages already processed on-chain, stopping submissions', 'DEACTIVATE-TASK')
                    stopSubmitting = true
                    break
                  }
                  throw e2
                }
              } else {
                right = left + Math.floor(size / 2)
              }
            }
          }
          di = end
        }
      }

      const uploadRes = await uploadDeactivateHistory(
        id,
        (res.newDeactivates || []).map((d: any) => d.map(String)),
      )
      info('Uploaded deactivate history successfully✅', 'DEACTIVATE-TASK', {
        uploadResult: uploadRes.transactionHash,
      })

      // Only record success when we actually processed messages
      endOperation('deactivate', true, operationContext)
      recordTaskSuccess('deactivate')
    } else {
      info(
        'No new deactivate messages to process  👀 👀 👀, waiting for more',
        'DEACTIVATE-TASK',
      )
      // When no messages to process, we still end the operation but don't mark as success
      endOperation('deactivate', true, operationContext)
    }

    Timer.set(id, now)

    return {}
  } catch (err) {
    const errorContext = {
      roundId: id,
      operation: 'deactivate',
      timestamp: Date.now(),
    }

    const categorizedError = categorizeError(err)

    // Record network error
    if (categorizedError instanceof NetworkError) {
      logError(
        new DeactivateError(
          'Network error during deactivate operation',
          'NETWORK_ERROR',
          errorContext,
        ),
        'DEACTIVATE-TASK',
      )
      recordTaskFailure('deactivate')
      endOperation('deactivate', false, operationContext)
      return {
        error: { msg: 'network_error', details: categorizedError.message },
      }
    }

    // Record contract error
    if (categorizedError instanceof ContractError) {
      logError(
        new DeactivateError(
          'Contract error during deactivate operation',
          'CONTRACT_ERROR',
          errorContext,
        ),
        'DEACTIVATE-TASK',
      )
      recordTaskFailure('deactivate')
      endOperation('deactivate', false, operationContext)
      return {
        error: { msg: 'contract_error', details: categorizedError.message },
      }
    }

    // Record unknown error
    logError(
      new DeactivateError(
        'Unexpected error during deactivate operation',
        'UNKNOWN_ERROR',
        { ...errorContext, originalError: categorizedError },
      ),
      'DEACTIVATE-TASK',
    )

    recordTaskFailure('deactivate')
    endOperation('deactivate', false, operationContext)
    throw categorizedError
  } finally {
    // Ensure submitter is closed on any exit path (if created)
    try {
      if (deactSubmitterGlobal && typeof deactSubmitterGlobal.close === 'function') {
        await deactSubmitterGlobal.close()
      }
    } catch {}
    // Always record task end in finally block
    recordTaskEnd('deactivate', id)
  }
}
