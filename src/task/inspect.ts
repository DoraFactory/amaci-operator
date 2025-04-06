import { fetchRounds } from '../vota/indexer'
import { Task, TaskAct } from '../types'
import { Timer } from '../storage/timer'
import { genKeypair } from '../lib/keypair'
import { 
  info, 
  debug,
  warn,
  error,
  startOperation, 
  endOperation,
} from '../logger'
import { recordTaskSuccess, updateActiveRounds, recordTaskStart, recordTaskEnd, updateRoundStatus, updateInspectedTasksCount } from '../metrics'

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL || 60000)

export const inspect: TaskAct = async () => {
  const startTime = Date.now()
  
  // Metrics: record the task start with a global id which is used for all tasks
  recordTaskStart('inspect', 'global');
  
  // log the start operation
  startOperation('inspect', 'INSPECT')
  info('Starting rounds inspection', 'INSPECT')

  try {
    const now = Date.now()
    const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY))

    const rounds = await fetchRounds(coordinator.pubKey.map(String))
    
    const stats = {
      totalRounds: rounds.length,
      needDeactivate: 0,
      needTally: 0,
      status: {
        pending: rounds.filter(r => r.period === 'Pending').length,
        voting: rounds.filter(r => r.period === 'Voting').length,
        processing: rounds.filter(r => r.period === 'Processing').length,
        tallying: rounds.filter(r => r.period === 'Tallying').length,
        // completed: rounds.filter(r => r.period === 'Completed').length
      }
    }

    // log the rounds data (detail, for debug)
    debug('Current coordinator and inspect code ids', 'INSPECT', {
      coordinatorPubKey: coordinator.pubKey.map(String).join(','),
      codeIds: process.env.CODE_IDS,
    })
    
    const newTasks: Task[] = []

    let tasks = 0
    for (const maciRound of rounds) {
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

    // 将 status 对象转换为更易读的格式
    const statusStr = Object.entries(stats.status)
      .map(([key, value]) => `${key}:${value}`)
      .join(', ');

    info(`Inspection found ${rounds.length} rounds with ${tasks} tasks`, 'INSPECT', {
      totalRounds: stats.totalRounds,
      needDeactivate: stats.needDeactivate,
      needTally: stats.needTally,
      status: statusStr,
      tasksGenerated: tasks
    })

    // 更新inspect找到的任务数量
    updateInspectedTasksCount({
      'deactivate': stats.needDeactivate,
      'tally': stats.needTally,
    });

    // Metrics: collect the active rounds
    const activeRounds = rounds.map(r => ({
      id: r.id,
      period: r.period
    }));

    // 确保这行代码被执行
    updateRoundStatus(stats.status);
    // Metrics: update the active rounds
    updateActiveRounds(activeRounds);
    // Metrics: record the task success
    recordTaskSuccess('inspect')
    // Metrics: record the task end
    recordTaskEnd('inspect', 'global');

    endOperation('inspect', true, 'INSPECT')
    return { newTasks }
  } catch (err: any) {
    const duration = Date.now() - startTime
    error(`Inspection failed after ${duration}ms: ${err.message || String(err)}`, 'INSPECT')
    endOperation('inspect', false, 'INSPECT')
    recordTaskEnd('inspect', 'global');
    throw err;
  }
}
