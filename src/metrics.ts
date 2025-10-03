import * as client from 'prom-client'
import express from 'express'
import { info, debug } from './logger'

// Create Registry
const register = client.register

// Add default metrics
client.collectDefaultMetrics({ register })

// operator start time
const startTime = Date.now()

// Add operator uptime metric in seconds
const operatorUptime = new client.Gauge({
  name: 'amaci_operator_uptime_seconds',
  help: 'How long the operator service has been running, in seconds',
  registers: [register],
})

// Operator balance metric
const operatorBalanceGauge = new client.Gauge({
  name: 'amaci_operator_balance_dora',
  help: 'Current operator balance in DORA tokens',
  registers: [register],
})

// Last successful inspection timestamp
const lastSuccessfulInspection = new client.Gauge({
  name: 'amaci_operator_last_successful_inspection_timestamp',
  help: 'Timestamp of the last successful inspection',
  registers: [register],
})

// Last successful tally timestamp
const lastSuccessfulTally = new client.Gauge({
  name: 'amaci_operator_last_successful_tally_timestamp',
  help: 'Timestamp of the last successful tally operation',
  registers: [register],
})

// Last successful deactivate timestamp
const lastSuccessfulDeactivate = new client.Gauge({
  name: 'amaci_operator_last_successful_deactivate_timestamp',
  help: 'Timestamp of the last successful deactivate operation',
  registers: [register],
})

// Task counter
const taskCounter = new client.Counter({
  name: 'amaci_operator_tasks_total',
  help: 'Total number of tasks processed',
  labelNames: ['task_type', 'status'],
  registers: [register],
})

// Round status metrics
const roundStatusGauge = new client.Gauge({
  name: 'amaci_operator_rounds_status',
  help: 'Number of rounds in each status',
  labelNames: ['status'],
  registers: [register],
})

// Active rounds metrics
const activeRoundsGauge = new client.Gauge({
  name: 'amaci_operator_active_rounds',
  help: 'Currently active rounds in the system',
  labelNames: ['round_id', 'period'],
  registers: [register],
})

// Completed rounds counter
const completedRoundsCounter = new client.Counter({
  name: 'amaci_operator_completed_rounds_total',
  help: 'Total number of successfully completed rounds',
  registers: [register],
})

// Prover metrics: active children and jobs
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

// Prover phase duration (proof generation time per phase)
const proverPhaseDuration = new client.Histogram({
  name: 'amaci_prover_phase_duration_seconds',
  help: 'Time spent generating proofs per phase (deactivate/msg/tally)',
  labelNames: ['phase', 'round_id'],
  // Buckets in seconds
  buckets: [1, 2, 5, 10, 20, 30, 60, 120, 300, 600],
  registers: [register],
})

// Active tasks gauge
const activeTasksGauge = new client.Gauge({
  name: 'amaci_operator_active_tasks',
  help: 'Number of active tasks by type',
  labelNames: ['task_type'],
  registers: [register],
})

// new: Inspect task metrics
const inspectedTasksGauge = new client.Gauge({
  name: 'amaci_operator_inspected_tasks',
  help: 'Number of tasks found during inspection',
  labelNames: ['task_type'],
  registers: [register],
})

// Operator current state gauge
const operatorStateGauge = new client.Gauge({
  name: 'amaci_operator_current_state',
  help: 'Current state of the operator (1 = active, 0 = inactive)',
  labelNames: ['state'],
  registers: [register],
})

// Task duration gauge
const taskDurationGauge = new client.Gauge({
  name: 'amaci_operator_task_duration_seconds',
  help: 'Duration of current running tasks in seconds',
  labelNames: ['task_type', 'round_id'],
  registers: [register],
})

// Task start times map
const taskStartTimes = new Map<string, Map<string, number>>()

// update the operator uptime instead of the binary status
setInterval(() => {
  // calculate the operator uptime (seconds)
  const uptimeSeconds = (Date.now() - startTime) / 1000
  // update the uptime metric
  operatorUptime.set(uptimeSeconds)
}, 10000)

/**
 * Record a successful task execution
 * @param taskType Task type
 */
