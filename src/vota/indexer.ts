import { info, warn } from '../logger'
import { getRpcLatestHeight } from '../lib/client/utils'
import {
  recordExternalRequest,
  recordIndexerFailover,
  updateActiveIndexer,
  updateIndexerHeightHealth,
} from '../metrics'

const codeIds = process.env.CODE_IDS
const DEFAULT_PAGE_LIMIT = 100
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_FAILOVER_COOLDOWN_MS = 60_000
const DEFAULT_HEIGHT_CHECK_INTERVAL_MS = 30_000
const DEFAULT_HEIGHT_LAG_THRESHOLD = 10
const HEALTH_LOG_LAG_DELTA_THRESHOLD = 1_000
const HEALTH_LOG_LAG_RELATIVE_DELTA = 0.1

interface SignUpEvent {
  id: string
  blockHeight: string
  timestamp: string
  txHash: string
  stateIdx: number
  pubKey: string
  balance: string
  contractAddress: string
  d0: string
  d1: string
  d2: string
  d3: string
}

interface PublishMessageEvent {
  id: string
  blockHeight: string
  timestamp: string
  txHash: string
  msgChainLength: number
  message: string
  encPubKey: string
  contractAddress: string
}

interface PublishDeactivateMessageEvent {
  id: string
  blockHeight: string
  timestamp: string
  txHash: string
  dmsgChainLength: number
  numSignUps: number
  message: string
  encPubKey: string
  contractAddress: string
}

export interface RoundData {
  id: string
  blockHeight: string
  codeId: string
  txHash: string
  contractAddress: string
  circuitName: string
  timestamp: string
  votingStart: string
  votingEnd: string
  status: string
  period: string
  actionType: string
  roundTitle: string
  roundDescription: string
  roundLink: string
  coordinatorPubkeyX: string
  coordinatorPubkeyY: string
  voteOptionMap: string
  results: string
  allResult: string
  gasStationEnable: boolean
  totalGrant: string
  baseGrant: string
  totalBond: string
  circuitType: '1' | '0'
  circuitPower: string
  certificationSystem: string
}

type GraphQLResponse = {
  data?: Record<string, any>
  errors?: Array<{ message?: string }>
}

type PageResponse<T> = {
  nodes: T[]
  pageInfo: {
    hasNextPage: boolean
  }
}

type EndpointState = {
  endpoint: string
  failedUntil: number
  failureReason?: string
  healthStatus?: IndexerHealthStatus
  lastLoggedHealthStatus?: IndexerHealthStatus
  lastLoggedHealthLag?: number
}

type IndexerHealthStatus =
  | 'healthy'
  | 'height_lag'
  | 'indexer_unhealthy'
  | 'height_check_failed'

type VotesLogResult = {
  signup: SignUpEvent[]
  msg: PublishMessageEvent[]
  dmsg: PublishDeactivateMessageEvent[]
  indexerEndpoint: string
}

type DeactivateLogResult = {
  signup: SignUpEvent[]
  dmsg: PublishDeactivateMessageEvent[]
  indexerEndpoint: string
}

type StreamVotesLogResult = {
  signup: SignUpEvent[]
  dmsg: PublishDeactivateMessageEvent[]
  messageStream: {
    count: number
    lastId: string
  }
  indexerEndpoint: string
}

type IndexerMetadata = {
  lastProcessedHeight?: number | string | null
  targetHeight?: number | string | null
  indexerHealthy?: boolean | null
  chain?: string | null
}

