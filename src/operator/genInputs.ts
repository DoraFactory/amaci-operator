import { genStaticRandomKey } from '../lib/keypair'
import { MACI, MACI_STATES, MsgInput, TallyInput } from '../lib/Maci'
import { IContractLogs } from '../types'
import { info } from '../logger'
import type { MessageStoreReader } from '../storage/messageStore'

interface IGenMaciInputsParams {
  stateTreeDepth: number
  intStateTreeDepth: number
  voteOptionTreeDepth: number
  batchSize: number
  coordPriKey: bigint
  maxVoteOptions: number
  isQuadraticCost: boolean
  pollId?: number | bigint
}

const getBenchmarkHeartbeatMs = () => {
  const value = Number(process.env.INPUTGEN_BENCHMARK_HEARTBEAT_MS || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

const logBenchmarkHeartbeat = ({
  phase,
  produced,
  total,
  startedAt,
  force = false,
}: {
  phase: 'MSG' | 'TALLY'
  produced: number
  total?: number
  startedAt: number
  force?: boolean
}) => {
  const totalText = total === undefined ? '' : `/${total}`
  const prefix = force ? '[progress]' : '[heartbeat]'
  console.log(
    `${prefix} TS ${phase} inputgen produced ${produced}${totalText} inputs in ${Date.now() - startedAt}ms`,
  )
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
    pollId,
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
    pollId !== undefined ? BigInt(pollId) : undefined,
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
  let lastMsgHeartbeatAt = msgInputsStart
  const benchmarkHeartbeatMs = getBenchmarkHeartbeatMs()
  const expectedMsgInputs = Math.ceil(contractLogs.messages.length / batchSize)
  const msgInputs: MsgInput[] = []
  while (maci.states === MACI_STATES.PROCESSING) {
    const input = maci.processMessage(
      genStaticRandomKey(coordPriKey, 20041n, nonce++),
    )

    msgInputs.push(input)
    if (
      benchmarkHeartbeatMs > 0 &&
      Date.now() - lastMsgHeartbeatAt >= benchmarkHeartbeatMs
    ) {
      logBenchmarkHeartbeat({
        phase: 'MSG',
        produced: msgInputs.length,
        total: expectedMsgInputs,
        startedAt: msgInputsStart,
      })
      lastMsgHeartbeatAt = Date.now()
    }
  }
  const msgInputsMs = Date.now() - msgInputsStart
  if (benchmarkHeartbeatMs > 0) {
    logBenchmarkHeartbeat({
      phase: 'MSG',
      produced: msgInputs.length,
      total: expectedMsgInputs,
      startedAt: msgInputsStart,
      force: true,
    })
  }
  info(`GenInputs MSG produced ${msgInputs.length} inputs in ${msgInputsMs}ms`, 'TALLY-TASK')

  // TALLYING (generate tallyInputs)
  const tallyInputsStart = Date.now()
  let lastTallyHeartbeatAt = tallyInputsStart
  const tallyInputs: TallyInput[] = []
  while (maci.states === MACI_STATES.TALLYING) {
    const input = maci.processTally(
      genStaticRandomKey(coordPriKey, 20042n, nonce++),
    )

    tallyInputs.push(input)
    if (
      benchmarkHeartbeatMs > 0 &&
      Date.now() - lastTallyHeartbeatAt >= benchmarkHeartbeatMs
    ) {
      logBenchmarkHeartbeat({
        phase: 'TALLY',
        produced: tallyInputs.length,
        startedAt: tallyInputsStart,
      })
      lastTallyHeartbeatAt = Date.now()
    }
  }
  const tallyInputsMs = Date.now() - tallyInputsStart
  if (benchmarkHeartbeatMs > 0) {
    logBenchmarkHeartbeat({
      phase: 'TALLY',
      produced: tallyInputs.length,
      startedAt: tallyInputsStart,
      force: true,
    })
  }
  info(`GenInputs TALLY produced ${tallyInputs.length} inputs in ${tallyInputsMs}ms`, 'TALLY-TASK')

  // RESULT
  const result = maci.tallyResultsLeaves.slice(0, maxVoteOptions)

  return {
    msgInputs,
    tallyInputs,
    result,
  }
}

export const genMaciInputsFromStore = (
  {
    stateTreeDepth,
    intStateTreeDepth,
    voteOptionTreeDepth,
    batchSize,
    coordPriKey,
    maxVoteOptions,
    isQuadraticCost,
    pollId,
  }: IGenMaciInputsParams,
  contractLogs: Omit<IContractLogs, 'messages'>,
  messageStore: MessageStoreReader,
  messageCount: number,
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
    pollId !== undefined ? BigInt(pollId) : undefined,
  )

  maci.setMessageStore(messageStore, messageCount)

  for (const state of contractLogs.states) {
    maci.initStateTree(state.idx, state.pubkey, state.balance, state.c)
  }

  for (const dmsg of contractLogs.dmessages) {
    maci.pushDeactivateMessage(dmsg.msg, dmsg.pubkey)
  }

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

  const msgInputsStart = Date.now()
  let lastMsgHeartbeatAt = msgInputsStart
  const benchmarkHeartbeatMs = getBenchmarkHeartbeatMs()
  const expectedMsgInputs = Math.ceil(messageCount / batchSize)
  const msgInputs: MsgInput[] = []
  while (maci.states === MACI_STATES.PROCESSING) {
    const input = maci.processMessage(
      genStaticRandomKey(coordPriKey, 20041n, nonce++),
    )

    msgInputs.push(input)
    if (
      benchmarkHeartbeatMs > 0 &&
      Date.now() - lastMsgHeartbeatAt >= benchmarkHeartbeatMs
    ) {
      logBenchmarkHeartbeat({
        phase: 'MSG',
        produced: msgInputs.length,
        total: expectedMsgInputs,
        startedAt: msgInputsStart,
      })
      lastMsgHeartbeatAt = Date.now()
    }
  }
  const msgInputsMs = Date.now() - msgInputsStart
  if (benchmarkHeartbeatMs > 0) {
    logBenchmarkHeartbeat({
      phase: 'MSG',
      produced: msgInputs.length,
      total: expectedMsgInputs,
      startedAt: msgInputsStart,
      force: true,
    })
  }
  info(`GenInputs MSG produced ${msgInputs.length} inputs in ${msgInputsMs}ms`, 'TALLY-TASK')

  const tallyInputsStart = Date.now()
  let lastTallyHeartbeatAt = tallyInputsStart
  const tallyInputs: TallyInput[] = []
  while (maci.states === MACI_STATES.TALLYING) {
    const input = maci.processTally(
      genStaticRandomKey(coordPriKey, 20042n, nonce++),
    )

    tallyInputs.push(input)
    if (
      benchmarkHeartbeatMs > 0 &&
      Date.now() - lastTallyHeartbeatAt >= benchmarkHeartbeatMs
    ) {
      logBenchmarkHeartbeat({
        phase: 'TALLY',
        produced: tallyInputs.length,
        startedAt: tallyInputsStart,
      })
      lastTallyHeartbeatAt = Date.now()
    }
  }
  const tallyInputsMs = Date.now() - tallyInputsStart
  if (benchmarkHeartbeatMs > 0) {
    logBenchmarkHeartbeat({
      phase: 'TALLY',
      produced: tallyInputs.length,
      startedAt: tallyInputsStart,
      force: true,
    })
  }
  info(`GenInputs TALLY produced ${tallyInputs.length} inputs in ${tallyInputsMs}ms`, 'TALLY-TASK')

  const result = maci.tallyResultsLeaves.slice(0, maxVoteOptions)

  return {
    msgInputs,
    tallyInputs,
    result,
  }
}
