import { getChain } from '../chain'
import { ProofType, TaskAct } from '../types'

export const txDeactivate: TaskAct = async (
  storage,
  { id }: { id: number },
) => {
  const maciRound = await storage.fetchMacidata(id)
  const chain = getChain(maciRound.chainId)

  if (
    maciRound.submitedDeactivateProofsCount >= maciRound.deactivateProofsCount
  ) {
    return { error: { msg: 'deactivate proof done' } }
  }

  const proofType: ProofType = 'deactivate'
  const idx = maciRound.submitedDeactivateProofsCount

  const { proof, commitment, size, root } = await storage.fetchProof(
    id,
    proofType,
    idx,
  )

  const txHash = await chain.proof(
    maciRound.chainId,
    maciRound.eoaPrivateKey,
    maciRound.contractAddr,
    proofType,
    commitment,
    proof,
    size,
    root,
  )
  if (!txHash) {
    return { error: { msg: 'chain error', again: -1 } }
  }

  await storage.updateTxHashOfProof(id, proofType, idx, txHash)

  const newsubmitedDeactivateProofsCount =
    maciRound.submitedDeactivateProofsCount + 1
  await storage.setMaciStatus(id, {
    submitedDeactivateProofsCount: newsubmitedDeactivateProofsCount,
  })

  if (newsubmitedDeactivateProofsCount >= maciRound.deactivateProofsCount) {
    return {}
  } else {
    return {
      newTasks: [
        {
          name: 'txDeactivate',
          params: { id },
        },
      ],
    }
  }
}