const requestTimeoutMs = () =>
  Math.max(
    1000,
    Number(
      process.env.INDEXER_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  )

const failoverCooldownMs = () =>
  Math.max(
    1000,
    Number(
      process.env.INDEXER_FAILOVER_COOLDOWN_MS || DEFAULT_FAILOVER_COOLDOWN_MS,
    ),
  )

const heightCheckIntervalMs = () =>
  Math.max(
    1000,
    Number(
      process.env.INDEXER_HEIGHT_CHECK_INTERVAL_MS ||
        DEFAULT_HEIGHT_CHECK_INTERVAL_MS,
    ),
  )

const heightLagThreshold = () =>
  Math.max(
    0,
    Number(
      process.env.INDEXER_HEIGHT_LAG_THRESHOLD || DEFAULT_HEIGHT_LAG_THRESHOLD,
    ),
  )

const heightCheckEnabled = () => {
  const raw = process.env.INDEXER_HEIGHT_CHECK_ENABLED
  if (raw === '0') return false
  if (raw === '1') return true
  return Boolean(process.env.RPC_ENDPOINT)
}

const toOptionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

const normalizeCoordinatorPubkeys = (
  coordinatorPubkeys: string[] | string[][],
): string[][] => {
  if (coordinatorPubkeys.length === 0) return []
  if (Array.isArray(coordinatorPubkeys[0])) {
    return coordinatorPubkeys as string[][]
  }
  return [coordinatorPubkeys as string[]]
}

export const mergeRoundsById = (rounds: RoundData[]): RoundData[] => {
  const deduped = new Map<string, RoundData>()
  for (const round of rounds) {
    deduped.set(round.id, round)
  }
  return [...deduped.values()]
}

const parseIndexerEndpoints = () => {
  const raw = process.env.INDEXER_ENDPOINTS?.trim()
  let values: string[] = []

  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        values = parsed.map((value) => String(value))
      }
    } catch {
      values = raw.split(',')
    }
  }

  const endpoints = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ]
  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`unsupported protocol ${url.protocol}`)
      }
    } catch (error) {
      throw new Error(
        `Invalid indexer endpoint "${endpoint}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return endpoints
}

const errorReason = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (lower.includes('timeout') || lower.includes('abort')) return 'timeout'
  if (lower.includes('lagging')) return 'lagging'
  if (lower.includes('graphql')) return 'graphql'
  if (lower.includes('http error')) return 'http'
  if (lower.includes('non-json')) return 'non_json'
  return 'error'
}

class IndexerPool {
  private states: EndpointState[] = []
  private activeIndex = 0
  private source = ''
  private heightHealthCheckedAt = 0
  private heightHealthInFlight: Promise<void> | null = null

  endpoints() {
    this.refresh()
    return this.states.map((state) => state.endpoint)
  }

  endpointsForRequest() {
    this.refresh()
    return this.requestOrder().map((index) => this.states[index].endpoint)
  }

  activeEndpoint() {
    this.refresh()
    return this.states[this.activeIndex]?.endpoint || ''
  }

  async prepare(operation: string) {
    await this.refreshHeightHealth(operation)
  }

  markActiveUnhealthy(operation: string, reason: string) {
    this.refresh()
    const active = this.states[this.activeIndex]
    if (!active) return
    active.failedUntil = Date.now() + failoverCooldownMs()
    active.failureReason = 'lagging'
    warn(
      `Marking indexer as unhealthy for ${operation}: endpoint=${active.endpoint}, reason=${reason}`,
      'INDEXER',
    )
  }

  markEndpointFailure(operation: string, endpoint: string, error: unknown) {
    this.refresh()
    const state = this.states.find((item) => item.endpoint === endpoint)
    if (state) {
      state.failedUntil = Date.now() + failoverCooldownMs()
      state.failureReason = errorReason(error)
    }
    warn(
      `Indexer request failed for ${operation}: endpoint=${endpoint}, reason=${errorReason(error)}, error=${error instanceof Error ? error.message : String(error)}`,
      'INDEXER',
    )
  }

  private markHeightHealthFailure(
    operation: string,
    state: EndpointState,
    error: unknown,
  ) {
    const reason = errorReason(error)
    state.failedUntil = Date.now() + failoverCooldownMs()
    state.failureReason = reason

    const shouldLog = this.shouldLogHealthChange(state, 'height_check_failed')
    state.healthStatus = 'height_check_failed'
    if (!shouldLog) return

    state.lastLoggedHealthStatus = 'height_check_failed'
    state.lastLoggedHealthLag = undefined
    warn(
      `Indexer height health check failed for ${operation}: endpoint=${state.endpoint}, reason=${reason}, error=${error instanceof Error ? error.message : String(error)}`,
      'INDEXER',
    )
  }

  private markHeightHealthUnhealthy(
    state: EndpointState,
    status: Exclude<IndexerHealthStatus, 'healthy' | 'height_check_failed'>,
    message: string,
    lag?: number,
  ) {
    state.failedUntil = Date.now() + failoverCooldownMs()
    state.failureReason = status

    const shouldLog = this.shouldLogHealthChange(state, status, lag)
    state.healthStatus = status
    if (!shouldLog) return

    state.lastLoggedHealthStatus = status
    state.lastLoggedHealthLag = lag
    warn(message, 'INDEXER')
  }

  private markHeightHealthRecovered(
    state: EndpointState,
    chain: string,
    indexerHeight: number,
    referenceHeight: number,
    lag: number,
  ) {
    const previous = state.healthStatus
    const wasUnhealthy = previous && previous !== 'healthy'
    state.healthStatus = 'healthy'
    state.lastLoggedHealthStatus = undefined
    state.lastLoggedHealthLag = undefined

    if (
      state.failureReason === 'height_lag' ||
      state.failureReason === 'indexer_unhealthy' ||
      previous === 'height_check_failed'
    ) {
      state.failedUntil = 0
      state.failureReason = undefined
    }

    if (!wasUnhealthy) return

    info(
      `Indexer recovered: endpoint=${state.endpoint}, chain=${chain}, previous=${previous}, indexerHeight=${indexerHeight}, referenceHeight=${referenceHeight}, lag=${lag}`,
      'INDEXER',
    )
  }

  private shouldLogHealthChange(
    state: EndpointState,
    nextStatus: IndexerHealthStatus,
    nextLag?: number,
  ) {
    if (state.healthStatus !== nextStatus) return true
    if (state.lastLoggedHealthStatus !== nextStatus) return true
    if (nextStatus !== 'height_lag' || nextLag === undefined) return false
    const previousLag = state.lastLoggedHealthLag
    if (previousLag === undefined) return true
    const delta = Math.abs(nextLag - previousLag)
    if (delta >= HEALTH_LOG_LAG_DELTA_THRESHOLD) return true
    return (
      delta / Math.max(Math.abs(previousLag), 1) >=
      HEALTH_LOG_LAG_RELATIVE_DELTA
    )
  }

  setActive(endpoint: string, operation: string, reason: string) {
    this.refresh()
    const nextIndex = this.states.findIndex(
      (state) => state.endpoint === endpoint,
    )
    if (nextIndex < 0) return
    const previous = this.states[this.activeIndex]?.endpoint
    this.activeIndex = nextIndex
    this.states[nextIndex].failedUntil = 0
    this.states[nextIndex].failureReason = undefined
    updateActiveIndexer(endpoint)
    if (previous && previous !== endpoint) {
      recordIndexerFailover(operation, previous, endpoint, reason)
      info(
        `Switched indexer for ${operation}: ${previous} -> ${endpoint} (${reason})`,
        'INDEXER',
      )
    }
  }

  async run<T>(
    operation: string,
    fn: (endpoint: string) => Promise<T>,
  ): Promise<{ result: T; endpoint: string }> {
    this.refresh()
    if (this.states.length === 0) {
      throw new Error('No indexer endpoints configured')
    }

    await this.refreshHeightHealth(operation)
    const order = this.requestOrder()
    const failures: string[] = []
    let lastError: unknown

    for (const index of order) {
      const endpoint = this.states[index].endpoint
      try {
        const result = await fn(endpoint)
        const previousActive = this.states[this.activeIndex]
        const failoverReason =
          lastError !== undefined
            ? errorReason(lastError)
            : previousActive?.endpoint !== endpoint &&
                previousActive?.failedUntil > Date.now()
              ? previousActive.failureReason || 'unhealthy'
              : 'success'
        this.setActive(endpoint, operation, failoverReason)
        info(
          `Indexer request succeeded for ${operation}: endpoint=${endpoint}`,
          'INDEXER',
        )
        return { result, endpoint }
      } catch (error) {
        lastError = error
        failures.push(
          `${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
        )
        this.markEndpointFailure(operation, endpoint, error)
      }
    }

    throw new Error(
      `All indexer endpoints failed for ${operation}: ${failures.join(' | ')}`,
    )
  }

  private refresh() {
    const endpoints = parseIndexerEndpoints()
    const source = endpoints.join('\n')
    if (source === this.source) return

    const previousActive = this.states[this.activeIndex]?.endpoint
    this.states = endpoints.map((endpoint) => ({ endpoint, failedUntil: 0 }))
    const previousIndex = previousActive
      ? this.states.findIndex((state) => state.endpoint === previousActive)
      : -1
    this.activeIndex = previousIndex >= 0 ? previousIndex : 0
    this.source = source
    this.heightHealthCheckedAt = 0

    const active = this.states[this.activeIndex]?.endpoint
    if (active) updateActiveIndexer(active)
  }

  private async refreshHeightHealth(operation: string) {
    this.refresh()
    if (!heightCheckEnabled() || this.states.length === 0) return

    const now = Date.now()
    if (now - this.heightHealthCheckedAt < heightCheckIntervalMs()) return
    if (this.heightHealthInFlight) {
      await this.heightHealthInFlight
      return
    }

    this.heightHealthInFlight = this.runHeightHealth(operation).finally(() => {
      this.heightHealthInFlight = null
    })
    await this.heightHealthInFlight
  }

  private async runHeightHealth(operation: string) {
    this.heightHealthCheckedAt = Date.now()
    let rpcHeight: number | undefined

    if (process.env.RPC_ENDPOINT) {
      try {
        rpcHeight = toOptionalNumber(await getRpcLatestHeight())
      } catch (error) {
        warn(
          `Failed to fetch RPC latest height for indexer health check: ${error instanceof Error ? error.message : String(error)}`,
          'INDEXER',
        )
      }
    }

    await Promise.all(
      this.states.map(async (state) => {
        try {
          const metadata = await fetchIndexerMetadata(state.endpoint)
          const indexerHeight = toOptionalNumber(metadata.lastProcessedHeight)
          const targetHeight = toOptionalNumber(metadata.targetHeight)
          const referenceHeight = rpcHeight ?? targetHeight

          if (indexerHeight === undefined || referenceHeight === undefined) {
            throw new Error(
              `Missing indexer height metadata: lastProcessedHeight=${String(metadata.lastProcessedHeight)}, targetHeight=${String(metadata.targetHeight)}`,
            )
          }

          updateIndexerHeightHealth(
            state.endpoint,
            indexerHeight,
            referenceHeight,
            targetHeight,
          )

          const lag = referenceHeight - indexerHeight
          const chain = metadata.chain || 'unknown'
          if (metadata.indexerHealthy === false) {
            this.markHeightHealthUnhealthy(
              state,
              'indexer_unhealthy',
              `Indexer metadata reports unhealthy: endpoint=${state.endpoint}, chain=${chain}, indexerHeight=${indexerHeight}, referenceHeight=${referenceHeight}`,
              lag,
            )
            return
          }

          if (lag > heightLagThreshold()) {
            this.markHeightHealthUnhealthy(
              state,
              'height_lag',
              `Indexer height lag detected: endpoint=${state.endpoint}, chain=${chain}, indexerHeight=${indexerHeight}, referenceHeight=${referenceHeight}, lag=${lag}, threshold=${heightLagThreshold()}`,
              lag,
            )
            return
          }

          this.markHeightHealthRecovered(
            state,
            chain,
            indexerHeight,
            referenceHeight,
            lag,
          )
        } catch (error) {
          this.markHeightHealthFailure(operation, state, error)
        }
      }),
    )
  }

  private requestOrder() {
    const now = Date.now()
    const indexes = this.states.map((_, index) => index)
    const activeFirst = [
      this.activeIndex,
      ...indexes.filter((index) => index !== this.activeIndex),
    ]
    const ready = activeFirst.filter(
      (index) => this.states[index].failedUntil <= now,
    )
    return ready.length > 0 ? ready : activeFirst
  }
}

