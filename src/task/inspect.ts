import { Storage } from '../storage'
import { Task, TaskAct } from '../types'

export const inspect: TaskAct = async (storage) => {
  const now = Date.now()
  const maciRounds = await storage.fetchActiveMaciData()

  const newTasks: Task[] = []

  for (const maciRound of maciRounds) {
    // deactivate
    if (
      !maciRound.isStopVoting &&
      maciRound.latestdeactivateAt + maciRound.deactivateInterval < now
    ) {
      newTasks.push({ name: 'deactivate', params: { id: maciRound.id } })
    }

    // Ended - txStopVoting
    if (!maciRound.isStopVoting && maciRound.endAt < now) {
      newTasks.push({ name: 'txStopVoting', params: { id: maciRound.id } })
    }

    // Proof
    if (maciRound.isStopVoting && !maciRound.hasProofs) {
      newTasks.push({ name: 'proof', params: { id: maciRound.id } })
    }

    // txProof
    if (
      maciRound.hasProofs &&
      maciRound.submitedProofsCount <
        maciRound.msgProofsCount + maciRound.tallyProofsCount
    ) {
      const idx = maciRound.submitedProofsCount
      newTasks.push({ name: 'txProof', params: { id: maciRound.id } })
    }
  }

  console.log('[TASK inspect] find rounds count: ' + maciRounds.length)

  return { newTasks }
}
