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
    const message = err?.message || String(err)
    if (
      message.includes('get_poll_id') ||
      message.includes('unknown request') ||
      message.includes('unknown variant') ||
      message.includes('not found') ||
      message.includes('does not exist')
    ) {
      return undefined
    }

    throw err
  }
}

function resolveVersionByPollId(pollId?: number): CircuitArtifactVersion {
  return pollId === undefined ? 'v3' : 'v4'
}

export async function resolveRoundCircuitArtifacts(
  maciClient: any,
  circuitPower: string,
): Promise<ResolvedCircuitArtifacts> {
  const pollId = await queryPollId(maciClient)
  const version = resolveVersionByPollId(pollId)
  if (!supportsCircuitArtifactVersion(circuitPower, version)) {
    throw new Error(
      `Unsupported circuit bundle: circuitPower=${circuitPower}, version=${version}, pollId=${String(pollId)}`,
    )
  }

  if (version === 'v4') {
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
