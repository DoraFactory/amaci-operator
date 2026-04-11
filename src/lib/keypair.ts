import { babyJub, eddsa, poseidon } from 'circomlib'

import crypto from 'crypto'
import * as ff from 'ffjavascript'
import createBlakeHash from 'blake-hash'
import { IKeypair } from '../types'

const SNARK_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n
const BABYJUB_SUBORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n

type BabyJubKeyFormat = 'legacy-v154' | 'poll-aware'
export type KeyGenerationMode = 'legacy' | 'padded'
export type KeyGenerationModeInput =
  | KeyGenerationMode
  | 'old_key_generation'
  | 'new_key_generation'

export interface CoordinatorPubKeyVariants {
  legacy: [bigint, bigint]
  padded: [bigint, bigint]
}

export const stringizing = (o: any, path: any[] = []): any => {
  if (path.includes(o)) {
    throw new Error('loop nesting!')
  }
  const newPath = [...path, o]

  if (Array.isArray(o)) {
    return o.map((item: any) => stringizing(item, newPath))
  } else if (typeof o === 'object') {
    const output: any = {}
    for (const key in o) {
      output[key] = stringizing(o[key], newPath)
    }
    return output
  } else {
    return o.toString()
  }
}

export const bigInt2BufferLegacy = (i: bigint) => {
  return Buffer.from(i.toString(16), 'hex')
}

export const bigInt2BufferPadded = (i: bigint) => {
  let hex = i.toString(16)
  if (hex.length % 2 === 1) {
    hex = '0' + hex
  }
  return Buffer.from(hex, 'hex')
}

export const normalizeKeyGenerationMode = (
  mode?: string,
): KeyGenerationMode | undefined => {
  if (!mode) return undefined
  switch (mode) {
    case 'legacy':
    case 'old_key_generation':
      return 'legacy'
    case 'padded':
    case 'new_key_generation':
      return 'padded'
    default:
      return undefined
  }
}

export const bigInt2Buffer = (
  i: bigint,
  keyGenerationMode: KeyGenerationMode = 'legacy',
) => {
  return keyGenerationMode === 'padded'
    ? bigInt2BufferPadded(i)
    : bigInt2BufferLegacy(i)
}

export const genRandomKey = () => {
  // Prevent modulo bias
  //const lim = BigInt('0x10000000000000000000000000000000000000000000000000000000000000000')
  //const min = (lim - SNARK_FIELD_SIZE) % SNARK_FIELD_SIZE
  const min =
    6350874878119819312338956282401532410528162663560392320966563075034087161851n

  let rand
  while (true) {
    rand = BigInt('0x' + crypto.randomBytes(32).toString('hex'))

    if (rand >= min) {
      break
    }
  }

  const privKey = rand % SNARK_FIELD_SIZE
  return privKey
}

export const genStaticRandomKey = (
  priSeed: bigint,
  type: bigint,
  index: bigint,
) => {
  const min =
    6350874878119819312338956282401532410528162663560392320966563075034087161851n

  let rand = poseidon([priSeed, type, index])
  while (true) {
    if (rand >= min) {
      break
    }

    rand = poseidon([rand, rand])
  }

  // const privKey = rand % SNARK_FIELD_SIZE;
  const privKey = rand % 2n ** 253n
  return privKey
}

export const genPubKey = (
  privKey: bigint,
  keyGenerationMode: KeyGenerationMode = 'legacy',
) => {
  // Check whether privKey is a field element
  privKey = BigInt(privKey.toString())
  return eddsa.prv2pub(bigInt2Buffer(privKey, keyGenerationMode))
}

export const pubKeysEqual = (
  left: [bigint, bigint],
  right: [bigint, bigint],
) => left[0] === right[0] && left[1] === right[1]

export const serializePubKey = (pubKey: [bigint, bigint]) => ({
  x: pubKey[0].toString(),
  y: pubKey[1].toString(),
})

export const deriveCoordinatorPubKeyVariants = (
  privKey: bigint,
): CoordinatorPubKeyVariants => ({
  legacy: genPubKey(privKey, 'legacy'),
  padded: genPubKey(privKey, 'padded'),
})

export const resolveKeyGenerationModeForPubKey = (
  coordinatorPubKeys: CoordinatorPubKeyVariants,
  roundPubKey: [bigint, bigint],
): KeyGenerationMode => {
  if (pubKeysEqual(roundPubKey, coordinatorPubKeys.legacy)) {
    return 'legacy'
  }
  if (pubKeysEqual(roundPubKey, coordinatorPubKeys.padded)) {
    return 'padded'
  }

  const legacy = serializePubKey(coordinatorPubKeys.legacy)
  const padded = serializePubKey(coordinatorPubKeys.padded)
  const round = serializePubKey(roundPubKey)
  throw new Error(
    `Round coordinator pubkey (${round.x}, ${round.y}) does not match the local coordinator private key under legacy (${legacy.x}, ${legacy.y}) or padded (${padded.x}, ${padded.y}) derivation`,
  )
}

export const genKeypair = (
  pkey?: bigint,
  keyGenerationMode: KeyGenerationMode = 'legacy',
): IKeypair => {
  const privKey = pkey || genRandomKey()
  const pubKey = genPubKey(privKey, keyGenerationMode)
  const formatedPrivKey = formatPrivKeyForBabyJub(privKey, undefined, keyGenerationMode)

  return { privKey, pubKey, formatedPrivKey }
}

const resolveBabyJubKeyFormat = (
  pollId?: number | bigint,
): BabyJubKeyFormat => {
  return pollId === undefined ? 'legacy-v154' : 'poll-aware'
}

const formatPrivKeyForBabyJub = (
  privKey: bigint,
  pollId?: number | bigint,
  keyGenerationMode: KeyGenerationMode = 'legacy',
): bigint => {
  const sBuff = eddsa.pruneBuffer(
    createBlakeHash('blake512')
      .update(bigInt2Buffer(privKey, keyGenerationMode))
      .digest()
      .slice(0, 32),
  )
  const s = ff.utils.leBuff2int(sBuff)
  if (resolveBabyJubKeyFormat(pollId) === 'legacy-v154') {
    return ff.Scalar.shr(s, 3)
  }

  // Match SDK/@zk-kit behavior for poll-aware (v4) rounds:
  // clamp, then reduce to the BabyJub subgroup order.
  return ff.Scalar.mod(ff.Scalar.shr(s, 3), BABYJUB_SUBORDER)
}

export const genRoundKeypair = (
  pkey: bigint,
  pollId?: number | bigint,
  keyGenerationMode: KeyGenerationMode = 'legacy',
): IKeypair => {
  const privKey = BigInt(pkey.toString())
  const pubKey = genPubKey(privKey, keyGenerationMode)
  const formatedPrivKey = formatPrivKeyForBabyJub(privKey, pollId, keyGenerationMode)

  return { privKey, pubKey, formatedPrivKey }
}

export const genEcdhSharedKey = (
  privKey: bigint,
  pubKey: [bigint, bigint],
  pollId?: number | bigint,
  keyGenerationMode: KeyGenerationMode = 'legacy',
): [bigint, bigint] => {
  return babyJub.mulPointEscalar(
    pubKey,
    formatPrivKeyForBabyJub(privKey, pollId, keyGenerationMode),
  )
}
