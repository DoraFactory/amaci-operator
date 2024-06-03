import { getChain } from '../chain'
import { ProofType, TaskAct } from '../types'

export const txProof: TaskAct = async (storage, { id }: { id: number }) => {
  const maciRound = await storage.fetchMacidata(id)
  if (maciRound.hasProofs) {
    return { error: { msg: 'error status' } }
  }
  const chain = getChain(maciRound.chainId)

  if (
    maciRound.submitedProofsCount >=
    maciRound.msgProofsCount + maciRound.tallyProofsCount
  ) {
    return { error: { msg: 'proof done' } }
  }

  let proofType: ProofType = 'msg'
  let idx = maciRound.submitedProofsCount
  if (idx >= maciRound.msgProofsCount) {
    proofType = 'tally'
    idx = idx - maciRound.msgProofsCount
  }

  const { proof, commitment } = await storage.fetchProof(id, proofType, idx)

  const txHash = await chain.proof(
    maciRound.chainId,
    maciRound.eoaPrivateKey,
    maciRound.contractAddr,
    proofType,
    commitment,
    proof,
  )
  if (!txHash) {
    return { error: { msg: 'chain error', again: -1 } }
  }

  await storage.updateTxHashOfProof(id, proofType, idx, txHash)

  const newSubmitedProofsCount = maciRound.submitedProofsCount + 1
  await storage.setMaciStatus(id, {
    submitedProofsCount: newSubmitedProofsCount,
  })

  if (
    newSubmitedProofsCount >=
    maciRound.msgProofsCount + maciRound.tallyProofsCount
  ) {
    return {
      newTasks: [
        {
          name: 'txResult',
          params: { id },
        },
      ],
    }
  } else {
    return {
      newTasks: [
        {
          name: 'txProof',
          params: { id },
        },
      ],
    }
  }
}