export const recordTaskSuccess = (taskType: string) => {
  taskCounter.inc({ task_type: taskType, status: 'success' })

  // Update last successful timestamp
  const now = Date.now()
  switch (taskType) {
    case 'inspect':
      lastSuccessfulInspection.set(now)
      break
    case 'tally':
      lastSuccessfulTally.set(now)
      break
    case 'deactivate':
      lastSuccessfulDeactivate.set(now)
      break
  }
}

/**
 * Update round status statistics
 * @param statusCounts Status count object
 */
export const updateRoundStatus = (statusCounts: Record<string, number>) => {
  // Reset all metrics
  roundStatusGauge.reset()

  // Set new values
  Object.entries(statusCounts).forEach(([status, count]) => {
    roundStatusGauge.set({ status }, count)
  })
}

/**
 * Update active round list
 * @param activeRounds Active round list, containing id and period
 */
export const updateActiveRounds = (
  activeRounds: Array<{ id: string; period: string }>,
) => {
  // Reset all active round metrics
  activeRoundsGauge.reset()
  // Set each active round
  activeRounds.forEach((round) => {
    activeRoundsGauge.set({ round_id: round.id, period: round.period }, 1)
  })
}

/**
 * Record a round completion
 * @param roundId Completed round ID
 */
export const recordRoundCompletion = (roundId: string) => {
  // Increment completed round counter
  completedRoundsCounter.inc()

  // 可以在这里添加日志记录
  info(`Round ${roundId} successfully completed`, 'METRICS')
}

/** Prover metrics helpers */
export const incProverActiveChildren = () => {
  proverActiveChildren.inc()
}

export const decProverActiveChildren = () => {
  // Guard against going below zero
  try {
    proverActiveChildren.dec()
  } catch {}
}

export const incProverJobs = (count: number, phase: string = 'unknown') => {
  if (count > 0) proverJobsTotal.inc({ phase }, count)
}

/** Record prover phase duration (in seconds) */
export const recordProverPhaseDuration = (
  roundId: string,
  phase: string,
  seconds: number,
) => {
  if (seconds >= 0) {
    proverPhaseDuration.labels(phase, roundId).observe(seconds)
    info(
      `Prover phase ${phase} took ${seconds.toFixed(2)}s for round ${roundId}`,
      'METRICS',
    )
  }
}

// Total children in the pool (long-lived)
const proverPoolSize = new client.Gauge({
  name: 'amaci_prover_pool_children',
  help: 'Number of child processes in the prover pool',
  registers: [register],
})

export const setProverPoolSize = (size: number) => {
  proverPoolSize.set(size)
}

/**
 * Record task start
 * @param taskType Task type
 * @param roundId Round ID
 */
export const recordTaskStart = (taskType: string, roundId: string) => {
  // Metrics: Update operator state - ensure the status is updated to the current task type
  updateOperatorState(taskType)

  // Record start time
  const now = Date.now()

  if (!taskStartTimes.has(taskType)) {
    taskStartTimes.set(taskType, new Map())
  }

  const taskMap = taskStartTimes.get(taskType)!
  taskMap.set(roundId, now)

  // Metrics: Only increase the active tasks count and track the duration for non-inspect tasks
  if (taskType !== 'inspect') {
    // Increment active tasks count
    activeTasksGauge.inc({ task_type: taskType })

    // Start tracking task duration
    startTrackingTaskDuration(taskType, roundId)
  }

  // Add log for debugging
  info(
    `Task ${taskType} started for round ${roundId}. Operator state updated to ${taskType}.`,
    'METRICS',
  )
}

/**
 * Record task end
 * @param taskType Task type
 * @param roundId Round ID
 */
