import { groth16 } from 'snarkjs'
import fs from 'fs'
import { adaptToUncompressed } from '../vota/adapt'

type ProveMessage = {
  type: 'prove'
  jobId: number
  wasmPath: string
  zkeyPath: string
  input: any
}

type DropExceptMessage = {
  type: 'drop_except'
  keep: string[]
}

type ResultMessage = {
  type: 'result'
  jobId: number
  proofHex: { a: string; b: string; c: string }
}

type StartedMessage = {
  type: 'started'
  jobId: number
}

type ErrorMessage = {
  type: 'error'
  jobId: number
  error: string
}

const wasmCache = new Map<string, Uint8Array>()
const zkeyCache = new Map<string, Uint8Array>()

async function loadCached(pathname: string, cache: Map<string, Uint8Array>) {
  if (cache.has(pathname)) return cache.get(pathname)!
  const buff = await fs.promises.readFile(pathname)
  // Convert Buffer view to Uint8Array view without copy
  const u8 = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength)
  cache.set(pathname, u8)
  return u8
}

process.on('message', async (msg: ProveMessage | DropExceptMessage) => {
  if (!msg || msg.type !== 'prove') return
  const { jobId, input, wasmPath, zkeyPath } = msg
  try {
    // notify parent this job has actually started (for accurate timing)
    try {
      const started: StartedMessage = { type: 'started', jobId }
      process.send && process.send(started)
    } catch {}
    // Load wasm/zkey once and reuse to reduce I/O
    const wasmData = await loadCached(wasmPath, wasmCache)
    const zkeyData = await loadCached(zkeyPath, zkeyCache)
    const { proof } = await groth16.fullProve(
      input as any,
      wasmData as any,
      zkeyData as any,
    )
    const proofHex = await adaptToUncompressed(proof)
    const res: ResultMessage = { type: 'result', jobId, proofHex }
    process.send && process.send(res)
  } catch (e: any) {
    const err: ErrorMessage = {
      type: 'error',
      jobId,
      error: e instanceof Error ? e.message : String(e),
    }
    process.send && process.send(err)
  }
})

// Support dropping caches to control memory footprint
process.on('message', (msg: ProveMessage | DropExceptMessage) => {
  if (!msg || msg.type !== 'drop_except') return
  const keep = new Set(msg.keep)
  for (const key of Array.from(wasmCache.keys())) {
    if (!keep.has(key)) wasmCache.delete(key)
  }
  for (const key of Array.from(zkeyCache.keys())) {
    if (!keep.has(key)) zkeyCache.delete(key)
  }
})
