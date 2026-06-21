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

async function queryHasRoundVkeys(maciClient: any): Promise<boolean> {
  try {
    await maciClient.client.queryContractSmart(
      maciClient.contractAddress,
      { get_vkeys: {} },
    )
    return true
  } catch (err: any) {
    if (isUnsupportedQueryError(err, 'get_vkeys')) {
      return false
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
  const supportsV3 = supportsCircuitArtifactVersion(circuitPower, 'v3')
  const supportsV4 = supportsCircuitArtifactVersion(circuitPower, 'v4')
  const supportsV5 = supportsCircuitArtifactVersion(circuitPower, 'v5')
  if (!supportsV3 && !supportsV4 && !supportsV5) {
    throw new Error(
      `Unsupported circuit power: circuitPower=${circuitPower}, hints=${JSON.stringify(hints || {})}`,
    )
  }

  const hasRoundVkeys = supportsV5
    ? await queryHasRoundVkeys(maciClient)
    : false
  const pollId = await queryPollId(maciClient)
  const version: CircuitArtifactVersion = hasRoundVkeys
    ? 'v5'
    : resolveVersionByHints(circuitPower, hints, pollId)
  if (!supportsCircuitArtifactVersion(circuitPower, version)) {
    throw new Error(
      `Unsupported circuit bundle: circuitPower=${circuitPower}, version=${version}, hints=${JSON.stringify(hints || {})}`,
    )
  }

  if (version === 'v5') {
    return {
      bundle: toCircuitBundleName(circuitPower, 'v5'),
      version,
      pollId,
      hasRoundVkeys,
    }
  }

  if (version === 'v4') {
    return {
      bundle: toCircuitBundleName(circuitPower, 'v4'),
      version,
      pollId,
      hasRoundVkeys,
    }
  }

  return {
    bundle: toCircuitBundleName(circuitPower, 'v3'),
    version,
    hasRoundVkeys,
  }
}
