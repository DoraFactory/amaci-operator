import { describe, expect, it } from 'vitest'
import { mergeRoundsById } from './indexer'

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