const indexerPool = new IndexerPool()

export const getIndexerEndpoints = () => indexerPool.endpoints()

export const getActiveIndexerEndpoint = () => indexerPool.activeEndpoint()

export const markActiveIndexerUnhealthy = (
  operation: string,
  reason: string,
) => {
  indexerPool.markActiveUnhealthy(operation, reason)
}

const INDEXER_METADATA_QUERY = `query {
  _metadata {
    lastProcessedHeight
    targetHeight
    indexerHealthy
    chain
  }
}`

const ROUND_QUERY = (id: string) => `query {
  round(id: "${id}") {
    id
    blockHeight
    codeId
    txHash
    contractAddress
    coordinatorPubkeyX
    coordinatorPubkeyY
    circuitName
    timestamp
    votingStart
    votingEnd
    status
    period
    actionType
    roundTitle
    roundDescription
    roundLink
    gasStationEnable
    totalGrant
    baseGrant
    totalBond
    circuitType
    circuitPower
    certificationSystem
  }
}`

const ROUNDS_QUERY = (
  coordinatorPubkeyX: string,
  coordinatorPubkeyY: string,
) => `query ($limit: Int, $offset: Int) {
  rounds(
    first: $limit,
    offset: $offset,
    filter: {
      maciType: {
        equalTo: "aMACI"
      },
      caller: {
        equalTo: "${process.env.DEACTIVATE_RECORDER}"
      },
      coordinatorPubkeyX: {
        equalTo: "${coordinatorPubkeyX}" 
      },
      coordinatorPubkeyY: {
        equalTo: "${coordinatorPubkeyY}" 
      },
      period: {
        notIn: ["Ended"]
      },
      codeId: {
        notIn: ${codeIds}
      }
    }
  ) {
    totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      id
      blockHeight
      txHash
      contractAddress
      coordinatorPubkeyX
      coordinatorPubkeyY
      circuitName
      timestamp
      votingStart
      votingEnd
      status
      period
      actionType
      roundTitle
      roundDescription
      roundLink
      gasStationEnable
      totalGrant
      baseGrant
      totalBond
      circuitType
      circuitPower
      certificationSystem
      codeId
    }
  }
}`

