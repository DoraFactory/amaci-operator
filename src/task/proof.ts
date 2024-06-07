import { groth16 } from 'snarkjs'

import { genMaciInputs } from '../operator/genInputs'
import { MaciParams, TaskAct } from '../types'
import { getChain } from '../chain'

const zkeyPath = './zkey/'

export const proof: TaskAct = async (storage, { id }: { id: string }) => {
  const maciRound = await storage.fetchMacidata(id)
  if (!maciRound.isStopVoting || maciRound.hasProofs) {
    return { error: { msg: 'error status' } }
  }

  const chain = getChain(maciRound.chainId)

  const logs = await chain.fetchMaciLogs(
    maciRound.chainId,
    maciRound.contractAddr,
  )

  const res = genMaciInputs(
    {
      ...MaciParams[maciRound.type],
      coordPriKey: BigInt(maciRound.coordinatorPrivateKey),
      maxVoteOptions: maciRound.maxVoteOptions,
    },
    logs,
    [],
    [],
  )

  // await storage.saveAllInputs(id, res)

  const lastTallyInput = res.tallyInputs[res.tallyInputs.length - 1]
  await storage.saveResult(
    id,
    res.result.map((i) => i.toString()),
    lastTallyInput.newResultsRootSalt.toString(),
  )

  console.log('start to gen proof | msg')
  for (let i = 0; i < res.msgInputs.length; i++) {
    const input = res.msgInputs[i]

    const { proof } = await groth16.fullProve(
      input,
      zkeyPath + maciRound.type + '/msg.wasm',
      zkeyPath + maciRound.type + '/msg.zkey',
    )
    await storage.saveProof(
      id,
      'msg',
      i,
      input.newStateCommitment.toString(),
      proof,
    )
    console.log('gen proof | msg | ' + i)
  }

  console.log('start to gen proof | tally')
  for (let i = 0; i < res.tallyInputs.length; i++) {
    const input = res.tallyInputs[i]

    const { proof } = await groth16.fullProve(
      input,
      zkeyPath + maciRound.type + '/tally.wasm',
      zkeyPath + maciRound.type + '/tally.zkey',
    )
    await storage.saveProof(
      id,
      'tally',
      i,
      input.newTallyCommitment.toString(),
      proof,
    )
    console.log('gen proof | tally | ' + i)
  }

  await storage.setMaciStatus(id, { hasProofs: true })

  return {
    newTasks: [
      {
        name: 'txProof',
        params: { id },
      },
    ],
  }
}
