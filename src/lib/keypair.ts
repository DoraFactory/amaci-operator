import { babyJub, eddsa, poseidon } from 'circomlib'

import crypto from 'crypto'
import * as ff from 'ffjavascript'
import createBlakeHash from 'blake-hash'
import { IKeypair } from '../types'

const SNARK_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

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

export const bigInt2Buffer = (i: bigint) => {
  return Buffer.from(i.toString(16), 'hex')
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

const genPubKey = (privKey: bigint) => {
  // Check whether privKey is a field element
  privKey = BigInt(privKey.toString())
  return eddsa.prv2pub(bigInt2Buffer(privKey))
}

export const genKeypair = (pkey?: bigint): IKeypair => {
  const privKey = pkey || genRandomKey()
  const pubKey = genPubKey(privKey)
  const formatedPrivKey = formatPrivKeyForBabyJub(privKey)

  return { privKey, pubKey, formatedPrivKey }
}

const formatPrivKeyForBabyJub = (privKey: bigint): bigint => {
  const sBuff = eddsa.pruneBuffer(
    createBlakeHash('blake512')
      .update(bigInt2Buffer(privKey))
      .digest()
      .slice(0, 32),
  )
  const s = ff.utils.leBuff2int(sBuff)
  return ff.Scalar.shr(s, 3)
}

export const genEcdhSharedKey = (
  privKey: bigint,
  pubKey: [bigint, bigint],
): [bigint, bigint] => {
  const sharedKey = babyJub.mulPointEscalar(
    pubKey,
    formatPrivKeyForBabyJub(privKey),
  )
  if (sharedKey[0] === 0n) {
    return [0n, 1n]
  } else {
    return sharedKey
  }
}
