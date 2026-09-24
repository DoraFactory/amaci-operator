import {
  CircuitArtifactVersion,
  MaciType,
  supportsCircuitArtifactVersion,
  toCircuitBundleName,
} from '../types'

export type ResolvedCircuitArtifacts = {
  bundle: MaciType
  version: CircuitArtifactVersion
  pollId?: number
  hasRoundVkeys?: boolean
}

export type CircuitArtifactHints = {
  messageArity?: number
  deactivateMessageArity?: number
}

type RoundVkeyKind =
  | 'process_vkey'
  | 'tally_vkey'
  | 'deactivate_vkey'
  | 'add_key_vkey'

type RoundVkeyFingerprint = {
  delta_2: string
  ic0: string
  ic1: string
}

type FingerprintedCircuitArtifactVersion = Extract<
  CircuitArtifactVersion,
  'v5' | 'v6'
>

// The fields below are the circuit-specific parts of each verification key.
// v6 values come from 9-4-3-125_v6_vkey/*-hex.json.
export const ROUND_VKEY_FINGERPRINTS: Record<
  FingerprintedCircuitArtifactVersion,
  Record<RoundVkeyKind, RoundVkeyFingerprint>
> = {
  v5: {
    process_vkey: {
      delta_2:
        '1ca282bdb2bf70aeae2a394515a6b090972b172f2baa302c9c4a5e2e62044085172b006b637672503a9ad454148c20024cc3412cd3af07fdc172cbeec61de5252e7f42a023bce7df1c2b9bb817d5c6345e03462f2231ef0b4057c487da87e4fa1df5a5ff810e7c9f18acf76a9ef37ed89169f54af3326f63e5c732886b57b0d0',
      ic0: '0f4ca042d9df017c2277a5348138072354637d7a548ed2432a62b22bd6b0793c14d190e06d249c579f2f3cb9c0d8e5223798931ac8fc645efc96739d34e3a553',
      ic1: '0231a17b99604840a6870d1c5ba31394ceb6683af703d083338c30bdb87b88851283ec802a494552bd00732fa61bfc619a4238a0ab6659e5c8fa91b2a5e5143b',
    },
    tally_vkey: {
      delta_2:
        '232a958bbc349f1fa27cf560c9efa7248aa95d954de64a3e170c2abe8265386529255f7c77a1a70b4237d6fa8763c64699c3d1eb62a54e60349cb32c850ef1b10044d8b3fc7298d54a097453c9a9b62442fa3851e2c1dc582c47b9d60e0a62392ca45e26a1793a485d1e8c81de124d2b1cf2afefa69459ef7d567076bc864dec',
      ic0: '1840e9af4d2094c190adf2e40468515ee760858a2a41a26aa7916bc38bd7ba9f01ea24bf4adad4d679ddf5858dbcb4587b954a6062b264288f6e191c6d697759',
      ic1: '1ed068e3bbc130b6a420efe22b7f26b7372686108ff1935eea7508eb814d3e2e0ab2da2095988387330108bee8d58121be18e61bb594ba9b8982a290cfc2571b',
    },
    deactivate_vkey: {
      delta_2:
        '11e969c11af8421c1474c478725abee854af14412b35f69010f5c9913c9eb9401474968c8c1608ebdfb978f7e72380d046d1ac079a64bae0fef5052137ae829d07317efdfe94d826337c8225c7e78be3775f3dd61a60486fe32ca7587223c58323534bc421de3812160299521a2670b43351d8c6ef3a3204ab9394c05111f805',
      ic0: '2341ef299bd50b06e3885f2c95e6e043ac4a9b30263fb5b212b9c5ee443ab28d17b0dd121483ee7a280fe8a82384e8bbd0e52c32be97148dfaecb953ee0b34fe',
      ic1: '04c3cdc1e32f4e6eae21adb419ed037dcd5daa9012bc9fe31e4ebedba31c101b00f8483d686d64d0eb7d1c3278b4409f4717dea169970f62505a52e3c08b6d4d',
    },
    add_key_vkey: {
      delta_2:
        '1c94083c2b90d4f41d7e83000647860bb278e98705f0c9553b790ba4556d88451b2e0741e3cba46801412cff620bb191ab358604fff432bf073a325c9f19a1860cb0286d5261f5e0214f11320d740fee711f78575a8f3b47bebecad7e16a301c0b0d80535eb8f30fd18c2627e9f08d1b1bf3f7210994465489722587bba1487f',
      ic0: '0eb39e5aa053d6676afa84d88c23996669b18eda44eb6d97420176ff55c276290ae7df9c85d77b9aef313093fdeada3c53cd1b0cfd7ed04460a719cfff4e5925',
      ic1: '200467c396f31ec6b2f3324d5fa38a28e18ce24c1a92742486553e2375204fc82e4feff4af5e2c2ac4acd05af4a64d161edee15e1feef61d2f4977860643c94b',
    },
  },
  v6: {
    process_vkey: {
      delta_2:
        '059756653a474da0d3a99522bfba92428ff603c8254e3c5016c41fc532baadd42f456e58a452cc9ace1828ca8eafcda8685872703c35ef5d796e7e8bed5a4d00002d372c4d2bbccad47dbed288eaad7a6bce92f605f1082fa4442cf7555b6dff14eea0b33c1832a169e2e42dcb07749d88806193280fd009912ab35af8b2a2c2',
      ic0: '2936807506628c01f5c320b0cfe38bcd7de3f1c9f78649cb2ee9fe835c523e602d716f08d8b98a688c9f106bb18060c66feaf31854327cf20dd3170a284f8258',
      ic1: '0db49219818833defe6729fe69d23bbbd6c892b45b49792b798c13ff3ab72f3e1674142a207b3a01330a307e9613dc643b181a728bc4a041ad5a0ff37900c71c',
    },
    tally_vkey: {
      delta_2:
        '04ac819540c297e090f7798b260dedf91d7d07e0c28c935b1727e815fc0b690a04c5daab1db9d8cf8dd34f682d74f9cc692ad4c48402aad88c0071769e13b589013d75b834c55ff9b9f9d3dd8b2c736b836af659800f6b1b0b1602f3c6007add2d1fe9bebad5ca5847b53d2241fbf84c32ed836b3226136a213236fac682561b',
      ic0: '1840e9af4d2094c190adf2e40468515ee760858a2a41a26aa7916bc38bd7ba9f01ea24bf4adad4d679ddf5858dbcb4587b954a6062b264288f6e191c6d697759',
      ic1: '1ed068e3bbc130b6a420efe22b7f26b7372686108ff1935eea7508eb814d3e2e0ab2da2095988387330108bee8d58121be18e61bb594ba9b8982a290cfc2571b',
    },
    deactivate_vkey: {
      delta_2:
        '147cbe7e7451633254d01f220cf3521717258300cbe8eea7f9c5e4a5aa776a5d1fbe926fe9c14bf755a9c2ac403e2c94eaf9015dda20644279d115e9b8556904205164034510b8e0dbad7647a37b4d958247ac849463e291152460f3cc08cd3c2eeb4a102cd303af7fd64bf0d61319f658330f121373b9b5b983c2e680ba3d8d',
      ic0: '2341ef299bd50b06e3885f2c95e6e043ac4a9b30263fb5b212b9c5ee443ab28d17b0dd121483ee7a280fe8a82384e8bbd0e52c32be97148dfaecb953ee0b34fe',
      ic1: '04c3cdc1e32f4e6eae21adb419ed037dcd5daa9012bc9fe31e4ebedba31c101b00f8483d686d64d0eb7d1c3278b4409f4717dea169970f62505a52e3c08b6d4d',
    },
    add_key_vkey: {
      delta_2:
        '0eb06f2f1b513f042895affc86f337c896aff1a9b0b158bbd3608ba3f27165862c47682ba5c8ebad4178c520f9d88e9bfa8cadf098baf2fe5509929131f909741d6888dd7e2462f4e7d0564ace9128facc836d221dff6c0b85181519ee039f2b04f70b9050f84fb9ca004fd086fab7ca49c9c07e32b841805147aa86930fdb9e',
      ic0: '0eb39e5aa053d6676afa84d88c23996669b18eda44eb6d97420176ff55c276290ae7df9c85d77b9aef313093fdeada3c53cd1b0cfd7ed04460a719cfff4e5925',
      ic1: '200467c396f31ec6b2f3324d5fa38a28e18ce24c1a92742486553e2375204fc82e4feff4af5e2c2ac4acd05af4a64d161edee15e1feef61d2f4977860643c94b',
    },
  },
}

