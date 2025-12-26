import fs from 'fs'
import path from 'path'

export type RoundStatusEntry = {
  status: 'tally_completed'
  completedAt: number
  txHash?: string
}

type RoundStatusMap = Record<string, RoundStatusEntry>

const MAX_ENTRIES = 100

function getStatusPath() {
  const dir = path.join(process.env.WORK_PATH || './work', 'data')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'round-status.json')
}

function atomicWrite(file: string, data: string) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

export function loadRoundStatus(): RoundStatusMap {
  const file = getStatusPath()
  if (!fs.existsSync(file)) return {}
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return {}
    return data as RoundStatusMap
  } catch {
    return {}
  }
}

function pruneRoundStatus(map: RoundStatusMap): RoundStatusMap {
  const entries = Object.entries(map)
  if (entries.length <= MAX_ENTRIES) return map
  entries.sort((a, b) => (b[1].completedAt || 0) - (a[1].completedAt || 0))
  const keep = entries.slice(0, MAX_ENTRIES)
  const out: RoundStatusMap = {}
  for (const [id, entry] of keep) out[id] = entry
  return out
}

export function saveRoundStatus(map: RoundStatusMap) {
  const file = getStatusPath()
  const pruned = pruneRoundStatus(map)
  atomicWrite(file, JSON.stringify(pruned))
}

export function markRoundTallyCompleted(
  roundId: string,
  info?: { txHash?: string },
) {
  const map = loadRoundStatus()
  map[roundId] = {
    status: 'tally_completed',
    completedAt: Date.now(),
    txHash: info?.txHash,
  }
  saveRoundStatus(map)
}
