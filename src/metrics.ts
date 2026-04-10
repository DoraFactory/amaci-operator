import * as client from 'prom-client'
import express from 'express'
import { info, debug } from './logger'

const register = client.register
client.collectDefaultMetrics({ register })

const startTime = Date.now()

type TaskRuntime = {
  startTime: number
  circuitPower: string
  completionRecorded: boolean
}

type TaskLabels = {
  circuitPower?: string
}

type ExternalLabels = {
  dependency: 'rpc' | 'indexer' | 'unknown'
  operation: string
}

type SubmissionMode = 'batch' | 'single'

const DEFAULT_CIRCUIT_POWER = 'unknown'

const operatorUptime = new client.Gauge({
  name: 'amaci_operator_uptime_seconds',
  help: 'How long the operator service has been running, in seconds',
  registers: [register],
})

const operatorBalanceGauge = new client.Gauge({
  name: 'amaci_operator_balance_dora',
  help: 'Current operator balance in DORA tokens',
  registers: [register],
})

const lastSuccessfulInspection = new client.Gauge({
  name: 'amaci_operator_last_successful_inspection_timestamp_seconds',
  help: 'Unix timestamp in seconds of the last successful inspection',
  registers: [register],
})

const lastSuccessfulTally = new client.Gauge({
  name: 'amaci_operator_last_successful_tally_timestamp_seconds',
  help: 'Unix timestamp in seconds of the last successful tally operation',
  registers: [register],
})

const lastSuccessfulDeactivate = new client.Gauge({
  name: 'amaci_operator_last_successful_deactivate_timestamp_seconds',
  help: 'Unix timestamp in seconds of the last successful deactivate operation',
  registers: [register],
})

const taskCounter = new client.Counter({
  name: 'amaci_operator_tasks_total',
  help: 'Total number of tasks processed',
  labelNames: ['task_type', 'status'],
  registers: [register],
})

const taskCompletedDuration = new client.Histogram({
  name: 'amaci_operator_task_completed_duration_seconds',
  help: 'Completed task duration in seconds',
  labelNames: ['task_type', 'status', 'circuit_power'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200],
  registers: [register],
})

const roundStatusGauge = new client.Gauge({
  name: 'amaci_operator_rounds_status',
  help: 'Number of rounds in each status',
  labelNames: ['status'],
  registers: [register],
})

const activeRoundsGauge = new client.Gauge({
  name: 'amaci_operator_active_rounds',
  help: 'Currently active rounds grouped by period and circuit power',
  labelNames: ['period', 'circuit_power'],
  registers: [register],
})

const completedRoundsCounter = new client.Counter({
  name: 'amaci_operator_completed_rounds_total',
  help: 'Total number of successfully completed rounds',
  registers: [register],
})

const roundsCounter = new client.Counter({
  name: 'amaci_operator_rounds_total',
  help: 'Total number of rounds observed by terminal status and circuit power',
  labelNames: ['circuit_power', 'status'],
  registers: [register],
})

const proverActiveChildren = new client.Gauge({
  name: 'amaci_prover_active_children',
  help: 'Number of active prover child processes',
  registers: [register],
})

const proverJobsTotal = new client.Counter({
  name: 'amaci_prover_jobs_total',
  help: 'Total number of prover jobs processed',
  labelNames: ['phase'],
  registers: [register],
})

const proverPhaseDuration = new client.Histogram({
  name: 'amaci_prover_phase_duration_seconds',
  help: 'Time spent generating proofs per phase and circuit power',
  labelNames: ['phase', 'circuit_power'],
  buckets: [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200],
  registers: [register],
})

const activeTasksGauge = new client.Gauge({
  name: 'amaci_operator_active_tasks',
  help: 'Number of active tasks by type',
  labelNames: ['task_type'],
  registers: [register],
})

const inspectedTasksGauge = new client.Gauge({
  name: 'amaci_operator_inspected_tasks',
  help: 'Number of tasks found during inspection',
  labelNames: ['task_type'],
  registers: [register],
})

const operatorStateGauge = new client.Gauge({
  name: 'amaci_operator_current_state',
  help: 'Current state of the operator (1 = active, 0 = inactive)',
  labelNames: ['state'],
  registers: [register],
})

