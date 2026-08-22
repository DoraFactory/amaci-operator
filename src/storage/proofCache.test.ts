import { describe, expect, it } from 'vitest'
import { buildInputsSignature } from './proofCache'

const baseSignatureArgs = {
  circuitPower: '9-4-3-125',
  circuitType: '0',
  artifactVersion: 'v6',
  artifactBundle: '9-4-3-125_v6',
  pollId: 1,
  messageArity: 10,
  deactivateMessageArity: 10,
  maxVoteOptions: 5,
  signupCount: 2,
  msgCount: 2,
  dmsgCount: 0,
}

describe('buildInputsSignature maxVotesPerOption', () => {
  it('invalidates cached v6 inputs when the cap changes', () => {
    const capTwo = buildInputsSignature({
      ...baseSignatureArgs,
      maxVotesPerOption: 2n,
    })
    const capThree = buildInputsSignature({
      ...baseSignatureArgs,
      maxVotesPerOption: 3n,
    })

    expect(capTwo).not.toBe(capThree)
    expect(capTwo).toContain('mvpo:2')
  })

  it('distinguishes new v6 cap-aware inputs from legacy signatures', () => {
    const legacy = buildInputsSignature(baseSignatureArgs)
    const unlimitedV6 = buildInputsSignature({
      ...baseSignatureArgs,
      maxVotesPerOption: 0n,
    })

    expect(unlimitedV6).not.toBe(legacy)
  })
})
