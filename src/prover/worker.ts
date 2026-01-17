import { parentPort } from 'node:worker_threads'
import { generateProof } from './prove'

type ProveMessage = {
  type: 'prove'
  jobId: number
  wasmPath: string
  zkeyPath: string
  input: any
}

type ResultMessage = {
  type: 'result'
  jobId: number
  proofHex: { a: string; b: string; c: string }
}

type ErrorMessage = {
  type: 'error'
  jobId: number
  error: string
}

if (!parentPort) {
  throw new Error('Worker must be started as a worker thread')
}

parentPort.on('message', async (msg: ProveMessage) => {
  if (!msg || msg.type !== 'prove') return
  const { jobId, input, wasmPath, zkeyPath } = msg
  try {
    const proofHex = await generateProof(input, wasmPath, zkeyPath)

    // Send back the result to the main thread
    const res: ResultMessage = { type: 'result', jobId, proofHex }
    parentPort!.postMessage(res)
  } catch (e: any) {
    const err: ErrorMessage = {
      type: 'error',
      jobId,
      error: e instanceof Error ? e.message : String(e),
    }
    parentPort!.postMessage(err)
  }
})
