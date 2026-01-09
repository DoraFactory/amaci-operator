import { warn } from '../logger'

const parseJsonArray = (text: string): unknown[] => {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[')) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      return []
    }
    const out: unknown[] = []
    const walk = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(walk)
        return
      }
      out.push(value)
    }
    walk(parsed)
    return out
  } catch {
    return []
  }
}

const toBigInt = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return null
    }
    return BigInt(value)
  }
  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value)) {
      return null
    }
    return BigInt(value)
  }
  return null
}

export const parseMessageNumbers = (
  raw: string | undefined,
  kind: 'msg' | 'dmsg',
  chainLength: number | undefined,
  context: string,
) => {
  const text = raw || ''
  let numbers = parseJsonArray(text)
    .map(toBigInt)
    .filter((n): n is bigint => n !== null)

  if (numbers.length === 0) {
    const parts = text.match(/-?\d+/g) || []
    numbers = parts.map((part) => BigInt(part))
  }

  if (numbers.length === 0) {
    warn(`Parsed empty ${kind} message`, context, {
      chainLength,
      messageLen: text.length,
      messagePreview: text.slice(0, 200),
    })
  }

  return numbers
}
