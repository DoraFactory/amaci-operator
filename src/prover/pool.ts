import { fork, ChildProcess } from 'node:child_process'
import path from 'path'
import { info, debug } from '../logger'
import {
  incProverActiveChildren,
  decProverActiveChildren,
  incProverJobs,
  setProverPoolSize,
} from '../metrics'

export type ProofHex = { a: string; b: string; c: string }

const DEFAULT_CONCURRENCY = Math.max(
  1,
  Number(process.env.PROVER_CONCURRENCY || 2),
)

type InternalJob = {
  id: number
  input: any
  wasmPath: string
  zkeyPath: string
  resolve: (p: ProofHex) => void
  reject: (e: any) => void
  phase?: string
  absIndex?: number
  startTime?: number
}

class ProverPool {
  private children: ChildProcess[] = []
  private idle: ChildProcess[] = []
  private active = new Map<number, InternalJob>() // pid -> job
  private queue: InternalJob[] = []
  private closing = false

  constructor(private maxChildren: number) {
    this.maxChildren = Math.max(1, maxChildren)
    info(`Initialize prover pool with size=${this.maxChildren}`, 'PROVER')
    for (let i = 0; i < this.maxChildren; i++) this.spawnChild()
    setProverPoolSize(this.children.length)

    const cleanup = () => this.shutdown()
    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)
  }

  getSize() {
    return this.maxChildren
  }

  submit(job: InternalJob) {
    this.queue.push(job)
    this.schedule()
  }

  // Hint children to keep only specified wasm/bin/zkey in caches
  prepareForPhase(wasmPath: string, zkeyPath: string) {
    const keep = [wasmPath, zkeyPath]
    for (const child of this.children) {
      try {
        child.send({ type: 'drop_except', keep })
      } catch {}
    }
  }

  private sanitize(v: any): any {
    if (typeof v === 'bigint') return v.toString()
    if (Array.isArray(v)) return v.map((x) => this.sanitize(x))
    if (v && typeof v === 'object') {
      const out: any = {}
      for (const k of Object.keys(v)) out[k] = this.sanitize(v[k])
      return out
    }
    return v
  }

  private spawnChild() {
    const childPath = path.join(__dirname, 'child.js')
    const child = fork(childPath, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })
    debug(`Spawned prover child pid=${child.pid}`, 'PROVER')

    child.on('exit', (code: number | null, signal: string | null) => {
      debug(
        `Child exit pid=${child.pid} code=${code} signal=${signal || ''}`,
        'PROVER',
      )
      const job = this.active.get(child.pid!)
      if (job) {
        this.active.delete(child.pid!)
        this.queue.unshift(job)
        decProverActiveChildren()
      }
      this.children = this.children.filter((c) => c !== child)
      this.idle = this.idle.filter((c) => c !== child)
      if (!this.closing) {
        this.spawnChild()
        setProverPoolSize(this.children.length)
        this.schedule()
      }
    })
    child.on('error', (err) => {
      debug(`Child error pid=${child.pid} ${String(err)}`, 'PROVER')
    })
    child.on('message', (m: any) => this.onMessage(child, m))

    this.children.push(child)
    this.idle.push(child)
  }

  private onMessage(child: ChildProcess, m: any) {
    const job = this.active.get(child.pid!)
    if (!job) return
    if (m?.type === 'started') {
      // mark actual start time when child begins work
      job.startTime = Date.now()
      return
    }
    if (m?.type === 'result') {
      try {
        job.resolve(m.proofHex as ProofHex)
        // log per-proof duration based on actual start
        if (job.startTime) {
          const dt = Date.now() - job.startTime
          const phase = (job.phase || 'proof').toUpperCase()
          const idx = job.absIndex ?? job.id
          info(`Generated ${phase} proof #${idx} in ${dt}ms`, 'PROVER')
        }
      } finally {
        this.finishJob(child)
      }
    } else if (m?.type === 'error') {
      try {
        job.reject(new Error(String(m.error)))
      } finally {
        this.finishJob(child)
      }
    }
  }

  private finishJob(child: ChildProcess) {
    this.active.delete(child.pid!)
    decProverActiveChildren()
    if (!this.closing) {
      this.idle.push(child)
      this.schedule()
    } else {
      try {
        child.removeAllListeners('message')
        child.disconnect()
        child.kill()
      } catch {}
    }
  }

  private schedule() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const child = this.idle.shift()!
      const job = this.queue.shift()!
      this.active.set(child.pid!, job)
      incProverActiveChildren()
      child.send({
        type: 'prove',
        jobId: job.id,
        wasmPath: job.wasmPath,
        zkeyPath: job.zkeyPath,
        input: this.sanitize(job.input),
      })
      debug(`Assign job=${job.id} to pid=${child.pid}`, 'PROVER')
    }
  }

  shutdown() {
    if (this.closing) return
    this.closing = true
    debug('Shutting down prover pool', 'PROVER')
    while (this.queue.length) {
      const j = this.queue.shift()!
      j.reject(new Error('Prover pool shutting down'))
    }
    for (const child of this.children) {
      try {
        child.removeAllListeners('message')
        child.disconnect()
        child.kill()
      } catch {}
    }
    this.children = []
    this.idle = []
    this.active.clear()
    setProverPoolSize(0)
  }
}

let singletonPool: ProverPool | null = null

function getPool(desired?: number) {
  const size = Math.max(1, desired || DEFAULT_CONCURRENCY)
  if (!singletonPool) {
    singletonPool = new ProverPool(size)
  } else if (singletonPool.getSize() !== size) {
    singletonPool.shutdown()
    singletonPool = new ProverPool(size)
  }
  return singletonPool
}

export async function proveMany(
  inputs: any[],
  wasmPath: string,
  zkeyPath: string,
  opts?: { concurrency?: number; phase?: string; baseIndex?: number },
): Promise<ProofHex[]> {
  if (inputs.length === 0) return []
  const pool = getPool(opts?.concurrency)
  // Phase-level cache hint to reduce memory
  pool.prepareForPhase(wasmPath, zkeyPath)
  info(
    `Prover pool start: inputs=${inputs.length}, concurrency=${Math.max(
      1,
      opts?.concurrency || DEFAULT_CONCURRENCY,
    )}`,
    'PROVER',
  )
  if (opts?.phase) incProverJobs(inputs.length, opts.phase)
  const results: ProofHex[] = new Array(inputs.length)
  const base = opts?.baseIndex || 0
  await Promise.all(
    inputs.map(
      (input, i) =>
        new Promise<void>((resolve, reject) => {
          pool.submit({
            id: i,
            input,
            wasmPath,
            zkeyPath,
            phase: opts?.phase,
            absIndex: base + i,
            resolve: (p) => {
              results[i] = p
              resolve()
            },
            reject,
          })
        }),
    ),
  )
  return results
}
