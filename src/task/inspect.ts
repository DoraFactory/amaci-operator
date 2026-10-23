import { fetchRounds } from '../vota/indexer'
import { Task, TaskAct } from '../types'
import { Timer } from '../storage/timer'
import {
  deriveCoordinatorPubKey,
  serializePubKey,
} from '../lib/keypair'
import { clearRoundStatus, loadRoundStatus } from '../storage/roundStatus'
import { getContractSignerClient, withRetry } from '../lib/client/utils'
import {
  info,
  debug,
  warn,
  error,
  startOperation,
  endOperation,
  setCurrentRound,
  clearContext,
} from '../logger'
import {
  recordTaskSuccess,
  recordTaskFailure,
  updateActiveRounds,
  recordTaskStart,
  recordTaskEnd,
  updateRoundStatus,
  updateInspectedTasksCount,
} from '../metrics'

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL || 60000)

export const inspect: TaskAct = async () => {
  const startTime = Date.now()

  // clear the current round id, so the inspect log will not be included in the round id named log
  setCurrentRound('')
  clearContext(['round'])

  // Metrics: record the task start with a global id which is used for all tasks
  recordTaskStart('inspect', 'global')

  // logger: start the inspection - 保存操作上下文
  const operationContext = startOperation('inspect', 'INSPECT')
  info('Starting rounds inspection', 'INSPECT')

  try {
    const now = Date.now()
    const coordinatorPriKeyEnv = process.env.COORDINATOR_PRI_KEY
    if (!coordinatorPriKeyEnv) {
      throw new Error('COORDINATOR_PRI_KEY is not set')
    }
    const coordinatorPubKey = deriveCoordinatorPubKey(
      BigInt(coordinatorPriKeyEnv),
    )
    const padded = serializePubKey(coordinatorPubKey)
    const rounds = await fetchRounds([padded.x, padded.y])
    const roundStatus = loadRoundStatus()
    debug(`Coordinator pubkey mode=padded (${padded.x}, ${padded.y})`, 'INSPECT')

    const stats = {
      totalRounds: rounds.length,
      needDeactivate: 0,
      needTally: 0,
      status: {
        pending: rounds.filter((r) => r.period === 'Pending').length,
        voting: rounds.filter((r) => r.period === 'Voting').length,
        processing: rounds.filter((r) => r.period === 'Processing').length,
        tallying: rounds.filter((r) => r.period === 'Tallying').length,
        // completed: rounds.filter(r => r.period === 'Completed').length
      },
    }

    const newTasks: Task[] = []

    let tasks = 0
    for (const maciRound of rounds) {
      const status = roundStatus[maciRound.id]
      if (status?.status === 'tally_completed') {
        if (maciRound.period === 'Ended') {
          debug(`Skipping completed round ${maciRound.id}`, 'INSPECT')
          continue
        }

        try {
          const maciClient = await getContractSignerClient(maciRound.id)
          const chainPeriod = await withRetry(() => maciClient.getPeriod(), {
            context: 'RPC-GET-PERIOD-INSPECT',
            maxRetries: 3,
          })

          if (chainPeriod.status === 'ended') {
            debug(
              `Skipping locally completed round ${maciRound.id} while indexer catches up (indexer=${maciRound.period}, chain=${chainPeriod.status})`,
              'INSPECT',
            )
            continue
          }

          warn(
            `Clearing stale completed marker for round ${maciRound.id} (indexer=${maciRound.period}, chain=${chainPeriod.status})`,
            'INSPECT',
          )
          clearRoundStatus(maciRound.id)
        } catch (err: any) {
          warn(
            `Keeping completed marker for round ${maciRound.id} because chain verification failed: ${err.message || String(err)}`,
            'INSPECT',
          )
          continue
        }
      }
      // deactivate task
      if (
        now > Number(maciRound.votingStart) / 1e6 &&
        // maciRound.period === 'Voting' &&
        Timer.get(maciRound.id) + deactivateInterval < now &&
        now < Number(maciRound.votingEnd) / 1e6
      ) {
        tasks++
        stats.needDeactivate++
        newTasks.push({ name: 'deactivate', params: { id: maciRound.id } })

        info(`Adding deactivate task for round ${maciRound.id}`, 'INSPECT', {
          round: maciRound.id,
          period: maciRound.period,
          circuitPower: maciRound.circuitPower,
        })
      }

      // Tally
      if (
        ['Pending', 'Voting', 'Processing', 'Tallying'].includes(
          maciRound.period,
        ) &&
        now > Number(maciRound.votingEnd) / 1e6
      ) {
        tasks += 2
        stats.needDeactivate++
        newTasks.push({ name: 'deactivate', params: { id: maciRound.id } })
        info(`Adding deactivate task for round ${maciRound.id}`, 'INSPECT', {
          round: maciRound.id,
          period: maciRound.period,
          circuitPower: maciRound.circuitPower,
        })
        stats.needTally++
        newTasks.push({ name: 'tally', params: { id: maciRound.id } })
        info(`Adding tally tasks for round ${maciRound.id}`, 'INSPECT', {
          round: maciRound.id,
          period: maciRound.period,
          circuitPower: maciRound.circuitPower,
        })
      }
    }

    // Metrics: convert the status object to a more readable format
    const statusStr = Object.entries(stats.status)
      .map(([key, value]) => `${key}:${value}`)
      .join(', ')

    info(
      `Inspection found ${rounds.length} rounds with ${tasks} tasks`,
      'INSPECT',
      {
        totalRounds: stats.totalRounds,
        needDeactivate: stats.needDeactivate,
        needTally: stats.needTally,
        status: statusStr,
        tasksGenerated: tasks,
      },
    )

    // Metrics: update the inspected tasks count
    updateInspectedTasksCount({
      deactivate: stats.needDeactivate,
      tally: stats.needTally,
    })

    // Metrics: collect the active rounds
    const activeRounds = rounds.map((r) => ({
      id: r.id,
      period: r.period,
      circuitPower: r.circuitPower,
    }))

    // Metrics: update the round status
    updateRoundStatus(stats.status)
    // Metrics: update the active rounds
    updateActiveRounds(activeRounds)
    // Metrics: record the inspection success
    recordTaskSuccess('inspect', 'global')
    // Metrics: record the inspection end
    recordTaskEnd('inspect', 'global')

    // 使用保存的操作上下文
    endOperation('inspect', true, operationContext)
    return { newTasks }
  } catch (err: any) {
    const duration = Date.now() - startTime
    error(
      `Inspection failed after ${duration}ms: ${err.message || String(err)}`,
      'INSPECT',
    )
    recordTaskFailure('inspect', 'global')
    // 使用保存的操作上下文
    endOperation('inspect', false, operationContext)
    recordTaskEnd('inspect', 'global')
    throw err
  }
}
