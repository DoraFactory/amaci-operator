import { DMsgInput, MACI } from '../lib/Maci'
import { IContractLogs } from '../types'

interface IGenMaciInputsParams {
  stateTreeDepth: number
  intStateTreeDepth: number
  voteOptionTreeDepth: number
  batchSize: number
  coordPriKey: bigint
  maxVoteOptions: number
}

export const genDeacitveMaciInputs = (
  {
    stateTreeDepth,
    intStateTreeDepth,
    voteOptionTreeDepth,
    batchSize,
    coordPriKey,
    maxVoteOptions,
  }: IGenMaciInputsParams,
  contractLogs: IContractLogs,
  deactivates: bigint[][],
  activeStates: bigint[],
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

  maci.initProcessedDeactivateLog(deactivates, activeStates)

  for (const state of contractLogs.states) {
    maci.initStateTree(state.idx, state.pubkey, state.balance, state.c)
  }

  for (const msg of contractLogs.dmessages) {
    maci.pushDeactivateMessage(msg.msg, msg.pubkey)
  }

  maci.initProcessedDeactivateLog(deactivates, activeStates)

  const newDeactivates: bigint[][] = []
  // PROCESSING
  let i = maci.processedDMsgCount
  const dMsgInputs: (DMsgInput & { size: number })[] = []
  while (maci.processedDMsgCount < contractLogs.dmessages.length) {
    let size = maci.batchSize
    if (size + i > contractLogs.dmessages.length) {
      size = contractLogs.dmessages.length - i
    }
    i = i + size

    const { input, newDeactivate } = maci.processDeactivateMessage(
      size,
      contractLogs.dmessages[i - 1].numSignUps,
    )

    newDeactivates.push(...newDeactivate)
    dMsgInputs.push({ ...input, size })
  }

  return {
    dMsgInputs,
    newDeactivates,
    activeStates: maci.activeStateTreeLeaves,
  }
}