const SIGN_UP_EVENTS_QUERY = (
  contract: string,
) => `query ($limit: Int, $offset: Int) {
  signUpEvents(
    first: $limit,
    offset: $offset,
    orderBy: [STATE_IDX_ASC],
    filter: {
      contractAddress: { 
        equalTo: "${contract}" 
      },
    }
  ) {
    totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {       
      id
      blockHeight
      timestamp
      txHash
      stateIdx
      pubKey
      balance
      contractAddress
      d0
      d1
      d2
      d3
    }
  }
}`

const PUBLISH_MESSAGE_EVENTS_QUERY = (
  contract: string,
) => `query ($limit: Int, $offset: Int) {
  publishMessageEvents(
    first: $limit,
    offset: $offset,
    orderBy: [MSG_CHAIN_LENGTH_ASC],
    filter: {
      contractAddress: { 
        equalTo: "${contract}" 
      },
    }
  ) {
    totalCount
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      id
      blockHeight
      timestamp
      txHash
      msgChainLength
      message
      encPubKey
      contractAddress
    }
  }
}`

const PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY = (
  contract: string,
) => `query ($limit: Int, $offset: Int) {
	publishDeactivateMessageEvents(
    first: $limit,
    offset: $offset,
    orderBy: [DMSG_CHAIN_LENGTH_ASC],
    filter: {
      contractAddress: { 
        equalTo: "${contract}" 
      },
    }
  ) {
	  totalCount
	  pageInfo {
      endCursor
      hasNextPage
	  }
    nodes {
      id
      blockHeight
      timestamp
      txHash
      dmsgChainLength
      numSignUps
      message
      encPubKey
      contractAddress
    }
  }
}`