const taskDurationGauge = new client.Gauge({
  name: 'amaci_operator_task_duration_seconds',
  help: 'Maximum duration of currently running tasks in seconds',
  labelNames: ['task_type', 'circuit_power'],
  registers: [register],
})

const apiRetryExhaustedCounter = new client.Counter({
  name: 'amaci_operator_api_retry_exhausted_total',
  help: 'Total number of API calls that exhausted retries',
  labelNames: ['context'],
  registers: [register],
})

const proofBatchesCounter = new client.Counter({
  name: 'amaci_operator_proof_batches_total',
  help: 'Total number of generated proof batches',
  labelNames: ['phase', 'circuit_power'],
  registers: [register],
})

const proofItemsCounter = new client.Counter({
  name: 'amaci_operator_proof_items_total',
  help: 'Total number of proof items generated',
  labelNames: ['phase', 'circuit_power'],
  registers: [register],
})

const proofBatchDuration = new client.Histogram({
  name: 'amaci_operator_proof_batch_duration_seconds',
  help: 'Duration of proof batch generation in seconds',
  labelNames: ['phase', 'circuit_power'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200],
  registers: [register],
})

const submitBatchesCounter = new client.Counter({
  name: 'amaci_operator_submit_batches_total',
  help: 'Total number of submitted on-chain proof batches',
  labelNames: ['phase', 'circuit_power', 'mode'],
  registers: [register],
})

const submitItemsCounter = new client.Counter({
  name: 'amaci_operator_submit_items_total',
  help: 'Total number of on-chain submitted proof items',
  labelNames: ['phase', 'circuit_power', 'mode'],
  registers: [register],
})

const submitBatchDuration = new client.Histogram({
  name: 'amaci_operator_submit_batch_duration_seconds',
  help: 'Duration of on-chain batch submissions in seconds',
  labelNames: ['phase', 'circuit_power', 'mode'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600],
  registers: [register],
})

const roundStageDuration = new client.Histogram({
  name: 'amaci_operator_round_stage_duration_seconds',
  help: 'Round stage durations in seconds by stage and circuit power',
  labelNames: ['stage', 'circuit_power'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 3600, 7200],
  registers: [register],
})

const cacheCounter = new client.Counter({
  name: 'amaci_operator_cache_total',
  help: 'Cache hits and misses by phase and circuit power',
  labelNames: ['phase', 'circuit_power', 'result'],
  registers: [register],
})

const externalRequestsCounter = new client.Counter({
  name: 'amaci_operator_external_requests_total',
  help: 'Total external requests by dependency, operation, and status',
  labelNames: ['dependency', 'operation', 'status'],
  registers: [register],
})

