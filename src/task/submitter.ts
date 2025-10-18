import { withBroadcastRetry } from '../lib/client/utils'
import { info } from '../logger'

type SubmitterOptions = {
  batchLimit: number
  contextBatch: string
  contextSingle: string
  phaseLabel: 'MSG' | 'TALLY' | 'DEACTIVATE'
  shouldStop?: (err: any) => boolean
}

export type Submitter<T> = {
  enqueue(items: T[]): void
  close(): Promise<void>
}

/**
 * Create a background submitter that consumes queued items and submits them in batches,
 * degrading to smaller size and finally single submission when needed. Only one worker
 * is used to avoid sequence conflicts.
 */
export function createSubmitter<T>(
  submitBatch: (items: T[]) => Promise<{ transactionHash?: string }>,
  submitSingle: (item: T) => Promise<{ transactionHash?: string }>,
  opts: SubmitterOptions,
): Submitter<T> {
  const queue: T[] = []
  let closed = false
  let forceStop = false
  let wake: (() => void) | null = null
  let doneResolve: (() => void) | null = null
  const done = new Promise<void>((resolve) => (doneResolve = resolve))

  const notify = () => {
    if (wake) {
      wake()
      wake = null
    }
  }

  const waitForItems = async () => {
    if (queue.length > 0) return
    if (closed || forceStop) return
    await new Promise<void>((resolve) => (wake = resolve))
  }

  const worker = async () => {
    try {
      while (true) {
        await waitForItems()
        if ((queue.length === 0 && closed) || forceStop) break
        if (queue.length === 0) continue

        // take up to batchLimit items
        const take = Math.min(opts.batchLimit, queue.length)
        const group = queue.splice(0, take)

        // process entire group with degrade logic until all are submitted
        let index = 0
        while (index < group.length) {
          let attemptSize = group.length - index
          // try decreasing sizes until success
          while (true) {
            const slice = group.slice(index, index + attemptSize)
            try {
              const res = await withBroadcastRetry(() => submitBatch(slice), {
                context: opts.contextBatch,
                maxRetries: 3,
              })
              info(
                `Processed ${opts.phaseLabel} batch (count=${slice.length}) ✅ tx=${res.transactionHash}`,
                `${opts.phaseLabel}-TASK`,
              )
              index += attemptSize
              break
            } catch (e) {
              if (opts.shouldStop && opts.shouldStop(e)) {
                // terminal condition: stop further submissions
                forceStop = true
                // drain queue
                queue.splice(0, queue.length)
                break
              }
              if (attemptSize === 1) {
                const single = group[index]
                try {
                  const res = await withBroadcastRetry(() => submitSingle(single), {
                    context: opts.contextSingle,
                    maxRetries: 3,
                  })
                  info(
                    `Processed ${opts.phaseLabel} #${index} ✅ tx=${res.transactionHash}`,
                    `${opts.phaseLabel}-TASK`,
                  )
                  index += 1
                  break
                } catch (e2) {
                  if (opts.shouldStop && opts.shouldStop(e2)) {
                    forceStop = true
                    queue.splice(0, queue.length)
                    break
                  }
                  // if single failed and not terminal, skip this item to avoid infinite loop
                  info(`Skipping ${opts.phaseLabel} item at #${index} due to error`, `${opts.phaseLabel}-TASK`)
                  index += 1
                  break
                }
              } else {
                attemptSize = Math.floor(attemptSize / 2)
                if (attemptSize < 1) attemptSize = 1
              }
            }
          }
        }
      }
    } finally {
      doneResolve && doneResolve()
    }
  }

  // start worker
  worker()

  return {
    enqueue(items: T[]) {
      if (!items || items.length === 0) return
      queue.push(...items)
      notify()
    },
    async close() {
      closed = true
      notify()
      await done
    },
  }
}
