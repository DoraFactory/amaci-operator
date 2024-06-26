import { fetchRounds } from '../vota/indexer'
import { Task, TaskAct } from '../types'
import { Timer } from '../storage/timer'

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL)

export const inspect: TaskAct = async () => {
  const now = Date.now()

  const rounds = await fetchRounds(process.env.OPERATOR)

  const newTasks: Task[] = []

  let tasks = 0
  for (const maciRound of rounds) {
    // deactivate
    if (
      maciRound.period === 'Voting' &&
      Timer.get(maciRound.id) + deactivateInterval < now
    ) {
      tasks++
      newTasks.push({ name: 'deactivate', params: { id: maciRound.id } })
    }

    // Tally
    if (
      ['Voting', 'Processing', 'Tallying'].includes(maciRound.period) &&
      now > Number(maciRound.votingEnd) / 1e6
    ) {
      tasks++
      newTasks.push({ name: 'tally', params: { id: maciRound.id } })
    }
  }

  console.log(`[TASK inspect] find rounds count: ${tasks}/${rounds.length}`)

  return { newTasks }
}
