import { describe, expect, it } from 'vitest'
import { resolveRoundCircuitArtifacts } from './circuitArtifacts'

const makeClient = ({
  pollId,
  hasVkeys = false,
  pollIdUnsupported = false,
}: {
  pollId?: unknown
  hasVkeys?: boolean
  pollIdUnsupported?: boolean
}) => ({
  contractAddress: 'round-contract',
  client: {
    queryContractSmart: async (_contract: string, query: any) => {
      if (query?.get_vkeys) {
        if (!hasVkeys) {
          throw new Error('unknown request get_vkeys')
        }
        return {
          process_vkey: {},
          tally_vkey: {},
          deactivate_vkey: {},
          add_key_vkey: {},
        }
      }

      if (query?.get_poll_id) {
        if (pollIdUnsupported) {
          throw new Error('unknown request get_poll_id')
        }
        return pollId
      }

      throw new Error('unexpected query')
    },
  },
})

describe('resolveRoundCircuitArtifacts', () => {
  it('uses v5 when the round exposes get_vkeys', async () => {
    const artifact = await resolveRoundCircuitArtifacts(
      makeClient({ pollId: 42, hasVkeys: true }),
      '9-4-3-125',
      {},
    )

    expect(artifact.version).toBe('v5')
    expect(artifact.bundle).toBe('9-4-3-125_v5')
    expect(artifact.pollId).toBe(42)
    expect(artifact.hasRoundVkeys).toBe(true)
  })

  it('skips get_vkeys when the circuit power has no v5 bundle', async () => {
    const queries: string[] = []
    const client = {
      contractAddress: 'round-contract',
      client: {
        queryContractSmart: async (_contract: string, query: any) => {
          if (query?.get_vkeys) {
            queries.push('get_vkeys')
            return {}
          }
          if (query?.get_poll_id) {
            queries.push('get_poll_id')
            return 42
          }
          throw new Error('unexpected query')
        },
      },
    }

    const artifact = await resolveRoundCircuitArtifacts(client, '2-1-1-5', {})

    expect(artifact.version).toBe('v4')
    expect(artifact.bundle).toBe('2-1-1-5_v4')
    expect(queries).toEqual(['get_poll_id'])
  })

  it('prefers v4 when get_vkeys is unavailable and pollId exists', async () => {
    const artifact = await resolveRoundCircuitArtifacts(
      makeClient({ pollId: 42 }),
      '2-1-1-5',
      {},
    )

    expect(artifact.version).toBe('v4')
    expect(artifact.bundle).toBe('2-1-1-5_v4')
    expect(artifact.pollId).toBe(42)
    expect(artifact.hasRoundVkeys).toBe(false)
  })

  it('still falls back to v3 when no arity is observable and pollId is unavailable', async () => {
    const artifact = await resolveRoundCircuitArtifacts(
      makeClient({ pollIdUnsupported: true }),
      '2-1-1-5',
      {},
    )

    expect(artifact.version).toBe('v3')
    expect(artifact.bundle).toBe('2-1-1-5_v3')
    expect(artifact.pollId).toBeUndefined()
    expect(artifact.hasRoundVkeys).toBe(false)
  })

  it('keeps arity-based resolution for old rounds when messages already exist', async () => {
    const artifact = await resolveRoundCircuitArtifacts(
      makeClient({ pollIdUnsupported: true }),
      '2-1-1-5',
      { messageArity: 10 },
    )

    expect(artifact.version).toBe('v4')
    expect(artifact.bundle).toBe('2-1-1-5_v4')
  })

  it('propagates unexpected get_vkeys query failures', async () => {
    const client = {
      contractAddress: 'round-contract',
      client: {
        queryContractSmart: async () => {
          throw new Error('rpc unavailable')
        },
      },
    }

    await expect(
      resolveRoundCircuitArtifacts(client, '9-4-3-125', {}),
    ).rejects.toThrow('rpc unavailable')
  })

  it('does not treat contract lookup failures as old rounds', async () => {
    const client = {
      contractAddress: 'missing-round-contract',
      client: {
        queryContractSmart: async () => {
          throw new Error('contract not found')
        },
      },
    }

    await expect(
      resolveRoundCircuitArtifacts(client, '9-4-3-125', {}),
    ).rejects.toThrow('contract not found')
  })

  it('rejects unsupported circuit powers before querying the contract', async () => {
    let queried = false
    const client = {
      contractAddress: 'round-contract',
      client: {
        queryContractSmart: async () => {
          queried = true
          return undefined
        },
      },
    }

    await expect(
      resolveRoundCircuitArtifacts(client, '1-1-1-1', {}),
    ).rejects.toThrow('Unsupported circuit power')
    expect(queried).toBe(false)
  })
})