const externalRequestDuration = new client.Histogram({
  name: 'amaci_operator_external_request_duration_seconds',
  help: 'External request duration in seconds by dependency and operation',
  labelNames: ['dependency', 'operation'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [register],
})

const externalRetriesCounter = new client.Counter({
  name: 'amaci_operator_external_retries_total',
  help: 'Total number of external request retries',
  labelNames: ['dependency', 'operation'],
  registers: [register],
})

const externalRetryExhaustedCounter = new client.Counter({
  name: 'amaci_operator_external_retry_exhausted_total',
  help: 'Total number of external requests that exhausted retries',
  labelNames: ['dependency', 'operation'],
  registers: [register],
})

const proverPoolSize = new client.Gauge({
  name: 'amaci_prover_pool_children',
  help: 'Number of child processes in the prover pool',
  registers: [register],
})

const taskRuntimes = new Map<string, Map<string, TaskRuntime>>()

function sanitizeLabelValue(value: string | undefined, fallback: string) {
  const normalized = (value || '').trim()
  return normalized ? normalized : fallback
}

function taskCircuitPower(runtime?: TaskRuntime) {
  return sanitizeLabelValue(runtime?.circuitPower, DEFAULT_CIRCUIT_POWER)
}

function getTaskRuntime(taskType: string, roundId: string) {
  return taskRuntimes.get(taskType)?.get(roundId)
}

function observeTaskCompletion(
  taskType: string,
  roundId: string,
  status: 'success' | 'failed',
) {
  const runtime = getTaskRuntime(taskType, roundId)
  if (!runtime || runtime.completionRecorded) return

  const durationSeconds = Math.max(0, (Date.now() - runtime.startTime) / 1000)
  taskCompletedDuration.observe(
    {
      task_type: taskType,
      status,
      circuit_power: taskCircuitPower(runtime),
    },
    durationSeconds,
  )
  runtime.completionRecorded = true
}

function refreshTaskGauges() {
  activeTasksGauge.reset()
  taskDurationGauge.reset()

  const activeTaskCounts = new Map<string, number>()
  const runningDurationByKey = new Map<string, number>()
  const now = Date.now()

  for (const [taskType, taskMap] of taskRuntimes.entries()) {
    if (taskType !== 'inspect') {
      activeTaskCounts.set(taskType, taskMap.size)
    }

    for (const runtime of taskMap.values()) {
      if (taskType === 'inspect') continue
      const durationSeconds = Math.max(0, (now - runtime.startTime) / 1000)
      const circuitPower = taskCircuitPower(runtime)
      const key = `${taskType}|${circuitPower}`
      const previous = runningDurationByKey.get(key)
      if (previous == null || durationSeconds > previous) {
        runningDurationByKey.set(key, durationSeconds)
      }
    }
  }

  for (const [taskType, count] of activeTaskCounts.entries()) {
    activeTasksGauge.set({ task_type: taskType }, count)
  }

  for (const [key, durationSeconds] of runningDurationByKey.entries()) {
    const [taskType, circuitPower] = key.split('|')
    taskDurationGauge.set(
      { task_type: taskType, circuit_power: circuitPower },
      durationSeconds,
    )
  }
}

function inferExternalLabels(context: string): ExternalLabels {
  const raw = sanitizeLabelValue(context, 'unknown')
  const lower = raw.toLowerCase()

  let dependency: ExternalLabels['dependency'] = 'unknown'
  if (lower.includes('indexer')) dependency = 'indexer'
  else if (
    lower.includes('rpc') ||
    lower.includes('contract') ||
    lower.includes('registry') ||
    lower.includes('balance')
  ) {
    dependency = 'rpc'
  }

  const operation = lower
    .replace(/^(indexer|rpc|contract|registry|balance)[-_]?/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return {
    dependency,
    operation: operation || 'unknown',
  }
}

const normalizeRetryContext = (context: string) => {
  const value = (context || '').toLowerCase()
  if (!value) return 'unknown'
  if (value.includes('indexer')) return 'indexer'
  if (
    value.includes('rpc') ||
    value.includes('balance') ||
    value.includes('contract') ||
    value.includes('registry')
  ) {
    return 'rpc'
  }
  return 'unknown'
}

setInterval(() => {
  operatorUptime.set((Date.now() - startTime) / 1000)
  refreshTaskGauges()
}, 10000)

export const recordTaskSuccess = (taskType: string, roundId: string = 'global') => {
  taskCounter.inc({ task_type: taskType, status: 'success' })
  observeTaskCompletion(taskType, roundId, 'success')

  const nowSeconds = Date.now() / 1000
  switch (taskType) {
    case 'inspect':
      lastSuccessfulInspection.set(nowSeconds)
      break
    case 'tally':
      lastSuccessfulTally.set(nowSeconds)
      break
    case 'deactivate':
      lastSuccessfulDeactivate.set(nowSeconds)
      break
  }
}

export const recordTaskFailure = (taskType: string, roundId: string = 'global') => {
  taskCounter.inc({ task_type: taskType, status: 'failed' })
  observeTaskCompletion(taskType, roundId, 'failed')
}

export const updateRoundStatus = (statusCounts: Record<string, number>) => {
  roundStatusGauge.reset()
  Object.entries(statusCounts).forEach(([status, count]) => {
    roundStatusGauge.set({ status }, count)
  })
}

export const updateActiveRounds = (
  activeRounds: Array<{ id?: string; period: string; circuitPower?: string }>,
) => {
  activeRoundsGauge.reset()

  const counts = new Map<string, number>()
  for (const round of activeRounds) {
    const period = sanitizeLabelValue(round.period, 'unknown')
    const circuitPower = sanitizeLabelValue(
      round.circuitPower,
      DEFAULT_CIRCUIT_POWER,
    )
    const key = `${period}|${circuitPower}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  for (const [key, count] of counts.entries()) {
    const [period, circuitPower] = key.split('|')
    activeRoundsGauge.set({ period, circuit_power: circuitPower }, count)
  }
}

export const recordRoundCompletion = (
  roundId: string,
  circuitPower: string = DEFAULT_CIRCUIT_POWER,
) => {
  completedRoundsCounter.inc()
  roundsCounter.inc({
    circuit_power: sanitizeLabelValue(circuitPower, DEFAULT_CIRCUIT_POWER),
    status: 'completed',
  })
  info(`Round ${roundId} successfully completed`, 'METRICS')
}

export const incProverActiveChildren = () => {
  proverActiveChildren.inc()
}

export const decProverActiveChildren = () => {
  try {
    proverActiveChildren.dec()
  } catch {}
}

export const incProverJobs = (count: number, phase: string = 'unknown') => {
  if (count > 0) proverJobsTotal.inc({ phase }, count)
}

export const recordProverPhaseDuration = (
  roundId: string,
  phase: string,
  seconds: number,
  circuitPower: string = DEFAULT_CIRCUIT_POWER,
) => {
  if (seconds < 0) return

  const normalizedCircuitPower = sanitizeLabelValue(
    circuitPower,
    DEFAULT_CIRCUIT_POWER,
  )
  proverPhaseDuration.observe(
    { phase, circuit_power: normalizedCircuitPower },
    seconds,
  )
  roundStageDuration.observe(
    { stage: `${phase}_prove`, circuit_power: normalizedCircuitPower },
    seconds,
  )
  info(
    `Prover phase ${phase} took ${seconds.toFixed(2)}s for round ${roundId}`,
    'METRICS',
  )
}

export const setProverPoolSize = (size: number) => {
  proverPoolSize.set(size)
}

export const recordTaskStart = (
  taskType: string,
  roundId: string,
  labels: TaskLabels = {},
) => {
  updateOperatorState(taskType)

  if (!taskRuntimes.has(taskType)) {
    taskRuntimes.set(taskType, new Map())
  }

  taskRuntimes.get(taskType)!.set(roundId, {
    startTime: Date.now(),
    circuitPower: sanitizeLabelValue(
      labels.circuitPower,
      DEFAULT_CIRCUIT_POWER,
    ),
    completionRecorded: false,
  })

  refreshTaskGauges()

  info(
    `Task ${taskType} started for round ${roundId}. Operator state updated to ${taskType}.`,
    'METRICS',
  )
}

export const updateTaskContext = (
  taskType: string,
  roundId: string,
  labels: TaskLabels,
) => {
  const runtime = getTaskRuntime(taskType, roundId)
  if (!runtime) return

  if (labels.circuitPower) {
    runtime.circuitPower = sanitizeLabelValue(
      labels.circuitPower,
      DEFAULT_CIRCUIT_POWER,
    )
  }

  refreshTaskGauges()
}

export const recordTaskEnd = (taskType: string, roundId: string) => {
  if (taskRuntimes.has(taskType)) {
    taskRuntimes.get(taskType)!.delete(roundId)
  }

  refreshTaskGauges()

  if (taskRuntimes.has('tally') && taskRuntimes.get('tally')!.size > 0) {
    updateOperatorState('tally')
  } else if (
    taskRuntimes.has('deactivate') &&
    taskRuntimes.get('deactivate')!.size > 0
  ) {
    updateOperatorState('deactivate')
  } else {
    updateOperatorState('inspect')
  }
}

export const updateActiveTasksCount = () => {
  refreshTaskGauges()
}

export const updateOperatorState = (currentState: string) => {
  const allStates = ['inspect', 'tally', 'deactivate']

  for (const state of allStates) {
    operatorStateGauge.set({ state }, state === currentState ? 1 : 0)
  }
}

export const updateInspectedTasksCount = (
  taskCounts: Record<string, number>,
) => {
  inspectedTasksGauge.reset()
  Object.entries(taskCounts).forEach(([taskType, count]) => {
    inspectedTasksGauge.set({ task_type: taskType }, count)
  })
}

export const updateOperatorBalance = (balance: number) => {
  operatorBalanceGauge.set(balance)
  info(`Updated operator balance metrics: ${balance} DORA`, 'METRICS')
}

export const recordProofBatch = (
  phase: string,
  circuitPower: string,
  itemCount: number,
  durationSeconds: number,
) => {
  const normalizedCircuitPower = sanitizeLabelValue(
    circuitPower,
    DEFAULT_CIRCUIT_POWER,
  )
  proofBatchesCounter.inc({ phase, circuit_power: normalizedCircuitPower })
  if (itemCount > 0) {
    proofItemsCounter.inc(
      { phase, circuit_power: normalizedCircuitPower },
      itemCount,
    )
  }
  proofBatchDuration.observe(
    { phase, circuit_power: normalizedCircuitPower },
    Math.max(0, durationSeconds),
  )
}

export const recordSubmitBatch = (
  phase: string,
  circuitPower: string,
  mode: SubmissionMode,
  itemCount: number,
  durationSeconds: number,
) => {
  const normalizedCircuitPower = sanitizeLabelValue(
    circuitPower,
    DEFAULT_CIRCUIT_POWER,
  )
  submitBatchesCounter.inc({
    phase,
    circuit_power: normalizedCircuitPower,
    mode,
  })
  if (itemCount > 0) {
    submitItemsCounter.inc(
      {
        phase,
        circuit_power: normalizedCircuitPower,
        mode,
      },
      itemCount,
    )
  }
  submitBatchDuration.observe(
    {
      phase,
      circuit_power: normalizedCircuitPower,
      mode,
    },
    Math.max(0, durationSeconds),
  )
}

export const recordRoundStageDuration = (
  stage: string,
  circuitPower: string,
  seconds: number,
) => {
  roundStageDuration.observe(
    {
      stage,
      circuit_power: sanitizeLabelValue(circuitPower, DEFAULT_CIRCUIT_POWER),
    },
    Math.max(0, seconds),
  )
}

export const recordCacheResult = (
  phase: string,
  circuitPower: string,
  result: 'hit' | 'miss',
) => {
  cacheCounter.inc({
    phase,
    circuit_power: sanitizeLabelValue(circuitPower, DEFAULT_CIRCUIT_POWER),
    result,
  })
}

export const recordExternalRequest = (
  context: string,
  durationSeconds: number,
  status: 'success' | 'error',
) => {
  const { dependency, operation } = inferExternalLabels(context)
  externalRequestsCounter.inc({ dependency, operation, status })
  externalRequestDuration.observe({ dependency, operation }, durationSeconds)
}

export const recordExternalRetry = (context: string) => {
  const { dependency, operation } = inferExternalLabels(context)
  externalRetriesCounter.inc({ dependency, operation })
}

export const recordApiRetryExhausted = (context: string) => {
  const normalizedContext = normalizeRetryContext(context)
  apiRetryExhaustedCounter.inc({ context: normalizedContext })

  const { dependency, operation } = inferExternalLabels(context)
  externalRetryExhaustedCounter.inc({ dependency, operation })
}

export const updateOperatorStatus = (isUp: boolean) => {
  debug(
    `Operator status tracking: ${isUp ? 'Running' : 'Shutting down'}`,
    'METRICS',
  )

  if (!isUp) {
    operatorUptime.set((Date.now() - startTime) / 1000)
  }
}

export const startMetricsServer = (port: number = 9090) => {
  const app = express()

  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType)
      res.end(await register.metrics())
    } catch (err) {
      res.status(500).end(err instanceof Error ? err.message : String(err))
    }
  })

  app.get('/health', (_req, res) => {
    res.status(200).send('OK')
  })

  app.listen(port, () => {
    info(`Metrics server started on port ${port}`, 'METRICS')
  })
}
