import fs from 'fs'
import path from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { MACI } from '../lib/Maci'
import { genRoundKeypair } from '../lib/keypair'
import { info, warn } from '../logger'
import { IContractLogs } from '../types'

const execFileAsync = promisify(execFile)

const WORK_PATH = process.env.WORK_PATH || './work'
const SHADOW_ENABLED = Number(process.env.RUST_INPUTGEN_SHADOW || 0) > 0
const SHADOW_STRICT = Number(process.env.RUST_INPUTGEN_SHADOW_STRICT || 0) > 0

type DeactivatePlanSummary = {
  batch_index: number
  start_idx: number
  end_idx_exclusive: number
  size: number
  status?: string
  current_deactivate_commitment?: string
  new_deactivate_root?: string
  new_deactivate_commitment?: string
}

type DeactivateMetaSummary = {
  fully_processed: boolean
  deactivate_input_count: number
  new_deactivates_count: number
  final_deactivate_root?: string
  final_deactivate_commitment?: string
}

type ShadowIssue = {
  kind: 'meta' | 'batch'
  field: string
  rust?: string | number | boolean | null
  js?: string | number | boolean | null
  batchIndex?: number
}

type DeactivateJsPlan = {
  batch_index: number
  start_idx: number
  end_idx_exclusive: number
  size: number
  current_deactivate_commitment: string
  new_deactivate_root: string
  new_deactivate_commitment: string
}

type DeactivateShadowResult = {
  dMsgInputs: { input: any; size: string }[]
  newDeactivates: bigint[][]
}

type DeactivateShadowParams = {
  id: string
  circuitPower: string
  params: {
    stateTreeDepth: number
    intStateTreeDepth: number
    voteOptionTreeDepth: number
    batchSize: number
  }
  coordPriKey: bigint
  maxVoteOptions: number
  pollId?: number | bigint
  contractLogs: IContractLogs
  processedDMsgCount: number
  jsResult: DeactivateShadowResult
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

const writeJsonlFile = (file: string, payload: unknown[]) => {
  const lines = payload
    .map((item) => JSON.stringify(item, jsonReplacer))
    .join('\n')
  atomicWrite(file, lines.length > 0 ? `${lines}\n` : '')
}

const quoteShellArg = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const getNormalizedDeactivateDir = (id: string) =>
  path.join(WORK_PATH, 'data', id, 'normalized', 'deactivate')

const getRustDeactivateOutDir = (id: string) =>
  path.join(WORK_PATH, 'data', id, 'rust-inputgen', 'deactivate')

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

const runShellCommand = async (command: string) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `Rust inputgen shadow command failed with code ${String(code)}: ${stderr || stdout}`.trim(),
        ),
      )
    })
  })
}

const runRustInputgen = async (roundDir: string, outDir: string) => {
  const shadowCommand = process.env.RUST_INPUTGEN_SHADOW_CMD?.trim()
  if (shadowCommand) {
    const fullCommand = `${shadowCommand} generate-deactivate --round-dir ${quoteShellArg(roundDir)} --out-dir ${quoteShellArg(outDir)}`
    await runShellCommand(fullCommand)
    return
  }

  const binary = resolveRustInputgenBinary()
  if (!binary) {
    throw new Error(
      'Rust inputgen binary not found. Set RUST_INPUTGEN_BIN or RUST_INPUTGEN_SHADOW_CMD.',
    )
  }

  await execFileAsync(binary, [
    'generate-deactivate',
    '--round-dir',
    roundDir,
    '--out-dir',
    outDir,
  ])
}

const buildJsPlans = (
  processedDMsgCount: number,
  jsResult: DeactivateShadowResult,
): DeactivateJsPlan[] => {
  let start = processedDMsgCount
  return jsResult.dMsgInputs.map(({ input, size }, batchIndex) => {
    const numericSize = Number(size)
    const plan = {
      batch_index: batchIndex,
      start_idx: start,
      end_idx_exclusive: start + numericSize,
      size: numericSize,
      current_deactivate_commitment:
        input.currentDeactivateCommitment.toString(),
      new_deactivate_root: input.newDeactivateRoot.toString(),
      new_deactivate_commitment: input.newDeactivateCommitment.toString(),
    }
    start += numericSize
    return plan
  })
}

