import { groth16 } from 'snarkjs'

import { genDeacitveMaciInputs } from '../operator/genDeactivateInputs'
import { MaciParams, TaskAct } from '../types'
import { getChain } from '../chain'

const zkeyPath = './zkey/'

export const deactivate: TaskAct = async (storage, { id }: { id: string }) => {
  const maciRound = await storage.fetchMacidata(id)
  if (maciRound.isStopVoting) {
    return { error: { msg: 'error status' } }
  }

  if (
    maciRound.latestdeactivateAt + maciRound.deactivateInterval >
    Date.now()
  ) {
    return { error: { msg: 'too earlier' } }
  }

  const chain = getChain(maciRound.chainId)

  const logs = await chain.fetchMaciLogs(
    maciRound.chainId,
    maciRound.contractAddr,
  )

  const { allDeactivates, activeStates } = await storage.fetchDeactivateInfo(id)

  const res = genDeacitveMaciInputs(
    {
      ...MaciParams[maciRound.type],
      coordPriKey: BigInt(maciRound.coordinatorPrivateKey),
      maxVoteOptions: maciRound.maxVoteOptions,
    },
    logs,
    allDeactivates.map((a) => a.map((n) => BigInt(n))),
    activeStates.map((n) => BigInt(n)),
  )

  const newAllDeactivates = [
    ...allDeactivates,
    ...res.newDeactivates.map((a) => a.map((n) => n.toString())),
  ]

  await storage.setDeactivateInfo(
    id,
    newAllDeactivates,
    res.activeStates.map((n) => n.toString()),
  )

  const deactivatedCount = maciRound.deactivateProofsCount

  console.log('start to gen deactivate')
  for (let i = 0; i < res.dMsgInputs.length; i++) {
    const input = res.dMsgInputs[i]

    const { proof } = await groth16.fullProve(
      input,
      zkeyPath + maciRound.type + '/deactivate.wasm',
      zkeyPath + maciRound.type + '/deactivate.zkey',
    )
    await storage.saveProof(
      id,
      'deactivate',
      deactivatedCount + i,
      input.newDeactivateCommitment.toString(),
      proof,
      input.size,
      input.newDeactivateRoot.toString(),
    )
    console.log('gen deactivate | ' + (deactivatedCount + i))
  }

  await storage.setMaciStatus(id, {
    deactivateProofsCount: deactivatedCount + res.dMsgInputs.length,
    latestdeactivateAt: Date.now(),
  })

  return {}
}
