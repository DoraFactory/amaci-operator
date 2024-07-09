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
}

export const genMaciInputs = (
  {
    stateTreeDepth,
    intStateTreeDepth,
    voteOptionTreeDepth,
    batchSize,
    coordPriKey,
    maxVoteOptions,
  }: IGenMaciInputsParams,
  contractLogs: IContractLogs,
  // deactivates: bigint[][],
  deactivateSize: number,
) => {
  const maci = new MACI(
    stateTreeDepth,
    intStateTreeDepth,
    voteOptionTreeDepth,
    batchSize,
    coordPriKey,
    maxVoteOptions,
    contractLogs.states.length,
  )

  for (const state of contractLogs.states) {
    maci.initStateTree(state.idx, state.pubkey, state.balance, state.c)
  }

  for (const msg of contractLogs.messages) {
    maci.pushMessage(msg.msg, msg.pubkey)
  }

  for (const dmsg of contractLogs.dmessages) {
    maci.pushDeactivateMessage(dmsg.msg, dmsg.pubkey)
  }

  // maci.uploadDeactivateHistory(deactivates, contractLogs.states.length)

  let i = 0
  while (maci.processedDMsgCount < deactivateSize) {
    let size = maci.batchSize
    if (size + i > deactivateSize) {
      size = deactivateSize - i
    }
    i = i + size

    maci.processDeactivateMessage(
      size,
      contractLogs.dmessages[i - 1].numSignUps,
    )
  }

  maci.endVotePeriod()

  let nonce = 1n

  // PROCESSING
  const msgInputs: MsgInput[] = []
  while (maci.states === MACI_STATES.PROCESSING) {
    const input = maci.processMessage(
      genStaticRandomKey(coordPriKey, 20041n, nonce++),
    )

    msgInputs.push(input)
  }

  // TALLYING
  const tallyInputs: TallyInput[] = []
  while (maci.states === MACI_STATES.TALLYING) {
    const input = maci.processTally(
      genStaticRandomKey(coordPriKey, 20042n, nonce++),
    )

    tallyInputs.push(input)
  }

  // RESULT
  const result = maci.tallyResultsLeaves.slice(0, maxVoteOptions)

  return {
    msgInputs,
    tallyInputs,
    result,
  }
}
