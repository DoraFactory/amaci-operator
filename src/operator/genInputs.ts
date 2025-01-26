import { genStaticRandomKey } from '../lib/keypair'
import { MACI, MACI_STATES, MsgInput, TallyInput } from '../lib/Maci'
import { IContractLogs } from '../types'

interface IGenMaciInputsParams {
  stateTreeDepth: number
  intStateTreeDepth: number
  voteOptionTreeDepth: number
  batchSize: number
  coordPriKey: bigint
  maxVoteOptions: number
  isQuadraticCost: boolean
}

export const genMaciInputs = (
  {
    stateTreeDepth,
    intStateTreeDepth,
    voteOptionTreeDepth,
    batchSize,
    coordPriKey,
    maxVoteOptions,
    isQuadraticCost,
  }: IGenMaciInputsParams,
  contractLogs: IContractLogs,
  // deactivates: bigint[][],
  // deactivateSize: number,
) => {
  const maci = new MACI(
    stateTreeDepth,
    intStateTreeDepth,
    voteOptionTreeDepth,
    batchSize,
    coordPriKey,
    maxVoteOptions,
    contractLogs.states.length,
    isQuadraticCost,
  )

  for (const state of contractLogs.states) {
    maci.initStateTree(state.idx, state.pubkey, state.balance, state.c)
  }

  for (const msg of contractLogs.messages) {
    maci.pushMessage(msg.msg, msg.pubkey)
  }

  maci.endVotePeriod()

  let nonce = 1n

  console.log("start processing")
  // PROCESSING
  const msgInputs: MsgInput[] = []
  while (maci.states === MACI_STATES.PROCESSING) {
    const input = maci.processMessage(
      genStaticRandomKey(coordPriKey, 20041n, nonce++),
    )

    msgInputs.push(input)
  }

  console.log('msgInputs length is ', msgInputs.length)
  console.log("end processing")

  // TALLYING

  console.log("start tallying")
  const tallyInputs: TallyInput[] = []
  while (maci.states === MACI_STATES.TALLYING) {
    const input = maci.processTally(
      genStaticRandomKey(coordPriKey, 20042n, nonce++),
    )

    tallyInputs.push(input)
  }

  console.log('tallyInputs', tallyInputs.length)
  console.log("end tallying")
  // RESULT
  const result = maci.tallyResultsLeaves.slice(0, maxVoteOptions)

  return {
    msgInputs,
    tallyInputs,
    result,
  }
}
