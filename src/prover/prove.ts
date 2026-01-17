import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import fs from 'fs'
import { groth16, wtns } from 'snarkjs'
import { info } from '../logger'
import { adaptToUncompressed } from '../vota/adapt'

export type ProofHex = { a: string; b: string; c: string }

const execFileAsync = promisify(execFile)

const wasmCache = new Map<string, Uint8Array>()
const zkeyCache = new Map<string, Uint8Array>()
const largeFiles = new Set<string>()
const MAX_IN_MEMORY_BYTES = 2 * 1024 * 1024 * 1024 - 1

const getBackend = () => (process.env.PROVER_BACKEND || 'snarkjs').toLowerCase()
const getRapidsnarkPath = () =>
  (process.env.RAPIDSNARK_PATH || 'rapidsnark').trim() || 'rapidsnark'
let loggedBackend = false

function logBackendOnce() {
  if (loggedBackend) return
  loggedBackend = true
  const backend = getBackend()
  if (backend === 'rapidsnark') {
    info(`Prover backend=rapidsnark path=${getRapidsnarkPath()}`, 'PROVER')
  } else {
    info('Prover backend=snarkjs', 'PROVER')
  }
}

async function loadCached(
  pathname: string,
  cache: Map<string, Uint8Array>,
): Promise<Uint8Array | string> {
  if (cache.has(pathname)) return cache.get(pathname)!
  if (largeFiles.has(pathname)) return pathname
  const stat = await fs.promises.stat(pathname)
  if (stat.size >= MAX_IN_MEMORY_BYTES) {
    largeFiles.add(pathname)
    return pathname
  }
  const buff = await fs.promises.readFile(pathname)
  // Convert Buffer view to Uint8Array view without copy
  const u8 = new Uint8Array(buff.buffer, buff.byteOffset, buff.byteLength)
  cache.set(pathname, u8)
  return u8
}

export function dropCacheExcept(keep: string[]) {
  const keepSet = new Set(keep)
  for (const key of Array.from(wasmCache.keys())) {
    if (!keepSet.has(key)) wasmCache.delete(key)
  }
  for (const key of Array.from(zkeyCache.keys())) {
    if (!keepSet.has(key)) zkeyCache.delete(key)
  }
}

function sanitizeForJson(value: any): any {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((v) => sanitizeForJson(v))
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const k of Object.keys(value)) out[k] = sanitizeForJson(value[k])
    return out
  }
  return value
}

function normalizeProof(proof: any) {
  const p = proof?.proof ? proof.proof : proof
  if (p?.pi_a && p?.pi_b && p?.pi_c) return p
  if (p?.a && p?.b && p?.c) {
    return { pi_a: p.a, pi_b: p.b, pi_c: p.c }
  }
  return p
}

async function proveWithSnarkjs(
  input: any,
  wasmPath: string,
  zkeyPath: string,
): Promise<ProofHex> {
  const wasmData = await loadCached(wasmPath, wasmCache)
  const zkeyData = await loadCached(zkeyPath, zkeyCache)
  const { proof } = await groth16.fullProve(
    input as any,
    wasmData as any,
    zkeyData as any,
  )
  return adaptToUncompressed(proof)
}

async function proveWithRapidsnark(
  input: any,
  wasmPath: string,
  zkeyPath: string,
): Promise<ProofHex> {
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'amaci-rapidsnark-'),
  )
  const wtnsPath = path.join(tmpDir, 'witness.wtns')
  const proofPath = path.join(tmpDir, 'proof.json')
  const publicPath = path.join(tmpDir, 'public.json')
  const sanitized = sanitizeForJson(input)
  const rapidsnarkPath = getRapidsnarkPath()

  try {
    await wtns.calculate(sanitized, wasmPath, wtnsPath)
    await execFileAsync(rapidsnarkPath, [zkeyPath, wtnsPath, proofPath, publicPath], {
      maxBuffer: 10 * 1024 * 1024,
    })
    const proofJson = JSON.parse(
      await fs.promises.readFile(proofPath, 'utf8'),
    )
    const normalized = normalizeProof(proofJson)
    return adaptToUncompressed(normalized as any)
  } catch (err: any) {
    const stderr = err?.stderr ? String(err.stderr) : ''
    const message = err?.message ? String(err.message) : ''
    const detail = stderr || message
    throw new Error(`rapidsnark prove failed${detail ? `: ${detail}` : ''}`)
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  }
}

export async function generateProof(
  input: any,
  wasmPath: string,
  zkeyPath: string,
): Promise<ProofHex> {
  logBackendOnce()
  if (getBackend() === 'rapidsnark') {
    return proveWithRapidsnark(input, wasmPath, zkeyPath)
  }
  return proveWithSnarkjs(input, wasmPath, zkeyPath)
}
