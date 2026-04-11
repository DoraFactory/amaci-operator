import { describe, expect, it } from 'vitest'
import { resolveRoundCircuitArtifacts } from './circuitArtifacts'

const makeClient = (pollId: unknown, shouldThrow = false) => ({
  contractAddress: 'round-contract',
  client: {
    queryContractSmart: async () => {
      if (shouldThrow) {
        throw new Error('unknown request get_poll_id')
      }
      return pollId
    },
  },
})

describe('resolveRoundCircuitArtifacts', () => {
  it('prefers v4 when pollId exists even if there are no messages yet', async () => {
    const artifact = await resolveRoundCircuitArtifacts(
      makeClient(42),
      '2-1-1-5',
      {},
    )

    expect(artifact.version).toBe('v4')
    expect(artifact.bundle).toBe('2-1-1-5_v4')
    expect(artifact.pollId).toBe(42)
  })

  it('still falls back to v3 when no arity is observable and pollId is unavailable', async () => {
    const artifact = await resolveRoundCircuitArtifacts(
      makeClient(undefined, true),
      '2-1-1-5',
      {},
    )

    expect(artifact.version).toBe('v3')
    expect(artifact.bundle).toBe('2-1-1-5_v3')
    expect(artifact.pollId).toBeUndefined()
  })

  it('keeps arity-based resolution when messages already exist', async () => {
    const artifact = await resolveRoundCircuitArtifacts(
      makeClient(undefined, true),
      '2-1-1-5',
      { messageArity: 10 },
    )

    expect(artifact.version).toBe('v4')
    expect(artifact.bundle).toBe('2-1-1-5_v4')
  })
})
