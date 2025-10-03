import { groth16 } from 'snarkjs'
import { adaptToUncompressed } from '../vota/adapt'

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

process.on('message', async (msg: ProveMessage) => {
  if (!msg || msg.type !== 'prove') return
  const { jobId, input, wasmPath, zkeyPath } = msg
  try {
    const { proof } = await groth16.fullProve(input, wasmPath, zkeyPath)
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
