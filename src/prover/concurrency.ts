type CircuitConcurrencyMap = Record<string, number>

let cachedMap: CircuitConcurrencyMap | null = null

const normalizeCircuitKey = (value: string) => {
  if (value.endsWith('_v3')) return value.slice(0, -3)
  return value
}

const loadCircuitConcurrencyMap = (): CircuitConcurrencyMap => {
  const raw = process.env.PROVER_CONCURRENCY_BY_CIRCUIT
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: CircuitConcurrencyMap = {}
    for (const [key, val] of Object.entries(parsed)) {
      const num = Number(val)
      if (Number.isFinite(num) && num > 0) {
        out[String(key)] = Math.floor(num)
      }
    }
    return out
  } catch {
    return {}
  }
}

export const getProverConcurrency = (circuitPower: string) => {
  if (!cachedMap) cachedMap = loadCircuitConcurrencyMap()
  const key = normalizeCircuitKey(circuitPower)
  const mapped = cachedMap[key] ?? cachedMap[circuitPower]
  if (mapped && mapped > 0) return mapped
  const fallback = Number(process.env.PROVER_CONCURRENCY || 2)
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 1
}
