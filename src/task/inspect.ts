import { fetchRounds } from '../vota/indexer'
import { Task, TaskAct } from '../types'
// import { Timer } from '../storage/timer'
import { genKeypair } from '../lib/keypair'
import { log } from '../log'


export const inspect: TaskAct = async () => {
  const now = Date.now()

  
  const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY))

  // 根据maci public key和code id来获取所有的rounds
  const rounds = await fetchRounds(coordinator.pubKey.map(String))
  console.log('===========')
  console.log(process.env.CODE_IDS)
  console.log(coordinator.pubKey.map(String))
  console.log(rounds)
  console.log('===========')
  const newTasks: Task[] = []

  let tasks = 0
  for (const maciRound of rounds) {

    // Tally
    if (
      ['Pending', 'Voting', 'Processing', 'Tallying'].includes(
        maciRound.period,
      ) &&
      now > Number(maciRound.votingEnd) / 1e6
    ) {
      tasks ++
      newTasks.push({ name: 'tally', params: { id: maciRound.id } })
    }
  }

  console.log(`[TASK inspect] find rounds count: ${tasks}/${rounds.length}`)
  log(`[TASK inspect] find rounds count: ${tasks}/${rounds.length}`)

  return { newTasks }
}
