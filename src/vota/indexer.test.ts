import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAllVotesLogs,
  fetchRound,
  fetchRounds,
  mergeRoundsById,
} from './indexer'

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const pageResponse = (key: string, nodes: unknown[]) =>
  jsonResponse({
    data: {
      [key]: {
        nodes,
        pageInfo: { hasNextPage: false },
      },
    },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.INDEXER_ENDPOINTS
  delete process.env.INDEXER_HEIGHT_CHECK_ENABLED
  delete process.env.INDEXER_HEIGHT_CHECK_INTERVAL_MS
  delete process.env.INDEXER_HEIGHT_LAG_THRESHOLD
  delete process.env.RPC_ENDPOINT
})

describe('mergeRoundsById', () => {
  it('deduplicates rounds by id across repeated lookups', () => {
    const rounds = mergeRoundsById([
      { id: 'round-1', period: 'Voting' } as any,
      { id: 'round-1', period: 'Processing' } as any,
      { id: 'round-2', period: 'Pending' } as any,
    ])

    expect(rounds).toHaveLength(2)
    expect(rounds.find((round) => round.id === 'round-1')?.period).toBe(
      'Processing',
    )
    expect(rounds.find((round) => round.id === 'round-2')?.period).toBe(
      'Pending',
    )
  })
})

describe('indexer failover', () => {
  it('uses the next endpoint when fetchRound fails on the active endpoint', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://primary-round.test/graphql',
      'https://backup-round.test/graphql',
    ])

    const endpoints: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        endpoints.push(url)
        if (url.includes('primary-round')) {
          return new Response('bad gateway', { status: 502 })
        }
        return jsonResponse({
          data: {
            round: {
              id: 'round-1',
              period: 'Voting',
            },
          },
        })
      }),
    )

    const round = await fetchRound('round-1')

    expect(round.id).toBe('round-1')
    expect(endpoints).toEqual([
      'https://primary-round.test/graphql',
      'https://backup-round.test/graphql',
    ])
  })

  it('uses the next endpoint when fetchRound returns no round data', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://stale-round.test/graphql',
      'https://fresh-round.test/graphql',
    ])

    const endpoints: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        endpoints.push(url)
        if (url.includes('stale-round')) {
          return jsonResponse({ data: { round: null } })
        }
        return jsonResponse({
          data: {
            round: {
              id: 'round-2',
              period: 'Voting',
            },
          },
        })
      }),
    )

    const round = await fetchRound('round-2')

    expect(round.id).toBe('round-2')
    expect(endpoints).toEqual([
      'https://stale-round.test/graphql',
      'https://fresh-round.test/graphql',
    ])
  })

  it('skips a height-lagged endpoint before fetching round data', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://lagged-round.test/graphql',
      'https://healthy-round.test/graphql',
    ])
    process.env.INDEXER_HEIGHT_CHECK_ENABLED = '1'
    process.env.INDEXER_HEIGHT_LAG_THRESHOLD = '10'

    const roundEndpoints: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))

        if (body.query.includes('_metadata')) {
          if (url.includes('lagged-round')) {
            return jsonResponse({
              data: {
                _metadata: {
                  lastProcessedHeight: 80,
                  targetHeight: 100,
                  indexerHealthy: true,
                  chain: 'test',
                },
              },
            })
          }
          return jsonResponse({
            data: {
              _metadata: {
                lastProcessedHeight: 99,
                targetHeight: 100,
                indexerHealthy: true,
                chain: 'test',
              },
            },
          })
        }

        roundEndpoints.push(url)
        return jsonResponse({
          data: {
            round: {
              id: 'round-3',
              period: 'Voting',
            },
          },
        })
      }),
    )

    const round = await fetchRound('round-3')

    expect(round.id).toBe('round-3')
    expect(roundEndpoints).toEqual(['https://healthy-round.test/graphql'])
  })

  it('fetches rounds from the active endpoint without fanning out to backups', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://primary-rounds.test/graphql',
      'https://backup-rounds.test/graphql',
    ])

    const endpoints: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        endpoints.push(url)
        if (url.includes('backup-rounds')) {
          throw new Error('backup should not be queried when active succeeds')
        }

        const body = JSON.parse(String(init.body))
        if (body.query.includes('rounds')) {
          return pageResponse('rounds', [
            { id: 'round-active', period: 'Voting' },
          ])
        }

        throw new Error('unexpected query')
      }),
    )

    const rounds = await fetchRounds(['pub-x', 'pub-y'])

    expect(rounds.map((round) => round.id)).toEqual(['round-active'])
    expect(endpoints).toEqual(['https://primary-rounds.test/graphql'])
  })

  it('fetches rounds from the next endpoint only after the active endpoint fails', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://primary-rounds-fail.test/graphql',
      'https://backup-rounds-ok.test/graphql',
    ])

    const endpoints: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        endpoints.push(url)
        if (url.includes('primary-rounds-fail')) {
          return new Response('bad gateway', { status: 502 })
        }

        const body = JSON.parse(String(init.body))
        if (body.query.includes('rounds')) {
          return pageResponse('rounds', [
            { id: 'round-backup', period: 'Voting' },
          ])
        }

        throw new Error('unexpected query')
      }),
    )

    const rounds = await fetchRounds(['pub-x', 'pub-y'])

    expect(rounds.map((round) => round.id)).toEqual(['round-backup'])
    expect(endpoints).toEqual([
      'https://primary-rounds-fail.test/graphql',
      'https://backup-rounds-ok.test/graphql',
    ])
  })

  it('restarts a full log snapshot on the next endpoint after a page failure', async () => {
    process.env.INDEXER_ENDPOINTS = JSON.stringify([
      'https://primary-logs.test/graphql',
      'https://backup-logs.test/graphql',
    ])

    const calls: Array<{ endpoint: string; query: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body))
        calls.push({ endpoint: url, query: body.query })

        if (
          url.includes('primary-logs') &&
          body.query.includes('publishMessageEvents')
        ) {
          return new Response('upstream error', { status: 503 })
        }

        if (body.query.includes('signUpEvents')) {
          return pageResponse('signUpEvents', [
            { id: `${url}-signup`, stateIdx: 1 },
          ])
        }
        if (body.query.includes('publishMessageEvents')) {
          return pageResponse('publishMessageEvents', [
            { id: `${url}-msg`, msgChainLength: 1 },
          ])
        }
        if (body.query.includes('publishDeactivateMessageEvents')) {
          return pageResponse('publishDeactivateMessageEvents', [
            { id: `${url}-dmsg`, dmsgChainLength: 1 },
          ])
        }

        throw new Error('unexpected query')
      }),
    )

    const logs = await fetchAllVotesLogs('round-1')

    expect(logs.indexerEndpoint).toBe('https://backup-logs.test/graphql')
    expect(logs.signup[0].id).toBe('https://backup-logs.test/graphql-signup')
    expect(logs.msg[0].id).toBe('https://backup-logs.test/graphql-msg')
    expect(logs.dmsg[0].id).toBe('https://backup-logs.test/graphql-dmsg')
    expect(calls.map((call) => call.endpoint)).toEqual([
      'https://primary-logs.test/graphql',
      'https://primary-logs.test/graphql',
      'https://backup-logs.test/graphql',
      'https://backup-logs.test/graphql',
      'https://backup-logs.test/graphql',
    ])
  })
})
