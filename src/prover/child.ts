import { dropCacheExcept, generateProof } from './prove'

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

process.on('message', async (msg: ProveMessage | DropExceptMessage) => {
  if (!msg || msg.type !== 'prove') return
  const { jobId, input, wasmPath, zkeyPath } = msg
  try {
    // notify parent this job has actually started (for accurate timing)
    try {
      const started: StartedMessage = { type: 'started', jobId }
      process.send && process.send(started)
    } catch {}
    const proofHex = await generateProof(input, wasmPath, zkeyPath)
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
  dropCacheExcept(msg.keep)
})
