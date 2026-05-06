import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { IContractLogs } from '../src/types'

process.env.AMACI_CLI = process.env.AMACI_CLI || '1'

const DEFAULT_ROUND_ID =
  'dora1tslhdxuu8cmnl0zqz6v259x23ntxyjprrwlfq4g5czuytcf46y5srkvgm6'
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, 'test-data', 'data')
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const PROCESS_MAX_BUFFER_BYTES = 16 * 1024 * 1024

type RoundMeta = {
  circuit_power?: string
  circuit_type?: number
  poll_id?: number
  state_tree_depth?: number
  int_state_tree_depth?: number
  vote_option_tree_depth?: number
  batch_size?: number
  max_vote_options?: number
  coord_priv_key?: string
  processed_dmsg_count?: number
  processed_msg_count?: number
}

type NormalizedRound = {
  roundDir: string
  roundMeta: RoundMeta
  contractLogs: IContractLogs
}

type RustResult = {
  msgInputs: unknown[]
  tallyInputs: unknown[]
  result: string[]
  salt: string
}

type JsResult = {
  msgInputs: unknown[]
  tallyInputs: unknown[]
  result: unknown[]
  salt: string
}

type BenchmarkRun = {
  iteration: number
  normalizedReadMs: number
  tsGenerateMs: number
  rustCliMs: number
  rustLoadMs: number
  rustTotalMs: number
  compareMs: number
  msgInputs: number
  tallyInputs: number
  matched: boolean
  firstMismatch?: string
}

type CliOptions = {
  roundId: string
  roundDir?: string
  dataDir: string
  outDir: string
  rustBin: string
  timeoutMs: number
  iterations: number
  heartbeatMs: number
  skipCompare: boolean
  json: boolean
}

const now = () => Date.now()
const ms = (startedAt: number) => Date.now() - startedAt
const pad = (value: string | number, width: number) =>
  String(value).padEnd(width, ' ')
const round2 = (value: number) => Math.round(value * 100) / 100
const parseBigIntArray = (values: unknown[]): bigint[] =>
  values.map((value) => BigInt(String(value)))

const printUsage = () => {
  console.log(`Usage:
  npm run benchmark:inputgen -- [roundId] [options]

Options:
  --round-id <id>       Round id under test-data/data. Defaults to the large local round.
  --round-dir <path>    Explicit normalized/msg-tally directory.
  --data-dir <path>     Data root containing round folders. Default: ${DEFAULT_DATA_DIR}
  --out-dir <path>      Benchmark output root. Default: benchmark/inputgen/<round>-<timestamp>
  --rust-bin <path>     maci-inputgen binary. Default: ../target/debug/maci-inputgen
  --timeout-ms <ms>     Rust CLI timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --iterations <n>      Repeat full TS/Rust run. Default: 1
  --heartbeat-ms <ms>   Print progress while a stage is running. Default: 30000
  --skip-compare        Only measure times; do not compare outputs.
  --json                Print final report as JSON only.
  --help                Show this help.
`)
}

const parseArgs = (argv: string[]): CliOptions => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const options: CliOptions = {
    roundId: DEFAULT_ROUND_ID,
    dataDir: DEFAULT_DATA_DIR,
    outDir: '',
    rustBin:
      process.env.RUST_INPUTGEN_BIN ||
      path.resolve(PROJECT_ROOT, '..', 'target', 'debug', 'maci-inputgen'),
    timeoutMs: Number(process.env.RUST_INPUTGEN_MSG_TALLY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    iterations: 1,
    heartbeatMs: Number(process.env.INPUTGEN_BENCHMARK_HEARTBEAT_MS || 30000),
    skipCompare: false,
    json: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (!value) throw new Error(`Missing value for ${arg}`)
      return value
    }

    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--round-id') {
      options.roundId = next()
      continue
    }
    if (arg === '--round-dir') {
      options.roundDir = path.resolve(next())
      continue
    }
    if (arg === '--data-dir') {
      options.dataDir = path.resolve(next())
      continue
    }
    if (arg === '--out-dir') {
      options.outDir = path.resolve(next())
      continue
    }
    if (arg === '--rust-bin') {
      options.rustBin = path.resolve(next())
      continue
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(next())
      continue
    }
    if (arg === '--iterations') {
      options.iterations = Number(next())
      continue
    }
    if (arg === '--heartbeat-ms') {
      options.heartbeatMs = Number(next())
      continue
    }
    if (arg === '--skip-compare') {
      options.skipCompare = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }

    options.roundId = arg
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) {
    throw new Error('--timeout-ms must be at least 1000')
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error('--iterations must be a positive integer')
  }
  if (!Number.isFinite(options.heartbeatMs) || options.heartbeatMs < 0) {
    throw new Error('--heartbeat-ms must be >= 0')
  }

  if (!options.outDir) {
    options.outDir = path.join(
      PROJECT_ROOT,
      'benchmark',
      'inputgen',
      `${options.roundId}-${timestamp}`,
    )
  }

  return options
}

