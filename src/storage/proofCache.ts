import fs from 'fs'
import path from 'path'
import { ProofData } from '../types'

export type DeactivateProof = ProofData & { root: string; size: string }

export interface ProofCache {
  version: number
  id: string
  circuitPower?: string
  createdAt: number
  updatedAt: number
  result?: string[]
  salt?: string
  msg?: { proofs: ProofData[] }
  tally?: { proofs: ProofData[] }
  deactivate?: { proofs: DeactivateProof[] }
}

const VERSION = 1

function getCachePath(id: string) {
  const inputsPath = path.join(process.env.WORK_PATH || './work', 'inputs')
  if (!fs.existsSync(inputsPath)) fs.mkdirSync(inputsPath, { recursive: true })
  return path.join(inputsPath, id + '.json')
}

export function loadProofCache(id: string): ProofCache | undefined {
  const file = getCachePath(id)
  if (!fs.existsSync(file)) return undefined
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return undefined
    // basic sanity
    if (!data.version || !data.id) return undefined
    return data as ProofCache
  } catch {
    return undefined
  }
}

function atomicWrite(file: string, data: string) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function saveProofCache(id: string, update: Partial<ProofCache>) {
  const file = getCachePath(id)
  const prev = loadProofCache(id)
  const now = Date.now()
  const merged: ProofCache = {
    version: VERSION,
    id,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    circuitPower: update.circuitPower ?? prev?.circuitPower,
    result: update.result ?? prev?.result,
    salt: update.salt ?? prev?.salt,
    msg: { proofs: [] },
    tally: { proofs: [] },
    deactivate: { proofs: [] },
  }
  // merge arrays by taking the longer one
  const msgA = (prev?.msg?.proofs || [])
  const msgB = (update.msg?.proofs || [])
  merged.msg = { proofs: msgB.length >= msgA.length ? msgB : msgA }

  const tallyA = (prev?.tally?.proofs || [])
  const tallyB = (update.tally?.proofs || [])
  merged.tally = { proofs: tallyB.length >= tallyA.length ? tallyB : tallyA }

  const dA = (prev?.deactivate?.proofs || [])
  const dB = (update.deactivate?.proofs || [])
  merged.deactivate = { proofs: dB.length >= dA.length ? dB : dA }

  const json = JSON.stringify(merged)
  atomicWrite(file, json)
}

