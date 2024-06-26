import { fetchRounds } from '../vota/indexer'
import { Task, TaskAct } from '../types'

export const inspect: TaskAct = async () => {
  const now = Date.now()

  const rounds = await fetchRounds(process.env.OPERATOR)

  const newTasks: Task[] = []

  for (const maciRound of rounds) {
    // deactivate
    if (
      maciRound.period === 'Voting'
      // TODO: time check
    ) {
      newTasks.push({ name: 'deactivate', params: { id: maciRound.id } })
    }

    // Tally
    if (
      ['Voting', 'Processing', 'Tallying'].includes(maciRound.period) &&
      now > Number(maciRound.votingEnd) / 1e6
    ) {
      newTasks.push({ name: 'tally', params: { id: maciRound.id } })
    }
  }

  console.log('[TASK inspect] find rounds count: ' + rounds.length)

  return { newTasks }
}
