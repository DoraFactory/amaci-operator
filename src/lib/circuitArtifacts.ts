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
): CircuitArtifactVersion {
  if (circuitPower === '9-4-3-125') {
    return 'v4'
  }

  const inferredArity =
    hints?.messageArity ?? hints?.deactivateMessageArity

  if (typeof inferredArity === 'number' && Number.isFinite(inferredArity)) {
    return inferredArity >= 10 ? 'v4' : 'v3'
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
  const version = resolveVersionByHints(circuitPower, hints)
  if (!supportsCircuitArtifactVersion(circuitPower, version)) {
    throw new Error(
      `Unsupported circuit bundle: circuitPower=${circuitPower}, version=${version}, hints=${JSON.stringify(hints || {})}`,
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
