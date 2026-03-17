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
}

async function queryPollId(maciClient: any): Promise<number> {
  const rawPollId = await maciClient.client.queryContractSmart(
    maciClient.contractAddress,
    { get_poll_id: {} },
  )
  const parsed = Number(rawPollId)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid poll id response: ${String(rawPollId)}`)
  }
  return parsed
}

function resolveVersionByCodeId(codeId: string | number): CircuitArtifactVersion {
  const parsed = Number(codeId)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid round codeId: ${String(codeId)}`)
  }
  return parsed >= 239 ? 'v4' : 'v3'
}

export async function resolveRoundCircuitArtifacts(
  maciClient: any,
  codeId: string | number,
  circuitPower: string,
): Promise<ResolvedCircuitArtifacts> {
  const version = resolveVersionByCodeId(codeId)
  if (!supportsCircuitArtifactVersion(circuitPower, version)) {
    throw new Error(
      `Unsupported circuit bundle: circuitPower=${circuitPower}, version=${version}, codeId=${String(codeId)}`,
    )
  }

  if (version === 'v4') {
    const pollId = await queryPollId(maciClient)
    return {
      bundle: toCircuitBundleName(circuitPower, 'v4'),
      version,
      pollId,
    }
  }

  return {
    bundle: toCircuitBundleName(circuitPower, 'v3'),
    version,
  }
}
