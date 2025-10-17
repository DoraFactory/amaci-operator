import { genStaticRandomKey } from '../lib/keypair'
import { MACI, MACI_STATES, MsgInput, TallyInput } from '../lib/Maci'
import { IContractLogs } from '../types'
import { info } from '../logger'

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
    isQuadraticCost,
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

  // PROCESSING (generate msgInputs)
  const msgInputsStart = Date.now()
  const msgInputs: MsgInput[] = []
  while (maci.states === MACI_STATES.PROCESSING) {
    const input = maci.processMessage(
      genStaticRandomKey(coordPriKey, 20041n, nonce++),
    )

    msgInputs.push(input)
  }
  const msgInputsMs = Date.now() - msgInputsStart
  info(`GenInputs MSG produced ${msgInputs.length} inputs in ${msgInputsMs}ms`, 'TALLY-TASK')

  // TALLYING (generate tallyInputs)
  const tallyInputsStart = Date.now()
  const tallyInputs: TallyInput[] = []
  while (maci.states === MACI_STATES.TALLYING) {
    const input = maci.processTally(
      genStaticRandomKey(coordPriKey, 20042n, nonce++),
    )

    tallyInputs.push(input)
  }
  const tallyInputsMs = Date.now() - tallyInputsStart
  info(`GenInputs TALLY produced ${tallyInputs.length} inputs in ${tallyInputsMs}ms`, 'TALLY-TASK')

  // RESULT
  const result = maci.tallyResultsLeaves.slice(0, maxVoteOptions)

  return {
    msgInputs,
    tallyInputs,
    result,
  }
}