const graphqlRequest = async (
  endpoint: string,
  query: string,
  variables: any,
  operation: string,
): Promise<GraphQLResponse> => {
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs())

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `HTTP error ${response.status}: ${response.statusText}\nEndpoint: ${endpoint}\nResponse: ${errorText.substring(0, 200)}...`,
      )
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      const text = await response.text()
      throw new Error(
        `Received non-JSON response (${contentType}, status ${response.status}): ${text.substring(0, 200)}...`,
      )
    }

    const parsed = (await response.json()) as GraphQLResponse
    if (parsed.errors) {
      const errorMsg = parsed.errors.map((e) => e.message).join(', ')
      throw new Error(`GraphQL API error: ${errorMsg}`)
    }
    if (!parsed.data) {
      throw new Error(
        `Empty response data from GraphQL API. Full response: ${JSON.stringify(parsed).substring(0, 200)}...`,
      )
    }

    recordExternalRequest(
      `INDEXER-${operation}`,
      (Date.now() - startedAt) / 1000,
      'success',
    )
    return parsed
  } catch (error: any) {
    const isAbort = error?.name === 'AbortError'
    const finalError = isAbort
      ? new Error(
          `Indexer request timeout after ${requestTimeoutMs()}ms (endpoint: ${endpoint})`,
        )
      : error
    recordExternalRequest(
      `INDEXER-${operation}`,
      (Date.now() - startedAt) / 1000,
      'error',
    )
    throw finalError
  } finally {
    clearTimeout(timer)
  }
}