const loadRustPlans = (outDir: string): DeactivatePlanSummary[] => {
  const inputsDir = path.join(outDir, 'deactivate_inputs')
  if (!fs.existsSync(inputsDir)) return []

  return fs
    .readdirSync(inputsDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map(
      (file) =>
        JSON.parse(
          fs.readFileSync(path.join(inputsDir, file), 'utf8'),
        ) as DeactivatePlanSummary,
    )
}

const compareShadowOutputs = (
  processedDMsgCount: number,
  jsResult: DeactivateShadowResult,
  rustMeta: DeactivateMetaSummary,
  rustPlans: DeactivatePlanSummary[],
): ShadowIssue[] => {
  const issues: ShadowIssue[] = []
  const jsPlans = buildJsPlans(processedDMsgCount, jsResult)

  const pushMetaIssue = (
    field: string,
    js: string | number | boolean | null,
    rust: string | number | boolean | null,
  ) => {
    if (js === rust) return
    issues.push({ kind: 'meta', field, js, rust })
  }

  const pushBatchIssue = (
    batchIndex: number,
    field: string,
    js: string | number | boolean | null,
    rust: string | number | boolean | null,
  ) => {
    if (js === rust) return
    issues.push({ kind: 'batch', batchIndex, field, js, rust })
  }

  pushMetaIssue('fully_processed', true, rustMeta.fully_processed)
  pushMetaIssue(
    'deactivate_input_count',
    jsPlans.length,
    rustMeta.deactivate_input_count,
  )
  pushMetaIssue(
    'new_deactivates_count',
    jsResult.newDeactivates.length,
    rustMeta.new_deactivates_count,
  )

  const finalJsPlan = jsPlans[jsPlans.length - 1]
  pushMetaIssue(
    'final_deactivate_root',
    finalJsPlan ? finalJsPlan.new_deactivate_root : null,
    rustMeta.final_deactivate_root ?? null,
  )
  pushMetaIssue(
    'final_deactivate_commitment',
    finalJsPlan ? finalJsPlan.new_deactivate_commitment : null,
    rustMeta.final_deactivate_commitment ?? null,
  )

  if (jsPlans.length !== rustPlans.length) {
    return issues
  }

  for (let i = 0; i < jsPlans.length; i++) {
    const jsPlan = jsPlans[i]
    const rustPlan = rustPlans[i]
    pushBatchIssue(i, 'batch_index', jsPlan.batch_index, rustPlan.batch_index)
    pushBatchIssue(i, 'start_idx', jsPlan.start_idx, rustPlan.start_idx)
    pushBatchIssue(
      i,
      'end_idx_exclusive',
      jsPlan.end_idx_exclusive,
      rustPlan.end_idx_exclusive,
    )
    pushBatchIssue(i, 'size', jsPlan.size, rustPlan.size)
    pushBatchIssue(i, 'status', 'processed', rustPlan.status ?? null)
    pushBatchIssue(
      i,
      'current_deactivate_commitment',
      jsPlan.current_deactivate_commitment,
      rustPlan.current_deactivate_commitment ?? null,
    )
    pushBatchIssue(
      i,
      'new_deactivate_root',
      jsPlan.new_deactivate_root,
      rustPlan.new_deactivate_root ?? null,
    )
    pushBatchIssue(
      i,
      'new_deactivate_commitment',
      jsPlan.new_deactivate_commitment,
      rustPlan.new_deactivate_commitment ?? null,
    )
  }

  return issues
}

const buildNormalizeDecoder = ({
  params,
  coordPriKey,
  maxVoteOptions,
  pollId,
  contractLogs,
}: Pick<
  DeactivateShadowParams,
  | 'params'
  | 'coordPriKey'
  | 'maxVoteOptions'
  | 'pollId'
  | 'contractLogs'
>) =>
  new MACI(
    params.stateTreeDepth,
    params.intStateTreeDepth,
    params.voteOptionTreeDepth,
    params.batchSize,
    coordPriKey,
    maxVoteOptions,
    contractLogs.states.length,
    false,
    pollId !== undefined ? BigInt(pollId) : undefined,
  )

const writeNormalizedDeactivateInputs = ({
  id,
  circuitPower,
  params,
  coordPriKey,
  maxVoteOptions,
  pollId,
  contractLogs,
  processedDMsgCount,
}: Omit<DeactivateShadowParams, 'jsResult'>) => {
  const roundDir = getNormalizedDeactivateDir(id)
  const outDir = getRustDeactivateOutDir(id)
  fs.rmSync(roundDir, { recursive: true, force: true })
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(roundDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })

  const decoder = buildNormalizeDecoder({
    params,
    coordPriKey,
    maxVoteOptions,
    pollId,
    contractLogs,
  })
  const coordinator = genRoundKeypair(coordPriKey, pollId)

  const roundMeta = {
    circuit_power: circuitPower,
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
  }

  writeJsonFile(path.join(roundDir, 'round_meta.json'), roundMeta)
  writeJsonlFile(
    path.join(roundDir, 'states.jsonl'),
    contractLogs.states.map((state) => ({
      idx: state.idx,
      balance: state.balance.toString(),
      pubkey: state.pubkey.map((value) => value.toString()),
      c: (state.c || [0n, 0n, 0n, 0n]).map((value) => value.toString()),
    })),
  )
  writeJsonlFile(
    path.join(roundDir, 'dmessages.jsonl'),
    contractLogs.dmessages.map((message) => ({
      idx: message.idx,
      num_sign_ups: message.numSignUps,
      msg: message.msg.map((value) => value.toString()),
      pubkey: message.pubkey.map((value) => value.toString()),
      decoded_command: serializeDecodedCommand(
        decoder.msgToCmd(message.msg, message.pubkey),
      ),
    })),
  )

  return { roundDir, outDir }
}

