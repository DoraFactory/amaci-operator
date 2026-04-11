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

export type CircuitArtifactHints = {
  messageArity?: number
  deactivateMessageArity?: number
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

  const inferredArity =
    hints?.messageArity ?? hints?.deactivateMessageArity

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
  const pollId = await queryPollId(maciClient)
  const version = resolveVersionByHints(circuitPower, hints, pollId)
  if (!supportsCircuitArtifactVersion(circuitPower, version)) {
    throw new Error(
      `Unsupported circuit bundle: circuitPower=${circuitPower}, version=${version}, hints=${JSON.stringify(hints || {})}`,
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
