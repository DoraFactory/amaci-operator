const queues = new Map<string, Promise<void>>()

export async function withTxLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  queues.set(key, current)
  // Wait previous in-flight txs for the same key (address)
  await prev.catch(() => {})
  try {
    return await fn()
  } finally {
    release()
    // If no one chained after us, clear the key
    if (queues.get(key) === current) queues.delete(key)
  }
}