const persistShadowDiff = (
  outDir: string,
  jsPlans: DeactivateJsPlan[],
  rustMeta: DeactivateMetaSummary,
  rustPlans: DeactivatePlanSummary[],
  issues: ShadowIssue[],
) => {
  writeJsonFile(path.join(outDir, 'diff.json'), {
    match: issues.length === 0,
    issueCount: issues.length,
    issues,
    jsPlans,
    rustMeta,
    rustPlans,
  })
}

export const runDeactivateRustShadow = async (
  params: DeactivateShadowParams,
) => {
  if (!SHADOW_ENABLED) return

  const { id, jsResult, processedDMsgCount } = params
  const { roundDir, outDir } = writeNormalizedDeactivateInputs(params)

  try {
    const startedAt = Date.now()
    await runRustInputgen(roundDir, outDir)
    const rustMeta = JSON.parse(
      fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8'),
    ) as DeactivateMetaSummary
    const rustPlans = loadRustPlans(outDir)
    const jsPlans = buildJsPlans(processedDMsgCount, jsResult)
    const issues = compareShadowOutputs(
      processedDMsgCount,
      jsResult,
      rustMeta,
      rustPlans,
    )
    persistShadowDiff(outDir, jsPlans, rustMeta, rustPlans, issues)

    const ms = Date.now() - startedAt
    if (issues.length === 0) {
      info(
        `Rust deactivate shadow matched JS output in ${ms}ms`,
        'DEACTIVATE-TASK',
      )
      return
    }

    const summary = issues
      .slice(0, 6)
      .map((issue) =>
        issue.kind === 'batch'
          ? `batch[${issue.batchIndex}] ${issue.field}: js=${String(issue.js)} rust=${String(issue.rust)}`
          : `${issue.field}: js=${String(issue.js)} rust=${String(issue.rust)}`,
      )
      .join('; ')
    const message = `Rust deactivate shadow mismatch (${issues.length} issues): ${summary}`
    if (SHADOW_STRICT) {
      throw new Error(message)
    }
    warn(message, 'DEACTIVATE-TASK')
  } catch (error: any) {
    writeJsonFile(path.join(outDir, 'shadow-error.json'), {
      message: error?.message || String(error),
    })
    if (SHADOW_STRICT) {
      throw error
    }
    warn(
      `Rust deactivate shadow failed: ${error?.message || String(error)}`,
      'DEACTIVATE-TASK',
    )
  }
}
