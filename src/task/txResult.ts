import { getChain } from '../chain'
import { ProofType, TaskAct } from '../types'

export const txResult: TaskAct = async (storage, { id }: { id: number }) => {
  const maciRound = await storage.fetchMacidata(id)
  if (
    maciRound.ifFinished ||
    maciRound.submitedProofsCount <
      maciRound.msgProofsCount + maciRound.tallyProofsCount
  ) {
    return { error: { msg: 'error status' } }
  }

  const chain = getChain(maciRound.chainId)

  const { result, salt } = await storage.fetchResult(id)

  const ok = await chain.stopTallyingPeriod(
    maciRound.chainId,
    maciRound.eoaPrivateKey,
    maciRound.contractAddr,
    result,
    salt,
  )
  if (!ok) {
    return { error: { msg: 'chain error', again: -1 } }
  }

  await storage.setMaciStatus(id, {
    ifFinished: true,
  })

  return {}
}
