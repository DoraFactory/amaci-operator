import { fetchRounds } from '../vota/indexer'
import { Task, TaskAct } from '../types'
import { Timer } from '../storage/timer'
import { genKeypair } from '../lib/keypair'
import { log } from '../log'

const deactivateInterval = Number(process.env.DEACTIVATE_INTERVAL)

export const inspect: TaskAct = async () => {
  const now = Date.now()

  const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY))

  const rounds = await fetchRounds(coordinator.pubKey.map(String))
  console.log('===========')
  console.log(process.env.CODE_IDS)
  console.log(coordinator.pubKey.map(String))
  console.log(rounds)
  console.log('===========')
  const newTasks: Task[] = []

  let tasks = 0
  for (const maciRound of rounds) {
    // deactivate
    if (
      now > Number(maciRound.votingStart) / 1e6 &&
      // maciRound.period === 'Voting' &&
      Timer.get(maciRound.id) + deactivateInterval < now &&
      now < Number(maciRound.votingEnd) / 1e6
    ) {
      tasks++
      newTasks.push({ name: 'deactivate', params: { id: maciRound.id } })
    }

    // Tally
    if (
      ['Pending', 'Voting', 'Processing', 'Tallying'].includes(
        maciRound.period,
      ) &&
      now > Number(maciRound.votingEnd) / 1e6
    ) {
      tasks++
      newTasks.push({ name: 'tally', params: { id: maciRound.id } })
    }
  }

  console.log(`[TASK inspect] find rounds count: ${tasks}/${rounds.length}`)
  log(`[TASK inspect] find rounds count: ${tasks}/${rounds.length}`)

  return { newTasks }
}
