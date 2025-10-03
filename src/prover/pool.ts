import { fork, ChildProcess } from 'node:child_process'
import path from 'path'
import { info, debug } from '../logger'
import {
  incProverActiveChildren,
  decProverActiveChildren,
  incProverJobs,
} from '../metrics'

export type ProofHex = { a: string; b: string; c: string }

const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number(process.env.PROVER_CONCURRENCY || 2),
)

function createChild(): ChildProcess {
  // Resolve compiled child path at runtime (dist/prover/child.js)
  const childPath = path.join(__dirname, 'child.js')
  // inherit env, enable IPC channel
  return fork(childPath, [], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  })
}

type Job = {
  id: number
  input: any
}

/**
 * Run groth16 proofs in a small worker pool. Returns proofHex array aligned with inputs order.
 * This only optimizes the CPU-bound proof generation step and does not change business logic.
 */
export async function proveMany(
  inputs: any[],
  wasmPath: string,
  zkeyPath: string,
  opts?: { concurrency?: number; phase?: string },
): Promise<ProofHex[]> {
  if (inputs.length === 0) return []

  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY)
  const results: ProofHex[] = new Array(inputs.length)

  // Queue of jobs (each job is a proof generation task)
  const jobs: Job[] = inputs.map((input, i) => ({ id: i, input }))

  // Convert BigInt fields to strings for IPC safety
  const sanitize = (v: any): any => {
    if (typeof v === 'bigint') return v.toString()
    if (Array.isArray(v)) return v.map(sanitize)
    if (v && typeof v === 'object') {
      const out: any = {}
      for (const k of Object.keys(v)) out[k] = sanitize(v[k])
      return out
    }
    return v
  }

  // top-level log to show pool configuration
  info(
    `Prover pool start: inputs=${inputs.length}, concurrency=${concurrency}`,
    'PROVER',
  )
  if (opts?.phase) incProverJobs(inputs.length, opts.phase)

  let rejectOnce: (e: any) => void
  const done = new Promise<void>((resolve, reject) => {
    let active = 0
    let finished = 0
    rejectOnce = reject

    const spawnNext = () => {
      if (jobs.length === 0) {
        if (active === 0) resolve()
        return
      }
      // Spawn at most `concurrency` children
      while (active < concurrency && jobs.length > 0) {
        const child = createChild()
        const job = jobs.shift()!
        active++
        incProverActiveChildren()
        debug(
          `Spawn prover child pid=${child.pid} for job=${job.id} (active=${active}/${concurrency})`,
          'PROVER',
        )

        const onMessage = (m: any) => {
          if (m?.type === 'result' && m.jobId === job.id) {
            results[job.id] = m.proofHex
            debug(`Child finished job=${job.id} pid=${child.pid}`, 'PROVER')
            cleanup()
          } else if (m?.type === 'error' && m.jobId === job.id) {
            cleanup(new Error(m.error))
          }
        }

        const onError = (err: any) => cleanup(err)
        const onExit = (code: number | null, signal: string | null) => {
          if (code !== 0 && code !== null) {
            cleanup(
              new Error(
                `prover child exited with code ${code}${signal ? `, signal ${signal}` : ''}`,
              ),
            )
          }
        }

        const cleanup = (err?: any) => {
          child.off('message', onMessage)
          child.off('error', onError)
          child.off('exit', onExit)
          try {
            child.disconnect()
          } catch {}
          try {
            child.kill()
          } catch {}
          active--
          decProverActiveChildren()
          if (err) {
            reject(err)
            return
          }
          finished++
          if (finished === inputs.length) {
            resolve()
          } else {
            spawnNext()
          }
        }

        child.on('message', onMessage)
        child.on('error', onError)
        child.on('exit', onExit)
        child.send({
          type: 'prove',
          jobId: job.id,
          wasmPath,
          zkeyPath,
          input: sanitize(job.input),
        })
      }
    }

    spawnNext()
  })

  await done
  return results
}