export const recordTaskEnd = (taskType: string, roundId: string) => {
  // Remove task record
  if (taskStartTimes.has(taskType)) {
    const taskMap = taskStartTimes.get(taskType)!
    taskMap.delete(roundId)
  }

  // Metrics: Only decrease the active tasks count and delete the duration for non-inspect tasks
  if (taskType !== 'inspect') {
    // Decrement active tasks count
    activeTasksGauge.dec({ task_type: taskType })

    // Metrics: Completely delete the duration metric for this task, not just set to 0
    taskDurationGauge.remove({ task_type: taskType, round_id: roundId })
  }

  // Check if all tasks are empty
  let allTasksEmpty = true
  let hasHigherPriorityTask = false

  // Metrics: Check if there is a higher priority task running
  // Priority: tally > deactivate > inspect
  if (taskStartTimes.has('tally') && taskStartTimes.get('tally')!.size > 0) {
    hasHigherPriorityTask = true
    updateOperatorState('tally')
  } else if (
    taskStartTimes.has('deactivate') &&
    taskStartTimes.get('deactivate')!.size > 0
  ) {
    hasHigherPriorityTask = true
    updateOperatorState('deactivate')
  } else {
    // Metrics: Default back to inspect state, not idle
    updateOperatorState('inspect')
  }
}

/**
 * Update operator state, showing only one state at a time
 * @param currentState Current state
 */
export const updateOperatorState = (currentState: string) => {
  const allStates = ['inspect', 'tally', 'deactivate']

  allStates.forEach((state) => {
    if (state === currentState) {
      operatorStateGauge.set({ state }, 1)
    } else {
      operatorStateGauge.set({ state }, 0)
    }
  })
}

/**
 * Start tracking task duration
 * @param taskType Task type
 * @param roundId Round ID
 */
const startTrackingTaskDuration = (taskType: string, roundId: string) => {
  // Update duration every second
  const intervalId = setInterval(() => {
    // Check if task is still running
    if (
      taskStartTimes.has(taskType) &&
      taskStartTimes.get(taskType)!.has(roundId)
    ) {
      const startTime = taskStartTimes.get(taskType)!.get(roundId)!
      const durationSeconds = (Date.now() - startTime) / 1000

      taskDurationGauge.set(
        { task_type: taskType, round_id: roundId },
        durationSeconds,
      )
    } else {
      // If task no longer exists, clear timer
      clearInterval(intervalId)
    }
  }, 1000)
}

/**
 * Get current active tasks count
 */
export const updateActiveTasksCount = () => {
  // Reset active tasks count
  activeTasksGauge.reset()

  // Count active tasks for each type
  for (const [taskType, taskMap] of taskStartTimes.entries()) {
    activeTasksGauge.set({ task_type: taskType }, taskMap.size)
  }
}

/**
 * Update the number of tasks found during inspection
 * @param taskCounts The mapping of task types and their counts
 */
export const updateInspectedTasksCount = (
  taskCounts: Record<string, number>,
) => {
  // Reset the inspected tasks count
  inspectedTasksGauge.reset()

  Object.entries(taskCounts).forEach(([taskType, count]) => {
    inspectedTasksGauge.set({ task_type: taskType }, count)
  })
}

/**
 * Update operator balance metrics
 * @param balance Current operator balance in DORA
 */
export const updateOperatorBalance = (balance: number) => {
  operatorBalanceGauge.set(balance)

  // Add log for debugging
  info(`Updated operator balance metrics: ${balance} DORA`, 'METRICS')
}

/**
 * Update operator status
 * @param isUp Whether the operator is up (true) or down (false)
 * @deprecated Use the uptime metric instead of binary up/down status
 */
export const updateOperatorStatus = (isUp: boolean) => {
  // this function now only records logs, no longer sets the binary status
  // the uptime metric will be updated automatically, no need to set manually
  debug(
    `Operator status tracking: ${isUp ? 'Running' : 'Shutting down'}`,
    'METRICS',
  )

  // if the service is about to shut down, record the final uptime
  if (!isUp) {
    const finalUptimeSeconds = (Date.now() - startTime) / 1000
    operatorUptime.set(finalUptimeSeconds)
    debug(
      `Final operator uptime: ${finalUptimeSeconds.toFixed(2)} seconds`,
      'METRICS',
    )
  }
}

/**
 * Start metrics HTTP server
 * @param port Port to listen on
 */
export const startMetricsServer = (port: number = 9090) => {
  const app = express()

  // Expose metrics endpoint
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', register.contentType)
      res.end(await register.metrics())
    } catch (err) {
      res.status(500).end(err instanceof Error ? err.message : String(err))
    }
  })

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK')
  })

  // Start the server
  app.listen(port, () => {
    info(`Metrics server started on port ${port}`, 'METRICS')
  })
}