const createHeartbeat = ({
  label,
  intervalMs,
  enabled,
}: {
  label: string
  intervalMs: number
  enabled: boolean
}) => {
  if (!enabled || intervalMs <= 0) {
    return () => {}
  }

  const startedAt = now()
  const timer = setInterval(() => {
    console.log(`[heartbeat] ${label} running for ${ms(startedAt)}ms`)
  }, intervalMs)

  return () => {
    clearInterval(timer)
  }
}

const withHeartbeat = async <T>(
  label: string,
  intervalMs: number,
  enabled: boolean,
  fn: () => Promise<T> | T,
): Promise<T> => {
  const stop = createHeartbeat({ label, intervalMs, enabled })
  try {
    return await fn()
  } finally {
    stop()
  }
}

const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as T

const readJsonl = <T>(file: string): T[] => {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

const loadNormalizedRound = (roundDir: string): NormalizedRound => {
  const roundMeta = readJson<RoundMeta>(path.join(roundDir, 'round_meta.json'))
  const states = readJsonl<any>(path.join(roundDir, 'states.jsonl')).map(
    (state) => ({
      idx: Number(state.idx),
      balance: BigInt(String(state.balance)),
      pubkey: parseBigIntArray(state.pubkey) as [bigint, bigint],
      c: parseBigIntArray(state.c || [0, 0, 0, 0]),
    }),
  )
  const messages = readJsonl<any>(path.join(roundDir, 'messages.jsonl')).map(
    (message) => ({
      idx: Number(message.idx),
      msg: parseBigIntArray(message.msg),
      pubkey: parseBigIntArray(message.pubkey) as [bigint, bigint],
    }),
  )
  const dmessages = readJsonl<any>(path.join(roundDir, 'dmessages.jsonl')).map(
    (message) => ({
      idx: Number(message.idx),
      numSignUps: Number(message.num_sign_ups ?? message.numSignUps ?? 0),
      msg: parseBigIntArray(message.msg),
      pubkey: parseBigIntArray(message.pubkey) as [bigint, bigint],
    }),
  )

  return {
    roundDir,
    roundMeta,
    contractLogs: {
      states,
      messages,
      dmessages,
    },
  }
}

const requireNumber = (meta: RoundMeta, key: keyof RoundMeta) => {
  const value = meta[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`round_meta.${String(key)} is required`)
  }
  return value
}

const generateTsInputs = async ({
  roundMeta,
  contractLogs,
}: NormalizedRound): Promise<JsResult> => {
  if (Number(roundMeta.processed_msg_count || 0) !== 0) {
    throw new Error(
      'processed_msg_count > 0 is not supported by this benchmark TS path',
    )
  }
  if (!roundMeta.coord_priv_key) {
    throw new Error('round_meta.coord_priv_key is required')
  }

  const genInputsModule = '../src/operator/genInputs'
  const { genMaciInputs } = await import(genInputsModule)
  const result = genMaciInputs(
    {
      stateTreeDepth: requireNumber(roundMeta, 'state_tree_depth'),
      intStateTreeDepth: requireNumber(roundMeta, 'int_state_tree_depth'),
      voteOptionTreeDepth: requireNumber(roundMeta, 'vote_option_tree_depth'),
      batchSize: requireNumber(roundMeta, 'batch_size'),
      coordPriKey: BigInt(roundMeta.coord_priv_key),
      maxVoteOptions: requireNumber(roundMeta, 'max_vote_options'),
      isQuadraticCost: !!Number(roundMeta.circuit_type || 0),
      pollId: roundMeta.poll_id,
    },
    contractLogs,
    Number(roundMeta.processed_dmsg_count || 0),
  )
  const lastTallyInput = result.tallyInputs[result.tallyInputs.length - 1] as
    | { newResultsRootSalt?: unknown }
    | undefined

  return {
    msgInputs: result.msgInputs,
    tallyInputs: result.tallyInputs,
    result: result.result,
    salt: String(lastTallyInput?.newResultsRootSalt ?? 0),
  }
}

