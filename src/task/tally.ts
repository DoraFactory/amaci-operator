import { groth16 } from 'snarkjs'
import { GasPrice, calculateFee } from '@cosmjs/stargate'

import { fetchAllVotesLogs, fetchRound } from '@/vota/indexer'
import { getContractSignerClient } from '@/lib/client/utils'

import { genMaciInputs } from '../operator/genInputs'
import { maciParamsFromCircuitPower, TaskAct } from '../types'
import { getChain } from '../chain'

const zkeyPath = './zkey/'

export const tally: TaskAct = async (_, { id }: { id: string }) => {
  const maciRound = await fetchRound(id)

  const now = Date.now()

  if (
    maciRound.period === 'Voting' &&
    now < Number(maciRound.votingEnd) / 1e6
  ) {
    return { error: { msg: 'error status: not end' } }
  }

  /**
   * 主要和 vota 交互的对象
   */
  const maciClient = await getContractSignerClient(id)

  /**
   * 先结束当前 round
   */
  if (maciRound.period === 'Voting') {
    const spGasPrice = GasPrice.fromString('100000000000peaka')
    const spGfee = calculateFee(100000000, spGasPrice)
    const startProcessRes = await maciClient.startProcessPeriod(spGfee)

    console.log('startProcessRes', startProcessRes.transactionHash)
  }

  const logs = await fetchAllVotesLogs(id)

  // const chain = getChain(maciRound.chainId)

  // const logs = await chain.fetchMaciLogs(
  //   maciRound.chainId,
  //   maciRound.contractAddr,
  // )

  const maxVoteOptions = await maciClient.maxVoteOptions()
  const res = genMaciInputs(
    {
      ...maciParamsFromCircuitPower(maciRound.circuitPower),
      coordPriKey: BigInt(process.env.COORDINATOR_PRI_KEY),
      maxVoteOptions: Number(maxVoteOptions),
    },
    {
      states: logs.signup.map((s) => ({
        idx: s.stateIdx,
        balance: BigInt(s.balance),
        pubkey: (s.pubKey.match(/\d+/g) || []).map((n: string) =>
          BigInt(n),
        ) as [bigint, bigint],
        c: [BigInt(s.d0), BigInt(s.d1), BigInt(s.d2), BigInt(s.d3)],
      })),
      messages: logs.msg.map((m) => ({
        idx: m.msgChainLength,
        msg: (m.message.match(/(?<=\()\d+(?=\))/g) || []).map((s) => BigInt(s)),
        pubkey: (m.encPubKey.match(/\d+/g) || []).map((n: string) =>
          BigInt(n),
        ) as [bigint, bigint],
      })),
      dmessages: [],
    },
    [],
    [],
  )

  // // await storage.saveAllInputs(id, res)

  const lastTallyInput = res.tallyInputs[res.tallyInputs.length - 1]
  // await storage.saveResult(
  //   id,
  //   res.result.map((i) => i.toString()),
  //   lastTallyInput.newResultsRootSalt.toString(),
  // )

  console.log('start to gen proof | msg')
  for (let i = 0; i < res.msgInputs.length; i++) {
    const input = res.msgInputs[i]

    const { proof } = await groth16.fullProve(
      input,
      zkeyPath + maciRound.circuitPower + '/msg.wasm',
      zkeyPath + maciRound.circuitPower + '/msg.zkey',
    )
    const commitment = input.newStateCommitment.toString()
    // await storage.saveProof(
    //   id,
    //   'msg',
    //   i,
    //   input.newStateCommitment.toString(),
    //   proof,
    // )
    console.log('gen proof | msg | ' + i)
  }

  console.log('start to gen proof | tally')
  for (let i = 0; i < res.tallyInputs.length; i++) {
    const input = res.tallyInputs[i]

    const { proof } = await groth16.fullProve(
      input,
      zkeyPath + maciRound.circuitPower + '/tally.wasm',
      zkeyPath + maciRound.circuitPower + '/tally.zkey',
    )
    const commitment = input.newTallyCommitment.toString()
    // await storage.saveProof(
    //   id,
    //   'tally',
    //   i,
    //   input.newTallyCommitment.toString(),
    //   proof,
    // )
    // console.log('gen proof | tally | ' + i)
  }

  // await storage.setMaciStatus(id, { hasProofs: true })

  return {}
}