const roundVkeyKinds = Object.keys(
  ROUND_VKEY_FINGERPRINTS.v6,
) as RoundVkeyKind[]

function isUnsupportedQueryError(err: any, queryName: string): boolean {
  const message = String(err?.message || err).toLowerCase()
  return (
    message.includes(queryName.toLowerCase()) ||
    message.includes('unknown request') ||
    message.includes('unknown variant') ||
    message.includes('unknown query')
  )
}

async function queryPollId(maciClient: any): Promise<number | undefined> {
  try {
    const rawPollId = await maciClient.client.queryContractSmart(
      maciClient.contractAddress,
      { get_poll_id: {} },
    )

    if (rawPollId === null || rawPollId === undefined || rawPollId === '') {
      return undefined
    }

    const parsed = Number(rawPollId)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid poll id response: ${String(rawPollId)}`)
    }

    return parsed
  } catch (err: any) {
    if (isUnsupportedQueryError(err, 'get_poll_id')) {
      return undefined
    }

    throw err
  }
}

async function queryRoundVkeys(maciClient: any): Promise<unknown | undefined> {
  try {
    return await maciClient.client.queryContractSmart(
      maciClient.contractAddress,
      { get_vkeys: {} },
    )
  } catch (err: any) {
    if (isUnsupportedQueryError(err, 'get_vkeys')) {
      return undefined
    }

    throw err
  }
}

function byteValueToHex(value: unknown): string | undefined {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex')
  }

  if (Array.isArray(value)) {
    if (
      !value.every(
        (item) =>
          Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255,
      )
    ) {
      return undefined
    }
    return Buffer.from(value).toString('hex')
  }

  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const hex = trimmed.replace(/^0x/i, '').toLowerCase()
  if (hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-f]+$/.test(hex)) {
    return hex
  }

  try {
    return Buffer.from(trimmed, 'base64').toString('hex')
  } catch {
    return undefined
  }
}

function matchesRoundVkeyFingerprint(
  roundVkeys: unknown,
  version: FingerprintedCircuitArtifactVersion,
): boolean {
  if (!roundVkeys || typeof roundVkeys !== 'object') return false
  const response = roundVkeys as Record<string, unknown>
  const expected = ROUND_VKEY_FINGERPRINTS[version]

  return roundVkeyKinds.every((kind) => {
    const rawVkey = response[kind]
    if (!rawVkey || typeof rawVkey !== 'object') return false
    const vkey = rawVkey as Record<string, unknown>
    return (
      byteValueToHex(vkey.delta_2 ?? vkey.vk_delta_2) ===
        expected[kind].delta_2 &&
      byteValueToHex(vkey.ic0 ?? vkey.vk_ic0) === expected[kind].ic0 &&
      byteValueToHex(vkey.ic1 ?? vkey.vk_ic1) === expected[kind].ic1
    )
  })
}

function resolveVersionByHints(
  circuitPower: string,
  hints?: CircuitArtifactHints,
  pollId?: number,
): CircuitArtifactVersion {
  const supportsV3 = supportsCircuitArtifactVersion(circuitPower, 'v3')
  const supportsV4 = supportsCircuitArtifactVersion(circuitPower, 'v4')

  if (supportsV4 && !supportsV3) {
    return 'v4'
  }

  if (supportsV3 && !supportsV4) {
    return 'v3'
  }

  const inferredArity = hints?.messageArity ?? hints?.deactivateMessageArity

  if (typeof inferredArity === 'number' && Number.isFinite(inferredArity)) {
    return inferredArity >= 10 ? 'v4' : 'v3'
  }

  if (typeof pollId === 'number' && Number.isFinite(pollId)) {
    return 'v4'
  }

  // Ambiguous rounds without observable message width default to v3.
  // This keeps old rounds working and avoids feeding v4 circuits with v3 inputs.
  return 'v3'
}

export async function resolveRoundCircuitArtifacts(
  maciClient: any,
  circuitPower: string,
  hints?: CircuitArtifactHints,
): Promise<ResolvedCircuitArtifacts> {
  const supportsV3 = supportsCircuitArtifactVersion(circuitPower, 'v3')
  const supportsV4 = supportsCircuitArtifactVersion(circuitPower, 'v4')
  const supportsV5 = supportsCircuitArtifactVersion(circuitPower, 'v5')
  const supportsV6 = supportsCircuitArtifactVersion(circuitPower, 'v6')
  if (!supportsV3 && !supportsV4 && !supportsV5 && !supportsV6) {
    throw new Error(
      `Unsupported circuit power: circuitPower=${circuitPower}, hints=${JSON.stringify(hints || {})}`,
    )
  }

  const roundVkeys =
    supportsV5 || supportsV6 ? await queryRoundVkeys(maciClient) : undefined
  const hasRoundVkeys = roundVkeys !== undefined
  const pollId = await queryPollId(maciClient)

  let version: CircuitArtifactVersion
  if (hasRoundVkeys) {
    const fingerprintedVersion = (['v6', 'v5'] as const).find(
      (candidate) =>
        supportsCircuitArtifactVersion(circuitPower, candidate) &&
        matchesRoundVkeyFingerprint(roundVkeys, candidate),
    )
    if (!fingerprintedVersion) {
      throw new Error(
        `Unsupported round verification keys: circuitPower=${circuitPower}`,
      )
    }
    version = fingerprintedVersion
  } else {
    version = resolveVersionByHints(circuitPower, hints, pollId)
  }

  if (!supportsCircuitArtifactVersion(circuitPower, version)) {
    throw new Error(
      `Unsupported circuit bundle: circuitPower=${circuitPower}, version=${version}, hints=${JSON.stringify(hints || {})}`,
    )
  }

  return {
    bundle: toCircuitBundleName(circuitPower, version),
    version,
    pollId,
    hasRoundVkeys,
  }
}