const extractFirstData = <T>(
  response: GraphQLResponse,
  operation: string,
): T => {
  const data = response.data || {}
  const key = Object.keys(data)[0]
  if (!key) {
    throw new Error(`Empty response data from GraphQL API for ${operation}`)
  }
  const value = data[key]
  if (value == null) {
    throw new Error(`Empty response value from GraphQL API for ${operation}`)
  }
  return value as T
}

async function fetchOneFromEndpoint<T>(
  endpoint: string,
  query: string,
  operation: string,
): Promise<T> {
  const response = await graphqlRequest(endpoint, query, {}, operation)
  return extractFirstData<T>(response, operation)
}

async function fetchIndexerMetadata(
  endpoint: string,
): Promise<IndexerMetadata> {
  return fetchOneFromEndpoint<IndexerMetadata>(
    endpoint,
    INDEXER_METADATA_QUERY,
    'height_health',
  )
}

async function fetchAllPagesFromEndpoint<T>(
  endpoint: string,
  query: string,
  variables: any,
  operation: string,
): Promise<T[]> {
  let hasNextPage = true
  let offset = 0
  const allData: T[] = []

  while (hasNextPage) {
    const response = await graphqlRequest(
      endpoint,
      query,
      { ...variables, limit: DEFAULT_PAGE_LIMIT, offset },
      operation,
    )
    const key = Object.keys(response.data || {})[0]
    const page = response.data?.[key] as PageResponse<T> | undefined

    if (!page?.nodes || !page.pageInfo) {
      throw new Error(
        `Invalid response format from GraphQL API: missing nodes or pageInfo in ${key}. Response: ${JSON.stringify(response.data).substring(0, 200)}...`,
      )
    }

    allData.push(...page.nodes)
    hasNextPage = page.pageInfo.hasNextPage
    offset += DEFAULT_PAGE_LIMIT
  }

  return allData
}

async function fetchAllPagesStreamFromEndpoint<T extends { id?: string }>(
  endpoint: string,
  query: string,
  variables: any,
  operation: string,
  onPage: (nodes: T[]) => Promise<void> | void,
): Promise<{ count: number; lastId: string }> {
  let hasNextPage = true
  let offset = 0
  let count = 0
  let lastId = ''

  while (hasNextPage) {
    const response = await graphqlRequest(
      endpoint,
      query,
      { ...variables, limit: DEFAULT_PAGE_LIMIT, offset },
      operation,
    )
    const key = Object.keys(response.data || {})[0]
    const page = response.data?.[key] as PageResponse<T> | undefined

    if (!page?.nodes || !page.pageInfo) {
      throw new Error(
        `Invalid response format from GraphQL API: missing nodes or pageInfo in ${key}. Response: ${JSON.stringify(response.data).substring(0, 200)}...`,
      )
    }

    await onPage(page.nodes)
    count += page.nodes.length
    if (
      page.nodes.length > 0 &&
      typeof page.nodes[page.nodes.length - 1].id === 'string'
    ) {
      lastId = page.nodes[page.nodes.length - 1].id || ''
    }
    hasNextPage = page.pageInfo.hasNextPage
    offset += DEFAULT_PAGE_LIMIT
  }

  return { count, lastId }
}

const fetchRoundsFromEndpoint = async (
  endpoint: string,
  coordinatorPubkeys: string[][],
) => {
  const rounds = await Promise.all(
    coordinatorPubkeys.map((coordinatorPubkey) =>
      fetchAllPagesFromEndpoint<RoundData>(
        endpoint,
        ROUNDS_QUERY(coordinatorPubkey[0], coordinatorPubkey[1]),
        {},
        'fetch_rounds',
      ),
    ),
  )
  return rounds.flat()
}

