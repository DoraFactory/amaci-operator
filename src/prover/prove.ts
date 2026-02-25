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
const binCache = new Map<string, string>()
const zkeyCache = new Map<string, Uint8Array>()
const largeFiles = new Set<string>()
const MAX_IN_MEMORY_BYTES = 2 * 1024 * 1024 * 1024 - 1

type WitnessBackend = 'snarkjs' | 'witnesscalc'

const getBackend = () => (process.env.PROVER_BACKEND || 'snarkjs').toLowerCase()
const getRapidsnarkPath = () =>
  (process.env.RAPIDSNARK_PATH || 'rapidsnark').trim() || 'rapidsnark'
const getWitnesscalcPath = () =>
  (process.env.WITNESSCALC_PATH || '').trim()
const getWitnessBackend = (): WitnessBackend => {
  const backend = (process.env.WITNESS_BACKEND || '').trim().toLowerCase()
  if (backend === 'witnesscalc') return 'witnesscalc'
  if (backend === 'snarkjs') return 'snarkjs'
  // Backward compatibility: old config only set WITNESSCALC_PATH
  return getWitnesscalcPath() ? 'witnesscalc' : 'snarkjs'
}
let loggedBackend = false

function logBackendOnce() {
  if (loggedBackend) return
  loggedBackend = true
  const proverBackend = getBackend()
  const witnessBackend = getWitnessBackend()
  const witnesscalcPath = getWitnesscalcPath()
  if (proverBackend === 'rapidsnark') {
    if (witnessBackend === 'witnesscalc') {
      info(
        `Prover backend=rapidsnark witnessBackend=witnesscalc rapidsnark=${getRapidsnarkPath()} witnesscalc=${witnesscalcPath || '(unset)'}`,
        'PROVER',
      )
    } else {
      info(
        `Prover backend=rapidsnark witnessBackend=snarkjs rapidsnark=${getRapidsnarkPath()}`,
        'PROVER',
      )
    }
  } else {
    if (witnessBackend === 'witnesscalc') {
      info(
        `Prover backend=snarkjs witnessBackend=witnesscalc witnesscalc=${witnesscalcPath || '(unset)'}`,
        'PROVER',
      )
    } else {
      info('Prover backend=snarkjs witnessBackend=snarkjs', 'PROVER')
    }
  }
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await fs.promises.access(pathname, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function resolveWitnessInputPath(
  wasmOrBinPath: string,
  witnessBackend: WitnessBackend,
): Promise<string> {
  if (witnessBackend === 'snarkjs' && wasmOrBinPath.endsWith('.bin')) {
    const wasmPath = wasmOrBinPath.slice(0, -4) + '.wasm'
    if (await pathExists(wasmPath)) return wasmPath
    throw new Error(
      `witness backend=snarkjs requires a .wasm file; missing ${wasmPath}`,
    )
  }

  if (witnessBackend === 'witnesscalc' && wasmOrBinPath.endsWith('.wasm')) {
    const binPath = wasmOrBinPath.slice(0, -5) + '.bin'
    if (await pathExists(binPath)) return binPath
    throw new Error(
      `witness backend=witnesscalc requires a .bin file; missing ${binPath}`,
    )
  }

  return wasmOrBinPath
}

async function generateWitness(
  input: any,
  wasmOrBinPath: string,
  wtnsPath: string,
) {
  const witnessBackend = getWitnessBackend()
  const witnessInputPath = await resolveWitnessInputPath(
    wasmOrBinPath,
    witnessBackend,
  )
  const sanitized = sanitizeForJson(input)

  if (witnessBackend === 'witnesscalc') {
    const witnesscalcPath = getWitnesscalcPath()
    if (!witnesscalcPath) {
      throw new Error(
        'witness backend is witnesscalc but witnesscalcPath is not configured',
      )
    }

    const inputPath = path.join(path.dirname(wtnsPath), 'input.json')
    await fs.promises.writeFile(inputPath, JSON.stringify(sanitized))
    await execFileAsync(witnesscalcPath, [witnessInputPath, inputPath, wtnsPath], {
      maxBuffer: 10 * 1024 * 1024,
    })
    return
  }

  await wtns.calculate(sanitized, witnessInputPath, wtnsPath)
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
  for (const key of Array.from(binCache.keys())) {
    if (!keepSet.has(key)) binCache.delete(key)
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
  // Ensure we have pi_a, pi_b, pi_c format with protocol and curve
  const normalized = {
    pi_a: p?.pi_a || p?.a,
    pi_b: p?.pi_b || p?.b,
    pi_c: p?.pi_c || p?.c,
    protocol: p?.protocol || 'groth16',
    curve: p?.curve || 'bn128',
  }
  return normalized
}

async function proveWithSnarkjs(
  input: any,
  wasmPath: string,
  zkeyPath: string,
): Promise<ProofHex> {
  const witnessBackend = getWitnessBackend()
  if (witnessBackend === 'snarkjs') {
    const snarkjsWasmPath = await resolveWitnessInputPath(wasmPath, 'snarkjs')
    const wasmData = await loadCached(snarkjsWasmPath, wasmCache)
    const zkeyData = await loadCached(zkeyPath, zkeyCache)
    const { proof } = await groth16.fullProve(
      input as any,
      wasmData as any,
      zkeyData as any,
    )
    return adaptToUncompressed(proof)
  }

  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'amaci-snarkjs-'),
  )
  const wtnsPath = path.join(tmpDir, 'witness.wtns')
  try {
    await generateWitness(input, wasmPath, wtnsPath)
    const zkeyData = await loadCached(zkeyPath, zkeyCache)
    const { proof } = await groth16.prove(zkeyData as any, wtnsPath as any)
    return adaptToUncompressed(proof)
  } catch (err: any) {
    const stderr = err?.stderr ? String(err.stderr) : ''
    const message = err?.message ? String(err.message) : ''
    const detail = stderr || message
    throw new Error(`snarkjs prove failed${detail ? `: ${detail}` : ''}`)
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  }
}

async function proveWithRapidsnark(
  input: any,
  wasmOrBinPath: string,
  zkeyPath: string,
): Promise<ProofHex> {
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'amaci-rapidsnark-'),
  )
  const wtnsPath = path.join(tmpDir, 'witness.wtns')
  const proofPath = path.join(tmpDir, 'proof.json')
  const publicPath = path.join(tmpDir, 'public.json')
  const rapidsnarkPath = getRapidsnarkPath()

  try {
    await generateWitness(input, wasmOrBinPath, wtnsPath)

    // Use rapidsnark to generate proof
    await execFileAsync(rapidsnarkPath, [zkeyPath, wtnsPath, proofPath, publicPath], {
      maxBuffer: 10 * 1024 * 1024,
    })

    const proofJson = JSON.parse(await fs.promises.readFile(proofPath, 'utf8'))
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
