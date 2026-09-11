import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { MACI } from '../lib/Maci'
import { genRoundKeypair } from '../lib/keypair'
import { info, warn } from '../logger'
import { IContractLogs } from '../types'
import { MessageStoreReader } from '../storage/messageStore'

const WORK_PATH = process.env.WORK_PATH || './work'
const SHADOW_ENABLED = Number(process.env.RUST_INPUTGEN_MSG_TALLY || 0) > 0
const SHADOW_STRICT = Number(process.env.RUST_INPUTGEN_SHADOW_STRICT || 0) > 0
const SHADOW_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.RUST_INPUTGEN_MSG_TALLY_TIMEOUT_MS || 20000),
)
const PROCESS_MAX_BUFFER_BYTES = 16 * 1024 * 1024

type MsgTallyParams = {
  id: string
  circuitPower: string
  circuitType: string | number
  params: {
    stateTreeDepth: number
    intStateTreeDepth: number
    voteOptionTreeDepth: number
    batchSize: number
  }
  coordPriKey: bigint
  maxVoteOptions: number
  pollId?: number | bigint
  contractLogs: Omit<IContractLogs, 'messages'> & {
    messages?: IContractLogs['messages']
  }
  messageStore?: MessageStoreReader
  messageCount?: number
  processedDMsgCount: number
}

type RustMsgTallyMeta = {
  msg_input_count: number
  tally_input_count: number
  result: string[]
  final_results_root_salt?: string
}

type MsgTallyShadowResult = {
  msgInputs: any[]
  tallyInputs: any[]
  result: string[]
  salt: string
}

type MsgTallyRustResult = MsgTallyShadowResult & {
  outDir: string
  durationMs: number
}

type MsgTallyShadowIssue = {
  kind: 'meta' | 'msg_batch' | 'tally_batch'
  field: string
  js?: unknown
  rust?: unknown
  batchIndex?: number
}