const runRustCli = async ({
  rustBin,
  roundDir,
  outDir,
  timeoutMs,
}: {
  rustBin: string
  roundDir: string
  outDir: string
  timeoutMs: number
}) => {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      rustBin,
      ['generate-msg-tally', '--round-dir', roundDir, '--out-dir', outDir],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    )
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`Rust inputgen timed out after ${timeoutMs}ms`))
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
          `Rust inputgen failed with code ${String(code)}: ${stderr || stdout}`.trim(),
        ),
      )
    })
  })
}

const loadIndexedJson = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => readJson<unknown>(path.join(dir, file)))

const loadRustResult = (outDir: string): RustResult => {
  const meta = readJson<{
    result?: string[]
    final_results_root_salt?: string
  }>(path.join(outDir, 'meta.json'))

  return {
    msgInputs: loadIndexedJson(path.join(outDir, 'msg_inputs')),
    tallyInputs: loadIndexedJson(path.join(outDir, 'tally_inputs')),
    result: meta.result || [],
    salt: meta.final_results_root_salt || '0',
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

const compareResults = (js: JsResult, rust: RustResult) => {
  const checks: [string, unknown, unknown][] = [
    ['msg_input_count', js.msgInputs.length, rust.msgInputs.length],
    ['tally_input_count', js.tallyInputs.length, rust.tallyInputs.length],
    ['result', js.result, rust.result],
    ['salt', js.salt, rust.salt],
  ]

  for (const [name, left, right] of checks) {
    if (stableStringify(left) !== stableStringify(right)) {
      return { matched: false, firstMismatch: name }
    }
  }

  const msgCount = Math.min(js.msgInputs.length, rust.msgInputs.length)
  for (let i = 0; i < msgCount; i++) {
    if (stableStringify(js.msgInputs[i]) !== stableStringify(rust.msgInputs[i])) {
      return { matched: false, firstMismatch: `msg_inputs[${i}]` }
    }
  }

  const tallyCount = Math.min(js.tallyInputs.length, rust.tallyInputs.length)
  for (let i = 0; i < tallyCount; i++) {
    if (
      stableStringify(js.tallyInputs[i]) !== stableStringify(rust.tallyInputs[i])
    ) {
      return { matched: false, firstMismatch: `tally_inputs[${i}]` }
    }
  }

  return { matched: true }
}

const average = (values: number[]) =>
  values.length === 0
    ? 0
    : round2(values.reduce((acc, value) => acc + value, 0) / values.length)

const printTable = (runs: BenchmarkRun[]) => {
  const headers = [
    ['iter', 6],
    ['readMs', 10],
    ['tsMs', 10],
    ['rustCliMs', 12],
    ['rustLoadMs', 12],
    ['rustTotalMs', 13],
    ['compareMs', 11],
    ['msg', 7],
    ['tally', 7],
    ['match', 8],
  ] as const
  const line = headers.map(([label, width]) => pad(label, width)).join('')
  console.log(line)
  console.log('-'.repeat(line.length))
  for (const run of runs) {
    console.log(
      [
        pad(run.iteration, 6),
        pad(run.normalizedReadMs, 10),
        pad(run.tsGenerateMs, 10),
        pad(run.rustCliMs, 12),
        pad(run.rustLoadMs, 12),
        pad(run.rustTotalMs, 13),
        pad(run.compareMs, 11),
        pad(run.msgInputs, 7),
        pad(run.tallyInputs, 7),
        pad(run.matched ? 'yes' : 'no', 8),
      ].join(''),
    )
  }
}

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.json) {
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error'
    process.env.INPUTGEN_BENCHMARK_HEARTBEAT_MS = '0'
  } else {
    process.env.INPUTGEN_BENCHMARK_HEARTBEAT_MS = String(options.heartbeatMs)
  }
  const normalizedRoundDir =
    options.roundDir ||
    path.join(options.dataDir, options.roundId, 'normalized', 'msg-tally')

  if (!fs.existsSync(normalizedRoundDir)) {
    throw new Error(`Normalized round dir does not exist: ${normalizedRoundDir}`)
  }
  if (!fs.existsSync(options.rustBin)) {
    throw new Error(`Rust inputgen binary does not exist: ${options.rustBin}`)
  }

  fs.mkdirSync(options.outDir, { recursive: true })

  if (!options.json) {
    console.log(`Round: ${options.roundId}`)
    console.log(`Normalized: ${normalizedRoundDir}`)
    console.log(`Rust bin: ${options.rustBin}`)
    console.log(`Output: ${options.outDir}`)
    console.log('')
  }

  const runs: BenchmarkRun[] = []
  let lastRound: NormalizedRound | undefined

  for (let iteration = 1; iteration <= options.iterations; iteration++) {
    const readStartedAt = now()
    const normalized = loadNormalizedRound(normalizedRoundDir)
    const normalizedReadMs = ms(readStartedAt)
    lastRound = normalized

    const tsStartedAt = now()
    const jsResult = await withHeartbeat(
      `iteration ${iteration} TS inputgen`,
      options.heartbeatMs,
      !options.json,
      () => generateTsInputs(normalized),
    )
    const tsGenerateMs = ms(tsStartedAt)

    const rustOutDir = path.join(
      options.outDir,
      `rust-iter-${String(iteration).padStart(3, '0')}`,
    )
    const rustStartedAt = now()
    await withHeartbeat(
      `iteration ${iteration} Rust inputgen`,
      options.heartbeatMs,
      !options.json,
      () =>
        runRustCli({
          rustBin: options.rustBin,
          roundDir: normalizedRoundDir,
          outDir: rustOutDir,
          timeoutMs: options.timeoutMs,
        }),
    )
    const rustCliMs = ms(rustStartedAt)

    const rustLoadStartedAt = now()
    const rustResult = loadRustResult(rustOutDir)
    const rustLoadMs = ms(rustLoadStartedAt)

    let compareMs = 0
    let matched = true
    let firstMismatch: string | undefined
    if (!options.skipCompare) {
      const compareStartedAt = now()
      const compare = await withHeartbeat(
        `iteration ${iteration} output compare`,
        options.heartbeatMs,
        !options.json,
        () => compareResults(jsResult, rustResult),
      )
      compareMs = ms(compareStartedAt)
      matched = compare.matched
      firstMismatch = compare.firstMismatch
    }

    runs.push({
      iteration,
      normalizedReadMs,
      tsGenerateMs,
      rustCliMs,
      rustLoadMs,
      rustTotalMs: rustCliMs + rustLoadMs,
      compareMs,
      msgInputs: rustResult.msgInputs.length,
      tallyInputs: rustResult.tallyInputs.length,
      matched,
      firstMismatch,
    })
  }

  const summary = {
    roundId: options.roundId,
    normalizedRoundDir,
    rustBin: options.rustBin,
    iterations: options.iterations,
    stateCount: lastRound?.contractLogs.states.length ?? 0,
    messageCount: lastRound?.contractLogs.messages.length ?? 0,
    dmessageCount: lastRound?.contractLogs.dmessages.length ?? 0,
    circuitPower: lastRound?.roundMeta.circuit_power,
    batchSize: lastRound?.roundMeta.batch_size,
    averages: {
      normalizedReadMs: average(runs.map((run) => run.normalizedReadMs)),
      tsGenerateMs: average(runs.map((run) => run.tsGenerateMs)),
      rustCliMs: average(runs.map((run) => run.rustCliMs)),
      rustLoadMs: average(runs.map((run) => run.rustLoadMs)),
      rustTotalMs: average(runs.map((run) => run.rustTotalMs)),
      compareMs: average(runs.map((run) => run.compareMs)),
    },
    speedup: {
      tsVsRustCli:
        average(runs.map((run) => run.rustCliMs)) > 0
          ? round2(
              average(runs.map((run) => run.tsGenerateMs)) /
                average(runs.map((run) => run.rustCliMs)),
            )
          : null,
      tsVsRustTotal:
        average(runs.map((run) => run.rustTotalMs)) > 0
          ? round2(
              average(runs.map((run) => run.tsGenerateMs)) /
                average(runs.map((run) => run.rustTotalMs)),
            )
          : null,
    },
    runs,
  }

  const reportPath = path.join(options.outDir, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2))

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  printTable(runs)
  console.log('')
  console.log(
    `Avg: read=${summary.averages.normalizedReadMs}ms, ts=${summary.averages.tsGenerateMs}ms, rustCli=${summary.averages.rustCliMs}ms, rustTotal=${summary.averages.rustTotalMs}ms`,
  )
  console.log(
    `Speedup: ts/rustCli=${summary.speedup.tsVsRustCli ?? 'n/a'}x, ts/rustTotal=${summary.speedup.tsVsRustTotal ?? 'n/a'}x`,
  )
  console.log(`Report: ${reportPath}`)

  const mismatch = runs.find((run) => !run.matched)
  if (mismatch) {
    throw new Error(
      `TS/Rust output mismatch at iteration ${mismatch.iteration}: ${mismatch.firstMismatch}`,
    )
  }
}

main()
  .then(() => {
    // genMaciInputs imports the operator logger, which keeps cleanup timers alive.
    process.exit(0)
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
