import { describe, expect, it } from 'vitest'
import {
  bigInt2BufferLegacy,
  bigInt2BufferPadded,
  deriveCoordinatorPubKeyVariants,
  normalizeKeyGenerationMode,
  pubKeysEqual,
  resolveKeyGenerationModeForPubKey,
} from './keypair'

describe('keypair compatibility modes', () => {
  it('uses different buffers for odd-length hex private keys', () => {
    expect(bigInt2BufferLegacy(0x123n).toString('hex')).toBe('12')
    expect(bigInt2BufferPadded(0x123n).toString('hex')).toBe('0123')
  })

  it('resolves legacy and padded modes from the round pubkey', () => {
    const variants = deriveCoordinatorPubKeyVariants(0x123n)

    expect(pubKeysEqual(variants.legacy, variants.padded)).toBe(false)
    expect(resolveKeyGenerationModeForPubKey(variants, variants.legacy)).toBe(
      'legacy',
    )
    expect(resolveKeyGenerationModeForPubKey(variants, variants.padded)).toBe(
      'padded',
    )
  })

  it('accepts legacy and padded aliases', () => {
    expect(normalizeKeyGenerationMode('legacy')).toBe('legacy')
    expect(normalizeKeyGenerationMode('old_key_generation')).toBe('legacy')
    expect(normalizeKeyGenerationMode('padded')).toBe('padded')
    expect(normalizeKeyGenerationMode('new_key_generation')).toBe('padded')
    expect(normalizeKeyGenerationMode('unknown')).toBeUndefined()
  })
})
