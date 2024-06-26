import { genRandomKey } from '../lib/keypair'
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

  // maci.initProcessedDeactivateLog(deactivates, activeStates)

  for (const state of contractLogs.states) {
    maci.initStateTree(state.idx, state.pubkey, state.balance, state.c)
  }

  for (const msg of contractLogs.messages) {
    maci.pushMessage(msg.msg, msg.pubkey)
  }

  for (const dmsg of contractLogs.dmessages) {
    maci.pushDeactivateMessage(dmsg.msg, dmsg.pubkey)
  }

  let i = 0
  while (maci.processedDMsgCount < contractLogs.dmessages.length) {
    let size = maci.batchSize
    if (size + i > contractLogs.dmessages.length) {
      size = contractLogs.dmessages.length - i
    }

    maci.processDeactivateMessage(
      size,
      contractLogs.dmessages[i - 1].numSignUps,
    )
    i = i + size
  }

  maci.endVotePeriod()

  // PROCESSING
  const msgInputs: MsgInput[] = []
  while (maci.states === MACI_STATES.PROCESSING) {
    const input = maci.processMessage(genRandomKey())

    msgInputs.push(input)
  }

  // TALLYING
  const tallyInputs: TallyInput[] = []
  while (maci.states === MACI_STATES.TALLYING) {
    const input = maci.processTally(genRandomKey())

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
