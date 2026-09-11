import { describe, expect, it } from 'vitest'
import { MaciQueryClient } from './Maci.client'

describe('MaciQueryClient maxVotesPerOption', () => {
  it('queries the max_votes_per_option contract endpoint', async () => {
    const queries: unknown[] = []
    const client = {
      queryContractSmart: async (contractAddress: string, query: unknown) => {
        queries.push({ contractAddress, query })
        return '2'
      },
    }
    const maci = new MaciQueryClient(client as any, 'round-contract')

    await expect(maci.maxVotesPerOption()).resolves.toBe('2')
    expect(queries).toEqual([
      {
        contractAddress: 'round-contract',
        query: { max_votes_per_option: {} },
      },
    ])
  })
})
