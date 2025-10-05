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
  inputs?: {
    msgInputs?: any[]
    tallyInputs?: any[]
    dMsgInputs?: { input: any; size: string }[]
    // for deactivate upload history
    newDeactivates?: any[]
  }
  inputsSig?: string
}

const VERSION = 1

function getCachePath(id: string) {
  const cacheDir = path.join(process.env.WORK_PATH || './work', 'cache')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  return path.join(cacheDir, id + '.json')
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
    inputs: prev?.inputs,
    inputsSig: update.inputsSig ?? prev?.inputsSig,
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

  // overwrite inputs fully if provided (they are deterministic for a signature)
  if (update.inputs) {
    merged.inputs = sanitizeInputs(update.inputs)
  }

  const json = JSON.stringify(merged)
  atomicWrite(file, json)
}

function sanitizeInputs(inputs: ProofCache['inputs']): ProofCache['inputs'] {
  const toStr = (v: any): any => {
    if (typeof v === 'bigint') return v.toString()
    if (Array.isArray(v)) return v.map(toStr)
    if (v && typeof v === 'object') {
      const out: any = {}
      for (const k of Object.keys(v)) out[k] = toStr(v[k])
      return out
    }
    return v
  }
  if (!inputs) return inputs
  return {
    msgInputs: inputs.msgInputs ? toStr(inputs.msgInputs) : undefined,
    tallyInputs: inputs.tallyInputs ? toStr(inputs.tallyInputs) : undefined,
    dMsgInputs: inputs.dMsgInputs ? toStr(inputs.dMsgInputs) : undefined,
    newDeactivates: inputs.newDeactivates
      ? toStr(inputs.newDeactivates)
      : undefined,
  }
}

export function buildInputsSignature(args: {
  circuitPower: string
  circuitType: string | number
  maxVoteOptions: number
  signupCount: number
  lastSignupId?: string
  msgCount: number
  lastMsgId?: string
  dmsgCount: number
  lastDmsgId?: string
  processedDMsgCount?: number
}): string {
  const parts = [
    String(args.circuitPower),
    String(args.circuitType),
    String(args.maxVoteOptions),
    `su:${args.signupCount}:${args.lastSignupId || ''}`,
    `m:${args.msgCount}:${args.lastMsgId || ''}`,
    `dm:${args.dmsgCount}:${args.lastDmsgId || ''}`,
    `pdc:${args.processedDMsgCount ?? ''}`,
  ]
  return parts.join('|')
}