const atomicWrite = (file: string, data: string) => {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

const jsonReplacer = (_: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value

const writeJsonFile = (file: string, payload: unknown) => {
  atomicWrite(file, JSON.stringify(payload, jsonReplacer, 2))
}

const writeJsonlRecords = (file: string, records: Iterable<unknown>) => {
  const tmp = `${file}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    for (const record of records) {
      fs.writeSync(fd, `${JSON.stringify(record, jsonReplacer)}\n`)
    }
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

const quoteShellArg = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const getNormalizedMsgTallyDir = (id: string) =>
  path.join(WORK_PATH, 'data', id, 'normalized', 'msg-tally')

const getRustMsgTallyOutDir = (id: string) =>
  path.join(WORK_PATH, 'data', id, 'rust-inputgen', 'msg-tally')

const serializeDecodedCommand = (command: any | null) => {
  if (!command) return null
  return {
    state_idx: command.stateIdx.toString(),
    ...(command.pollId !== undefined
      ? { poll_id: command.pollId.toString() }
      : {}),
    msg_hash: command.msgHash.toString(),
    signature: {
      r8: [
        command.signature.R8[0].toString(),
        command.signature.R8[1].toString(),
      ],
      s: command.signature.S.toString(),
    },
  }
}

const serializeMessageCommand = (command: any | null) => {
  if (!command) return null
  return {
    nonce: command.nonce.toString(),
    state_idx: command.stateIdx.toString(),
    vo_idx: command.voIdx.toString(),
    new_votes: command.newVotes.toString(),
    new_pub_key: [
      command.newPubKey[0].toString(),
      command.newPubKey[1].toString(),
    ],
    ...(command.pollId !== undefined
      ? { poll_id: command.pollId.toString() }
      : {}),
    msg_hash: command.msgHash.toString(),
    signature: {
      r8: [
        command.signature.R8[0].toString(),
        command.signature.R8[1].toString(),
      ],
      s: command.signature.S.toString(),
    },
  }
}

const resolveRustInputgenBinary = () => {
  const envBinary = process.env.RUST_INPUTGEN_BIN?.trim()
  if (envBinary) return envBinary

  const candidates = [
    path.resolve(__dirname, '../../../target/debug/maci-inputgen'),
    path.resolve(process.cwd(), '../target/debug/maci-inputgen'),
    path.resolve(process.cwd(), 'target/debug/maci-inputgen'),
  ]

  return candidates.find((candidate) => fs.existsSync(candidate))
}

const runProcess = async ({
  command,
  args = [],
  shell = false,
  timeoutMs = SHADOW_TIMEOUT_MS,
}: {
  command: string
  args?: string[]
  shell?: boolean
  timeoutMs?: number
}) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(
        new Error(
          `Rust msg/tally inputgen timed out after ${timeoutMs}ms`,
        ),
      )
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > PROCESS_MAX_BUFFER_BYTES) {
        stdout = stdout.slice(-PROCESS_MAX_BUFFER_BYTES)
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > PROCESS_MAX_BUFFER_BYTES) {
        stderr = stderr.slice(-PROCESS_MAX_BUFFER_BYTES)
      }
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `Rust msg/tally inputgen command failed with code ${String(code)}: ${stderr || stdout}`.trim(),
        ),
      )
    })
  })
}

const runRustInputgen = async (roundDir: string, outDir: string) => {
  const shadowCommand = process.env.RUST_INPUTGEN_SHADOW_CMD?.trim()
  if (shadowCommand) {
    const fullCommand = `${shadowCommand} generate-msg-tally --round-dir ${quoteShellArg(roundDir)} --out-dir ${quoteShellArg(outDir)}`
    await runProcess({
      command: fullCommand,
      shell: true,
    })
    return
  }

  const binary = resolveRustInputgenBinary()
  if (!binary) {
    throw new Error(
      'Rust inputgen binary not found. Set RUST_INPUTGEN_BIN or RUST_INPUTGEN_SHADOW_CMD.',
    )
  }

  await runProcess({
    command: binary,
    args: ['generate-msg-tally', '--round-dir', roundDir, '--out-dir', outDir],
  })
}

const buildNormalizeDecoder = ({
  params,
  coordPriKey,
  maxVoteOptions,
  pollId,
  signupCount,
  isQuadraticCost,
}: {
  params: MsgTallyParams['params']
  coordPriKey: bigint
  maxVoteOptions: number
  pollId?: number | bigint
  signupCount: number
  isQuadraticCost: boolean
}) =>
  new MACI(
    params.stateTreeDepth,
    params.intStateTreeDepth,
    params.voteOptionTreeDepth,
    params.batchSize,
    coordPriKey,
    maxVoteOptions,
    signupCount,
    isQuadraticCost,
    pollId !== undefined ? BigInt(pollId) : undefined,
  )

function* serializeStates(states: IContractLogs['states']) {
  for (const state of states) {
    yield {
      idx: state.idx,
      balance: state.balance.toString(),
      pubkey: state.pubkey.map((value) => value.toString()),
      c: (state.c || [0n, 0n, 0n, 0n]).map((value) => value.toString()),
    }
  }
}

function* serializeMessagesFromArray(
  messages: IContractLogs['messages'],
  decoder: MACI,
) {
  for (const message of messages) {
    yield {
      idx: message.idx,
      msg: message.msg.map((value) => value.toString()),
      pubkey: message.pubkey.map((value) => value.toString()),
      decoded_command: serializeMessageCommand(
        decoder.msgToCmd(message.msg, message.pubkey),
      ),
    }
  }
}

function* serializeMessagesFromStore(
  messageStore: MessageStoreReader,
  messageCount: number,
  batchSize: number,
  decoder: MACI,
) {
  for (let batchStart = 0; batchStart < messageCount; batchStart += batchSize) {
    const batch = messageStore.getBatch(batchStart)
    if (batch.length === 0) {
      throw new Error(
        `Message store batch missing at start index ${batchStart}`,
      )
    }
    for (let offset = 0; offset < batch.length; offset++) {
      const message = batch[offset]
      yield {
        idx: batchStart + offset + 1,
        msg: message.ciphertext.map((value) => value.toString()),
        pubkey: message.encPubKey.map((value) => value.toString()),
        decoded_command: serializeMessageCommand(
          decoder.msgToCmd(message.ciphertext, message.encPubKey),
        ),
      }
    }
  }
}

function* serializeDeactivateMessages(
  dmessages: IContractLogs['dmessages'],
  decoder: MACI,
) {
  for (const message of dmessages) {
    yield {
      idx: message.idx,
      num_sign_ups: message.numSignUps,
      msg: message.msg.map((value) => value.toString()),
      pubkey: message.pubkey.map((value) => value.toString()),
      decoded_command: serializeDecodedCommand(
        decoder.msgToCmd(message.msg, message.pubkey),
      ),
    }
  }
}

const writeNormalizedMsgTallyInputs = ({
  id,
  circuitPower,
  circuitType,
  params,
  coordPriKey,
  maxVoteOptions,
  pollId,
  contractLogs,
  messageStore,
  messageCount,
  processedDMsgCount,
}: MsgTallyParams) => {
  const roundDir = getNormalizedMsgTallyDir(id)
  const outDir = getRustMsgTallyOutDir(id)
  fs.rmSync(roundDir, { recursive: true, force: true })
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(roundDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })

  const decoder = buildNormalizeDecoder({
    params,
    coordPriKey,
    maxVoteOptions,
    pollId,
    signupCount: contractLogs.states.length,
    isQuadraticCost: !!Number(circuitType),
  })
  const coordinator = genRoundKeypair(coordPriKey, pollId)

  const roundMeta = {
    circuit_power: circuitPower,
    circuit_type: Number(circuitType),
    ...(pollId !== undefined ? { poll_id: Number(pollId) } : {}),
    coord_pubkey: coordinator.pubKey.map((value) => value.toString()),
    coord_formatted_priv_key: coordinator.formatedPrivKey.toString(),
    key_generation_mode: 'padded',
    state_tree_depth: params.stateTreeDepth,
    int_state_tree_depth: params.intStateTreeDepth,
    vote_option_tree_depth: params.voteOptionTreeDepth,
    batch_size: params.batchSize,
    max_vote_options: maxVoteOptions,
    coord_priv_key: coordPriKey.toString(),
    processed_dmsg_count: processedDMsgCount,
    processed_msg_count: 0,
  }

  writeJsonFile(path.join(roundDir, 'round_meta.json'), roundMeta)
  writeJsonlRecords(
    path.join(roundDir, 'states.jsonl'),
    serializeStates(contractLogs.states),
  )
  if (messageStore) {
    const totalMessages = messageCount ?? 0
    writeJsonlRecords(
      path.join(roundDir, 'messages.jsonl'),
      serializeMessagesFromStore(
        messageStore,
        totalMessages,
        params.batchSize,
        decoder,
      ),
    )
  } else {
    writeJsonlRecords(
      path.join(roundDir, 'messages.jsonl'),
      serializeMessagesFromArray(contractLogs.messages || [], decoder),
    )
  }
  writeJsonlRecords(
    path.join(roundDir, 'dmessages.jsonl'),
    serializeDeactivateMessages(contractLogs.dmessages, decoder),
  )

  return { roundDir, outDir }
}

const loadIndexedJson = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))

const loadRustMsgTallyResult = async (params: MsgTallyParams) => {
  const { roundDir, outDir } = writeNormalizedMsgTallyInputs(params)
  const cliStartedAt = Date.now()
  await runRustInputgen(roundDir, outDir)
  const cliMs = Date.now() - cliStartedAt
  info(
    `Rust msg/tally inputgen CLI completed in ${cliMs}ms (roundDir=${roundDir}, outDir=${outDir})`,
    'TALLY-TASK',
  )

  const meta = JSON.parse(
    fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8'),
  ) as RustMsgTallyMeta
  const msgInputs = loadIndexedJson(path.join(outDir, 'msg_inputs'))
  const tallyInputs = loadIndexedJson(path.join(outDir, 'tally_inputs'))

  if (msgInputs.length !== meta.msg_input_count) {
    throw new Error(
      `Rust msg input count mismatch: meta=${meta.msg_input_count}, files=${msgInputs.length}`,
    )
  }
  if (tallyInputs.length !== meta.tally_input_count) {
    throw new Error(
      `Rust tally input count mismatch: meta=${meta.tally_input_count}, files=${tallyInputs.length}`,
    )
  }

  return {
    outDir,
    msgInputs,
    tallyInputs,
    result: meta.result,
    salt: meta.final_results_root_salt || '0',
  }
}

export const generateMsgTallyRustInputs = async (
  params: MsgTallyParams,
): Promise<MsgTallyRustResult> => {
  const startedAt = Date.now()
  const rustResult = await loadRustMsgTallyResult(params)
  const durationMs = Date.now() - startedAt
  info(
    `Rust msg/tally primary inputgen produced ${rustResult.msgInputs.length} MSG inputs and ${rustResult.tallyInputs.length} TALLY inputs in ${durationMs}ms`,
    'TALLY-TASK',
  )
  return {
    ...rustResult,
    durationMs,
  }
}

const canonicalize = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

const stableStringify = (value: unknown) => JSON.stringify(canonicalize(value))

const compareShadowOutputs = (
  jsResult: MsgTallyShadowResult,
  rustResult: MsgTallyShadowResult,
): MsgTallyShadowIssue[] => {
  const issues: MsgTallyShadowIssue[] = []

  const pushMetaIssue = (field: string, js: unknown, rust: unknown) => {
    if (stableStringify(js) === stableStringify(rust)) return
    issues.push({ kind: 'meta', field, js, rust })
  }

  const pushBatchIssue = (
    kind: 'msg_batch' | 'tally_batch',
    batchIndex: number,
    js: unknown,
    rust: unknown,
  ) => {
    if (stableStringify(js) === stableStringify(rust)) return
    issues.push({
      kind,
      field: 'input',
      batchIndex,
      js,
      rust,
    })
  }

  pushMetaIssue('msg_input_count', jsResult.msgInputs.length, rustResult.msgInputs.length)
  pushMetaIssue(
    'tally_input_count',
    jsResult.tallyInputs.length,
    rustResult.tallyInputs.length,
  )
  pushMetaIssue('result', jsResult.result, rustResult.result)
  pushMetaIssue('salt', jsResult.salt, rustResult.salt)

  const msgCount = Math.min(jsResult.msgInputs.length, rustResult.msgInputs.length)
  for (let i = 0; i < msgCount; i++) {
    pushBatchIssue('msg_batch', i, jsResult.msgInputs[i], rustResult.msgInputs[i])
  }

  const tallyCount = Math.min(
    jsResult.tallyInputs.length,
    rustResult.tallyInputs.length,
  )
  for (let i = 0; i < tallyCount; i++) {
    pushBatchIssue(
      'tally_batch',
      i,
      jsResult.tallyInputs[i],
      rustResult.tallyInputs[i],
    )
  }

  return issues
}

const persistShadowDiff = (
  outDir: string,
  jsResult: MsgTallyShadowResult,
  rustResult: MsgTallyShadowResult,
  issues: MsgTallyShadowIssue[],
) => {
  writeJsonFile(path.join(outDir, 'diff.json'), {
    match: issues.length === 0,
    issueCount: issues.length,
    issues,
    js: jsResult,
    rust: rustResult,
  })
}

export const runMsgTallyRustShadow = async (
  params: MsgTallyParams & { jsResult: MsgTallyShadowResult },
) => {
  if (!SHADOW_ENABLED) return

  const startedAt = Date.now()
  const { jsResult, ...shadowParams } = params
  try {
    const rustResult = await loadRustMsgTallyResult(shadowParams)
    const issues = compareShadowOutputs(jsResult, rustResult)
    persistShadowDiff(rustResult.outDir, jsResult, rustResult, issues)

    const ms = Date.now() - startedAt
    if (issues.length === 0) {
      info(
        `Rust msg/tally shadow matched JS output in ${ms}ms`,
        'TALLY-TASK',
      )
      return
    }

    const summary = issues
      .slice(0, 6)
      .map((issue) =>
        issue.kind === 'meta'
          ? `${issue.field}: js=${stableStringify(issue.js)} rust=${stableStringify(issue.rust)}`
          : `${issue.kind}[${issue.batchIndex}] mismatch`,
      )
      .join('; ')
    const message = `Rust msg/tally shadow mismatch (${issues.length} issues): ${summary}`
    if (SHADOW_STRICT) {
      throw new Error(message)
    }
    warn(message, 'TALLY-TASK')
  } catch (error: any) {
    const outDir = getRustMsgTallyOutDir(params.id)
    fs.mkdirSync(outDir, { recursive: true })
    writeJsonFile(path.join(outDir, 'shadow-error.json'), {
      message: error?.message || String(error),
    })
    if (SHADOW_STRICT) {
      throw error
    }
    warn(
      `Rust msg/tally shadow failed: ${error?.message || String(error)}`,
      'TALLY-TASK',
    )
  }
}
