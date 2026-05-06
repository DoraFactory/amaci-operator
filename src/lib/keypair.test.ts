import { describe, expect, it } from 'vitest'
import {
  assertCoordinatorPubKeyMatches,
  bigInt2BufferPadded,
  deriveCoordinatorPubKey,
  pubKeysEqual,
} from './keypair'

describe('keypair padded mode', () => {
  it('pads odd-length hex private keys', () => {
    expect(bigInt2BufferPadded(0x123n).toString('hex')).toBe('0123')
  })

  it('accepts only padded coordinator pubkeys', () => {
    const pubkey = deriveCoordinatorPubKey(0x123n)

    expect(pubKeysEqual(pubkey, pubkey)).toBe(true)
    expect(() => assertCoordinatorPubKeyMatches(pubkey, pubkey)).not.toThrow()
  })
})