export const fetchRounds = async (
  coordinatorPubkeys: string[] | string[][],
) => {
  const pubkeys = normalizeCoordinatorPubkeys(coordinatorPubkeys)
  const { result } = await indexerPool.run('fetch_rounds', (endpoint) =>
    fetchRoundsFromEndpoint(endpoint, pubkeys),
  )
  return mergeRoundsById(result)
}

export const fetchRound = async (id: string) => {
  const { result } = await indexerPool.run('fetch_round', (endpoint) =>
    fetchOneFromEndpoint<RoundData>(endpoint, ROUND_QUERY(id), 'fetch_round'),
  )
  return result
}

export const fetchAllVotesLogs = async (
  contract: string,
): Promise<VotesLogResult> => {
  const { result, endpoint } = await indexerPool.run(
    'fetch_votes_logs',
    async (endpoint) => {
      const signup = await fetchAllPagesFromEndpoint<SignUpEvent>(
        endpoint,
        SIGN_UP_EVENTS_QUERY(contract),
        {},
        'fetch_signups',
      )
      const msg = await fetchAllPagesFromEndpoint<PublishMessageEvent>(
        endpoint,
        PUBLISH_MESSAGE_EVENTS_QUERY(contract),
        {},
        'fetch_publish_messages',
      )
      const dmsg =
        await fetchAllPagesFromEndpoint<PublishDeactivateMessageEvent>(
          endpoint,
          PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY(contract),
          {},
          'fetch_publish_deactivate_messages',
        )

      return { signup, msg, dmsg }
    },
  )

  return { ...result, indexerEndpoint: endpoint }
}

export const fetchAllVotesLogsStream = async (
  contract: string,
  onMessagePage: (nodes: PublishMessageEvent[]) => Promise<void> | void,
  onAttemptStart?: (endpoint: string) => Promise<void> | void,
): Promise<StreamVotesLogResult> => {
  const { result, endpoint } = await indexerPool.run(
    'fetch_votes_logs_stream',
    async (endpoint) => {
      const signup = await fetchAllPagesFromEndpoint<SignUpEvent>(
        endpoint,
        SIGN_UP_EVENTS_QUERY(contract),
        {},
        'fetch_signups',
      )
      const dmsg =
        await fetchAllPagesFromEndpoint<PublishDeactivateMessageEvent>(
          endpoint,
          PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY(contract),
          {},
          'fetch_publish_deactivate_messages',
        )
      await onAttemptStart?.(endpoint)
      const messageStream =
        await fetchAllPagesStreamFromEndpoint<PublishMessageEvent>(
          endpoint,
          PUBLISH_MESSAGE_EVENTS_QUERY(contract),
          {},
          'stream_publish_messages',
          onMessagePage,
        )

      return { signup, dmsg, messageStream }
    },
  )

  return { ...result, indexerEndpoint: endpoint }
}

export const streamPublishMessageEvents = async (
  contract: string,
  onPage: (nodes: PublishMessageEvent[]) => Promise<void> | void,
) => {
  const { result } = await indexerPool.run(
    'stream_publish_messages',
    (endpoint) =>
      fetchAllPagesStreamFromEndpoint<PublishMessageEvent>(
        endpoint,
        PUBLISH_MESSAGE_EVENTS_QUERY(contract),
        {},
        'stream_publish_messages',
        onPage,
      ),
  )
  return result
}

export const fetchAllDeactivateLogs = async (
  contract: string,
): Promise<DeactivateLogResult> => {
  const { result, endpoint } = await indexerPool.run(
    'fetch_deactivate_logs',
    async (endpoint) => {
      const signup = await fetchAllPagesFromEndpoint<SignUpEvent>(
        endpoint,
        SIGN_UP_EVENTS_QUERY(contract),
        {},
        'fetch_signups',
      )
      const dmsg =
        await fetchAllPagesFromEndpoint<PublishDeactivateMessageEvent>(
          endpoint,
          PUBLISH_DEACTIVATE_MESSAGE_EVENTS_QUERY(contract),
          {},
          'fetch_publish_deactivate_messages',
        )

      return { signup, dmsg }
    },
  )

  return { ...result, indexerEndpoint: endpoint }
}
