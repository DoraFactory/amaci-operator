import { describe, expect, it } from 'vitest'
import { eddsa, poseidon } from 'circomlib'
import { MACI, normalizeMaxVotesPerOption } from './Maci'
import { bigInt2BufferPadded, genPubKey } from './keypair'

const makeCommand = ({
  voterPrivKey,
  newVotes,
  voIdx = 0n,
}: {
  voterPrivKey: bigint
  newVotes: bigint
  voIdx?: bigint
}) => {
  const voterPubKey = genPubKey(voterPrivKey)
  const packaged = 1n + (voIdx << 64n) + (newVotes << 96n) + (1n << 192n)
  const msgHash = poseidon([packaged, voterPubKey[0], voterPubKey[1]])

  return {
    voterPubKey,
    command: {
      nonce: 1n,
      stateIdx: 0n,
      voIdx,
      newVotes,
      newPubKey: voterPubKey,
      pollId: 1n,
      signature: (eddsa as any).signPoseidon(
        bigInt2BufferPadded(voterPrivKey),
        msgHash,
      ),
      msgHash,
    },
  }
}

describe('MACI maxVotesPerOption', () => {
  it('packs the cap into bits 96-127 of packedVals', () => {
    const maci = new MACI(2, 1, 1, 5, 111n, 5, 0, false, 1n, 2n)
    maci.pushMessage(new Array(10).fill(0n), [0n, 0n])
    maci.endVotePeriod()

    const input = maci.processMessage(1n)
    const packedVals = BigInt(input.packedVals)

    expect(packedVals & 0xffffffffn).toBe(5n)
    expect((packedVals >> 32n) & 0xffffffffn).toBe(0n)
    expect((packedVals >> 64n) & 0xffffffffn).toBe(0n)
    expect((packedVals >> 96n) & 0xffffffffn).toBe(2n)
  })

  it('invalidates a command whose vote weight exceeds the cap', () => {
    const voterPrivKey = 123n
    const { voterPubKey, command } = makeCommand({
      voterPrivKey,
      newVotes: 3n,
    })
    const maci = new MACI(2, 1, 1, 5, 111n, 5, 1, false, 1n, 2n)
    maci.initStateTree(0, voterPubKey, 100n)

    expect(maci.checkCommandNow(command)).toBe('votes per option overflow')
  })

  it('accepts a command at the cap and treats zero as unlimited', () => {
    const voterPrivKey = 456n
    const { voterPubKey, command } = makeCommand({
      voterPrivKey,
      newVotes: 2n,
    })
    const capped = new MACI(2, 1, 1, 5, 111n, 5, 1, false, 1n, 2n)
    capped.initStateTree(0, voterPubKey, 100n)
    expect(capped.checkCommandNow(command)).toBeUndefined()

    const unlimitedCommand = makeCommand({
      voterPrivKey,
      newVotes: 50n,
    }).command
    const unlimited = new MACI(2, 1, 1, 5, 111n, 5, 1, false, 1n, 0n)
    unlimited.initStateTree(0, voterPubKey, 100n)
    expect(unlimited.checkCommandNow(unlimitedCommand)).toBeUndefined()
  })

  it('rejects a vote option index equal to maxVoteOptions', () => {
    const voterPrivKey = 789n
    const valid = makeCommand({
      voterPrivKey,
      newVotes: 1n,
      voIdx: 4n,
    })
    const overflow = makeCommand({
      voterPrivKey,
      newVotes: 1n,
      voIdx: 5n,
    })
    const maci = new MACI(2, 1, 1, 5, 111n, 5, 1, false, 1n, 0n)
    maci.initStateTree(0, valid.voterPubKey, 100n)

    expect(maci.checkCommandNow(valid.command)).toBeUndefined()
    expect(maci.checkCommandNow(overflow.command)).toBe(
      'vote option index overflow',
    )
  })

  it('rejects values that do not fit in the 32-bit packedVals slot', () => {
    expect(normalizeMaxVotesPerOption(0n)).toBe(0n)
    expect(normalizeMaxVotesPerOption((1n << 32n) - 1n)).toBe((1n << 32n) - 1n)
    expect(() => normalizeMaxVotesPerOption(-1n)).toThrow(
      'maxVotesPerOption must fit in 32 bits',
    )
    expect(() => normalizeMaxVotesPerOption(1n << 32n)).toThrow(
      'maxVotesPerOption must fit in 32 bits',
    )
  })
})
