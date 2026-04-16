import { describe, expect, it } from 'vitest'
import {
  isAffirmativeAnswer,
  normalizeSetOperatorSubcommand,
  resolveCoordinatorPrivKeyStrategy,
} from './setOperator'

describe('normalizeSetOperatorSubcommand', () => {
  it('accepts identity and both maci pubkey spellings', () => {
    expect(normalizeSetOperatorSubcommand('identity')).toBe('identity')
    expect(normalizeSetOperatorSubcommand('maciPubKey')).toBe('maciPubkey')
    expect(normalizeSetOperatorSubcommand('maciPubkey')).toBe('maciPubkey')
  })

  it('rejects unsupported set-operator subcommands', () => {
    expect(normalizeSetOperatorSubcommand('')).toBeUndefined()
    expect(normalizeSetOperatorSubcommand('maci_pubkey')).toBeUndefined()
    expect(normalizeSetOperatorSubcommand('pubkey')).toBeUndefined()
  })

  it('reuses an existing valid coordinator private key and generates otherwise', () => {
    expect(resolveCoordinatorPrivKeyStrategy(true)).toBe('reuse-existing')
    expect(resolveCoordinatorPrivKeyStrategy(false)).toBe('generate-new')
  })

  it('accepts common affirmative confirmation answers', () => {
    expect(isAffirmativeAnswer('y')).toBe(true)
    expect(isAffirmativeAnswer('Y')).toBe(true)
    expect(isAffirmativeAnswer(' yes ')).toBe(true)
    expect(isAffirmativeAnswer('n')).toBe(false)
    expect(isAffirmativeAnswer('')).toBe(false)
  })
})
