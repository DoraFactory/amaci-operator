import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

import { info, warn } from '../logger'
import { fetchRound } from './indexer'

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.useRealTimers()
  delete process.env.INDEXER_ENDPOINTS
  delete process.env.INDEXER_HEIGHT_CHECK_ENABLED
  delete process.env.INDEXER_HEIGHT_CHECK_INTERVAL_MS
  delete process.env.INDEXER_HEIGHT_LAG_THRESHOLD
})

describe('indexer health logging', () => {
  it('logs the endpoint used by a successful indexer request', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://success-log.test/graphql',
    ])
    process.env.INDEXER_HEIGHT_CHECK_ENABLED = '0'

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: {
            round: {
              id: 'round-success-log',
              period: 'Voting',
            },
          },
        }),
      ),
    )

    await fetchRound('round-success-log')

    const successes = vi
      .mocked(info)
      .mock.calls.filter(([message]) =>
        String(message).includes(
          'Indexer request succeeded for fetch_round: endpoint=https://success-log.test/graphql',
        ),
      )
    expect(successes).toHaveLength(1)
  })

  it('deduplicates repeated height lag warnings and logs recovery', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://health-log.test/graphql',
    ])
    process.env.INDEXER_HEIGHT_CHECK_ENABLED = '1'
    process.env.INDEXER_HEIGHT_CHECK_INTERVAL_MS = '1'
    process.env.INDEXER_HEIGHT_LAG_THRESHOLD = '10'
    vi.useFakeTimers()

    let healthy = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))

        if (body.query.includes('_metadata')) {
          return jsonResponse({
            data: {
              _metadata: {
                lastProcessedHeight: healthy ? 100 : 80,
                targetHeight: 100,
                indexerHealthy: true,
                chain: 'test',
              },
            },
          })
        }

        return jsonResponse({
          data: {
            round: {
              id: 'round-health-log',
              period: 'Voting',
            },
          },
        })
      }),
    )

    await fetchRound('round-health-log')
    vi.advanceTimersByTime(1001)
    await fetchRound('round-health-log')

    const lagWarnings = vi
      .mocked(warn)
      .mock.calls.filter(([message]) =>
        String(message).includes('Indexer height lag detected'),
      )
    expect(lagWarnings).toHaveLength(1)

    healthy = true
    vi.advanceTimersByTime(1001)
    await fetchRound('round-health-log')

    const recoveries = vi
      .mocked(info)
      .mock.calls.filter(([message]) =>
        String(message).includes('Indexer recovered'),
      )
    expect(recoveries).toHaveLength(1)
  })
})
