import { getChain } from '../chain'
import { TaskAct } from '../types'

export const txStopVoting: TaskAct = async (
  storage,
  { id }: { id: number },
) => {
  const maciRound = await storage.fetchMacidata(id)
  if (maciRound.isStopVoting) {
    return { error: { msg: 'error status' } }
  }

  const chain = getChain(maciRound.chainId)

  const ok = await chain.stopVotingPeriod(
    maciRound.chainId,
    maciRound.eoaPrivateKey,
    maciRound.contractAddr,
    maciRound.maxVoteOptions,
  )
  if (!ok) {
    return { error: { msg: 'chain error', again: -1 } }
  }

  await storage.setMaciStatus(id, { isStopVoting: true })
  return {
    newTasks: [
      {
        name: 'proof',
        params: { id },
      },
    ],
  }
}
