#!/usr/bin/env node
// Mark CLI mode so shared logger won't attach long-lived exit handlers
process.env.AMACI_CLI = process.env.AMACI_CLI || '1'
import fs from 'fs'
import path from 'path'
// note: import heavy deps lazily inside subcommands to avoid keeping the process alive
import * as readlineSync from 'readline-sync'
import { STARTUP_REQUIRED_ZKEY_BUNDLES, SUPPORTED_ZKEY_BUNDLES } from '../types'
import { isBundleComplete, listMissingBundleFiles } from '../lib/bundlesZkey'
import {
  isAffirmativeAnswer,
  normalizeSetOperatorSubcommand,
  resolveCoordinatorPrivKeyStrategy,
} from './setOperator'

// Helper: write file if missing
function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

type Config = {
  workPath: string
  rpcEndpoint?: string
  indexerEndpoint?: string
  registryContract?: string
  identity?: string
  coordinatorPrivKey?: string
  mnemonic?: string
  codeIds?: string[]
  witnessCalc?: {
    backend?: string
    witnesscalcPath?: string
  }
  rustInputgen?: {
    shadow?: number
    strict?: number
    msgTally?: number
    msgTallyPrimary?: number
    msgTallyTimeoutMs?: number
    binPath?: string
    shadowCmd?: string
  }
  prover?: {
    backend?: string
    rapidsnarkPath?: string
    // legacy location; prefer [witnessCalc].witnesscalcPath
    witnesscalcPath?: string
    pipeline?: number
    concurrency?: number
    concurrencyByCircuit?: Record<string, number>
    saveChunk?: number
    submitBatch?: {
      msg?: number
      tally?: number
      deactivate?: number
    }
  }
  deactivateInterval?: number
  logLevel?: string
  metricsPort?: number
  zkeyPath?: string
}

function defaultConfig(workPath: string): Config {
  return {
    workPath,
    rpcEndpoint: '',
    indexerEndpoint: '',
    registryContract: '',
    identity: '',
    coordinatorPrivKey: '',
    mnemonic: '',
    codeIds: [''],
    prover: {
      backend: 'snarkjs',
      rapidsnarkPath: '',
      pipeline: 1,
      concurrency: 2,
      concurrencyByCircuit: {
        '2-1-1-5': 3,
        '4-2-2-25': 2,
        '6-3-3-125': 1,
        '9-4-3-125': 1,
      },
      saveChunk: 0,
      submitBatch: { msg: 0, tally: 0, deactivate: 0 },
    },
    deactivateInterval: 60000,
    logLevel: 'info',
    metricsPort: 3001,
    zkeyPath: path.join(workPath, 'zkey'),
    witnessCalc: {
      backend: 'snarkjs',
      witnesscalcPath: '',
    },
    rustInputgen: {
      shadow: 0,
      strict: 0,
      msgTally: 0,
      msgTallyPrimary: 0,
      msgTallyTimeoutMs: 20000,
      binPath: '',
      shadowCmd: '',
    },
  }
}

function writeConfigToml(cfgPath: string, cfg: Config) {
  const lines: string[] = []
  lines.push('# aMACI operator configuration (config.toml)')
  lines.push(
    '# Fill RPC/Indexer endpoints and identity. Both coordinatorPrivKey (MACI key) and mnemonic (operator wallet) must be set.',
  )
  lines.push('')
  lines.push('# Working directory for data, logs and caches')
  lines.push(`workPath = "${cfg.workPath}"`)
  lines.push('')
  lines.push('# RPC endpoint of chain (e.g., https://rpc.node:26657)')
  lines.push(`rpcEndpoint = "${cfg.rpcEndpoint || ''}"`)
  lines.push('# Indexer endpoint (GraphQL)')
  lines.push(`indexerEndpoint = "${cfg.indexerEndpoint || ''}"`)
  lines.push('# Deactivate recorder contract address(registryContract)')
  lines.push(`registryContract = "${cfg.registryContract || ''}"`)
  lines.push('')
  lines.push(
    '# Operator identity (set on registry via: amaci set-operator identity <workDir>)',
  )
  lines.push(`identity = "${cfg.identity || ''}"`)
  lines.push('')
  lines.push(
    '# Round code IDs to exclude from inspection/processing (array of strings)',
  )
  const codeIds = (cfg.codeIds && cfg.codeIds.length ? cfg.codeIds : [''])
    .map((s) => `"${s}"`)
    .join(', ')
  lines.push(`codeIds = [${codeIds}]`)
  lines.push('')
  lines.push('# aMACI operator account mnemonic on vota chain.')
  lines.push(
    '# Please pay special attention that this operator must be used independently for the operator.',
  )
  lines.push(
    '# Otherwise it will cause sequence conflicts. It is also necessary to monitor the account balance to ensure the operator can pay the on-chain fees.',
  )
  lines.push(
    '# It is recommended to set an alert if it falls below 500 DORA and replenish funds in a timely manner.',
  )
  lines.push(`mnemonic = "${cfg.mnemonic || ''}"`)
  lines.push(
    '# operator MACI PrivKey(generated locally when set MACI key, do not share it)',
  )
  lines.push(`coordinatorPrivKey = "${cfg.coordinatorPrivKey || ''}"`)
  lines.push('')
  lines.push('# Interval between deactivate tasks (ms)')
  lines.push(`deactivateInterval = ${cfg.deactivateInterval ?? 60000}`)
  lines.push('# Log level: error | warn | info | debug')
  lines.push(`logLevel = "${cfg.logLevel || 'info'}"`)
  lines.push('# Metrics server port(default: 3001)')
  lines.push(`metricsPort = ${cfg.metricsPort ?? 3001}`)
  lines.push('')
  lines.push(
    '# Path to zkey folder containing circuit packs (2-1-1-5_v3/v4, 4-2-2-25_v3/v4, 6-3-3-125_v3/v4, 9-4-3-125_v4)',
  )
  lines.push(`zkeyPath = "${cfg.zkeyPath || path.join(cfg.workPath, 'zkey')}"`)
  lines.push('')
  lines.push('[witnessCalc]')
  lines.push('# witness backend: snarkjs | witnesscalc')
  lines.push(`backend = "${cfg.witnessCalc?.backend || 'snarkjs'}"`)
  lines.push('# Path to witnesscalc binary (if not in PATH)')
  lines.push(
    `witnesscalcPath = "${cfg.witnessCalc?.witnesscalcPath || cfg.prover?.witnesscalcPath || ''}"`,
  )
  lines.push('')
  lines.push('# Rust inputgen configuration')
  lines.push('[rustInputgen]')
  lines.push('# Enable Rust inputgen shadow mode for deactivate (0 | 1)')
  lines.push(`shadow = ${cfg.rustInputgen?.shadow ?? 0}`)
  lines.push('# Fail the task when JS/Rust diff is detected (0 | 1)')
  lines.push(`strict = ${cfg.rustInputgen?.strict ?? 0}`)
  lines.push('# Enable Rust msg/tally shadow mode in tally (0 | 1)')
  lines.push(`msgTally = ${cfg.rustInputgen?.msgTally ?? 0}`)
  lines.push('# Use Rust msg/tally inputs as the primary prover/submission inputs (0 | 1)')
  lines.push(`msgTallyPrimary = ${cfg.rustInputgen?.msgTallyPrimary ?? 0}`)
  lines.push('# Timeout for Rust msg/tally shadow in milliseconds')
  lines.push(`msgTallyTimeoutMs = ${cfg.rustInputgen?.msgTallyTimeoutMs ?? 20000}`)
  lines.push('# Path to maci-inputgen binary')
  lines.push(`binPath = "${cfg.rustInputgen?.binPath || ''}"`)
  lines.push(
    '# Optional shell command prefix, e.g. cargo run -p maci-inputgen --',
  )
  lines.push(`shadowCmd = "${cfg.rustInputgen?.shadowCmd || ''}"`)
  lines.push('')
  lines.push('# Prover configuration')
  lines.push('[prover]')
  lines.push('# Prover backend: snarkjs | rapidsnark')
  lines.push(`backend = "${cfg.prover?.backend || 'snarkjs'}"`)
  lines.push('# Path to rapidsnark binary (if not in PATH)')
  lines.push(`rapidsnarkPath = "${cfg.prover?.rapidsnarkPath || ''}"`)
  lines.push('# Enable pipeline submission (1 to enable)')
  lines.push(`pipeline = ${cfg.prover?.pipeline ?? 1}`)
  lines.push('# Number of concurrent prover workers')
  lines.push(`concurrency = ${cfg.prover?.concurrency ?? 2}`)
  lines.push(
    '# Persist proofs/inputs in chunks (0 = use the number of concurrency)',
  )
  lines.push(`saveChunk = ${cfg.prover?.saveChunk ?? 0}`)
  lines.push('')
  lines.push(
    '# Per-circuit concurrency overrides (keys are circuit power without _v3/_v4 suffix)',
  )
  lines.push('[prover.concurrencyByCircuit]')
  const concurrencyByCircuit = cfg.prover?.concurrencyByCircuit || {}
  const entries = Object.entries(concurrencyByCircuit)
  if (entries.length === 0) {
    lines.push('# "2-1-1-5" = 3')
    lines.push('# "4-2-2-25" = 2')
    lines.push('# "6-3-3-125" = 1')
    lines.push('# "9-4-3-125" = 1')
  } else {
    for (const [key, value] of entries) {
      lines.push(`"${key}" = ${value}`)
    }
  }
  lines.push('')
  lines.push(
    '# Submission batch sizes (0 = use saveChunk if > 0, otherwise concurrency)',
  )
  lines.push('[prover.submitBatch]')
  lines.push(`msg = ${cfg.prover?.submitBatch?.msg ?? 0}`)
  lines.push(`tally = ${cfg.prover?.submitBatch?.tally ?? 0}`)
  lines.push(`deactivate = ${cfg.prover?.submitBatch?.deactivate ?? 0}`)
  fs.writeFileSync(cfgPath, lines.join('\n'))
}

function readConfigToml(cfgPath: string): Config {
  const text = fs.readFileSync(cfgPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const cfg: any = {
    witnessCalc: {},
    rustInputgen: {},
    prover: { submitBatch: {}, concurrencyByCircuit: {} },
  }
  let section = ''
  const topKeys = new Set([
    'workPath',
    'rpcEndpoint',
    'indexerEndpoint',
    'registryContract',
    'identity',
    'deactivateRecorder',
    'coordinatorPrivKey',
    'mnemonic',
    'codeIds',
    'deactivateInterval',
    'logLevel',
    'metricsPort',
    'zkeyPath',
  ])
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1)
      continue
    }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    const parseVal = (v: string): any => {
      if (v.startsWith('[') && v.endsWith(']')) {
        const inner = v.slice(1, -1).trim()
        if (!inner) return []
        return inner
          .split(',')
          .map((s) => s.trim())
          .map((s) =>
            s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s,
          )
      }
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      )
        return v.slice(1, -1)
      if (/^\d+$/.test(v)) return Number(v)
      return v
    }
    const value = parseVal(val)
    if (!section || topKeys.has(key)) {
      cfg[key] = value
    } else if (section === 'prover') {
      cfg.prover[key] = value
    } else if (section === 'witnessCalc') {
      cfg.witnessCalc[key] = value
    } else if (section === 'rustInputgen') {
      cfg.rustInputgen[key] = value
    } else if (section === 'prover.concurrencyByCircuit') {
      const map = cfg.prover.concurrencyByCircuit || {}
      const normalizedKey = key.replace(/^['"]|['"]$/g, '')
      const num = typeof value === 'number' ? value : Number(value)
      if (Number.isFinite(num)) map[normalizedKey] = num
      cfg.prover.concurrencyByCircuit = map
    } else if (section === 'prover.submitBatch') {
      cfg.prover.submitBatch[key] = value
    }
  }
  if (!cfg.workPath) throw new Error('Missing workPath in config')
  return cfg as Config
}

function applyEnvFromConfig(cfg: Config) {
  process.env.WORK_PATH = cfg.workPath
  if (cfg.rpcEndpoint) process.env.RPC_ENDPOINT = cfg.rpcEndpoint
  if (cfg.indexerEndpoint) process.env.IND_ENDPOINT = cfg.indexerEndpoint
  if (cfg.registryContract)
    process.env.DEACTIVATE_RECORDER = cfg.registryContract
  if (cfg.coordinatorPrivKey)
    process.env.COORDINATOR_PRI_KEY = cfg.coordinatorPrivKey
  if (cfg.mnemonic) process.env.MNEMONIC = cfg.mnemonic
  if (cfg.codeIds) process.env.CODE_IDS = JSON.stringify(cfg.codeIds)
  if (cfg.prover?.concurrency != null)
    process.env.PROVER_CONCURRENCY = String(cfg.prover.concurrency)
  if (cfg.prover?.backend) process.env.PROVER_BACKEND = cfg.prover.backend
  if (cfg.prover?.rapidsnarkPath)
    process.env.RAPIDSNARK_PATH = cfg.prover.rapidsnarkPath
  if (cfg.witnessCalc?.backend)
    process.env.WITNESS_BACKEND = cfg.witnessCalc.backend
  if (cfg.witnessCalc?.witnesscalcPath || cfg.prover?.witnesscalcPath)
    process.env.WITNESSCALC_PATH =
      cfg.witnessCalc?.witnesscalcPath || cfg.prover?.witnesscalcPath || ''
  if (cfg.rustInputgen?.shadow != null)
    process.env.RUST_INPUTGEN_SHADOW = String(cfg.rustInputgen.shadow)
  if (cfg.rustInputgen?.strict != null)
    process.env.RUST_INPUTGEN_SHADOW_STRICT = String(cfg.rustInputgen.strict)
  if (cfg.rustInputgen?.msgTally != null)
    process.env.RUST_INPUTGEN_MSG_TALLY = String(cfg.rustInputgen.msgTally)
  if (cfg.rustInputgen?.msgTallyPrimary != null)
    process.env.RUST_INPUTGEN_MSG_TALLY_PRIMARY = String(
      cfg.rustInputgen.msgTallyPrimary,
    )
  if (cfg.rustInputgen?.msgTallyTimeoutMs != null)
    process.env.RUST_INPUTGEN_MSG_TALLY_TIMEOUT_MS = String(
      cfg.rustInputgen.msgTallyTimeoutMs,
    )
  if (cfg.rustInputgen?.binPath)
    process.env.RUST_INPUTGEN_BIN = cfg.rustInputgen.binPath
  if (cfg.rustInputgen?.shadowCmd)
    process.env.RUST_INPUTGEN_SHADOW_CMD = cfg.rustInputgen.shadowCmd
  if (cfg.prover?.concurrencyByCircuit)
    process.env.PROVER_CONCURRENCY_BY_CIRCUIT = JSON.stringify(
      cfg.prover.concurrencyByCircuit,
    )
  if (cfg.prover?.saveChunk != null)
    process.env.PROVER_SAVE_CHUNK = String(cfg.prover.saveChunk)
  if (cfg.prover?.pipeline != null)
    process.env.PROVER_PIPELINE = String(cfg.prover.pipeline)
  if (cfg.prover?.submitBatch?.msg != null)
    process.env.SUBMIT_BATCH_MSG = String(cfg.prover.submitBatch.msg)
  if (cfg.prover?.submitBatch?.tally != null)
    process.env.SUBMIT_BATCH_TALLY = String(cfg.prover.submitBatch.tally)
  if (cfg.prover?.submitBatch?.deactivate != null)
    process.env.SUBMIT_BATCH_DEACTIVATE = String(
      cfg.prover.submitBatch.deactivate,
    )
  if (cfg.deactivateInterval != null)
    process.env.DEACTIVATE_INTERVAL = String(cfg.deactivateInterval)
  if (cfg.logLevel) process.env.LOG_LEVEL = cfg.logLevel
  if (cfg.metricsPort != null)
    process.env.METRICS_PORT = String(cfg.metricsPort)
  if (cfg.zkeyPath) process.env.ZKEY_PATH = cfg.zkeyPath
}

function getVersion(): string {
  try {
    // Try to read package.json from multiple possible locations
    const pkg = require('../../package.json')
    return pkg.version
  } catch {
    return 'unknown'
  }
}

function existingZkeyBundles(zkeyPath: string, bundles: string[]): string[] {
  return bundles.filter((bundle) => fs.existsSync(path.join(zkeyPath, bundle)))
}

function readOptionValue(
  args: string[],
  longFlag: string,
  shortFlag?: string,
): string | undefined {
  const longIdx = args.indexOf(longFlag)
  const shortIdx = shortFlag ? args.indexOf(shortFlag) : -1
  const idx = longIdx >= 0 ? longIdx : shortIdx
  return idx >= 0 ? args[idx + 1] : undefined
}

function printVersion() {
  console.log(`maci-operator v${getVersion()}`)
}

function printHelp() {
  const version = getVersion()
  console.log(`maci - MACI operator CLI v${version}\n`)
  console.log(`Usage:`)
  console.log(`  maci init <dir> [--zkey <path>] [--force]`)
  console.log(`  maci start <dir> [--zkey <path>]`)
  console.log(`  maci zkey download <dir> [--zkey <path>] [--force]`)
  console.log(`  maci set-operator identity <dir>`)
  console.log(`  maci set-operator maciPubKey <dir>`)
  console.log(`\nOptions:`)
  console.log(`  -h, --help       Show this help message`)
  console.log(`  -v, --version    Show version number`)
}

async function main(argv: string[]) {
  const args = argv.slice(2)
  const cmd = args[0]
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp()
    process.exit(0)
  }
  if (cmd === '--version' || cmd === '-v') {
    printVersion()
    process.exit(0)
  }
  if (cmd === 'init') {
    const dir = args[1]
    const force = args.includes('--force') || args.includes('-f')
    const zkeyIdx = Math.max(args.indexOf('--zkey'), args.indexOf('-z'))
    const zkeyOpt = zkeyIdx >= 0 ? args[zkeyIdx + 1] : undefined
    if (!dir) {
      console.error('Missing <dir>')
      printHelp()
      process.exit(1)
    }
    const workDir = path.resolve(dir)
    ensureDir(workDir)
    // New directory layout: data (cache), log (logs), round (per-round logs)
    ensureDir(path.join(workDir, 'data'))
    ensureDir(path.join(workDir, 'log'))
    ensureDir(path.join(workDir, 'round'))
    const defaultZkey = path.join(workDir, 'zkey')
    const zkeyPath = zkeyOpt ? path.resolve(zkeyOpt) : defaultZkey
    ensureDir(path.dirname(zkeyPath))
    const cfgPath = path.join(workDir, 'config.toml')
    if (fs.existsSync(cfgPath) && !force) {
      console.error(
        `config.yaml already exists at ${cfgPath}. Use --force to overwrite`,
      )
      process.exit(1)
    }
    const cfg = defaultConfig(workDir)
    cfg.zkeyPath = zkeyPath
    writeConfigToml(cfgPath, cfg)
    ensureDir(zkeyPath)
    let overwriteExistingBundles = !!force
    const existingBundles = existingZkeyBundles(
      zkeyPath,
      SUPPORTED_ZKEY_BUNDLES,
    )
    if (existingBundles.length > 0 && !force) {
      const choice = readlineSync.question(
        `Existing zkey bundles found at ${zkeyPath}: ${existingBundles.join(', ')}. Overwrite only these bundles? (y/n): `,
      )
      overwriteExistingBundles = choice.toLowerCase() === 'y'
    }
    try {
      const { downloadAndExtractZKeys } = await import(
        '../lib/downloadZkeys.js'
      )
      // Download all supported circuit packs by default
      for (const bundle of SUPPORTED_ZKEY_BUNDLES) {
        const exists = fs.existsSync(path.join(zkeyPath, bundle))
        const complete = isBundleComplete(zkeyPath, bundle)
        if (exists && complete && !overwriteExistingBundles) {
          continue
        }
        await downloadAndExtractZKeys(bundle, zkeyPath, {
          force: exists,
        })
      }
    } catch (e: any) {
      console.error(`ZKey download failed: ${e?.message || e}`)
      console.error(
        `You can retry later with: maci zkey download ${workDir} --zkey ${zkeyPath} --force`,
      )
      process.exit(1)
    }
    console.log(`Initialized work directory at ${workDir}`)
    console.log(`- data/: inputs and proof cache`)
    console.log(`- log/: daily rotated logs`)
    console.log(`- round/: per-round logs`)
    console.log(`- config.toml: operator configuration`)
    console.log(`- zkey/: circuit files at ${zkeyPath}`)
    process.exit(0)
  }
  if (cmd === 'start') {
    const dir = args[1]
    const zkeyIdx = Math.max(args.indexOf('--zkey'), args.indexOf('-z'))
    const zkeyOpt = zkeyIdx >= 0 ? args[zkeyIdx + 1] : undefined
    if (!dir) {
      console.error('Missing <dir>')
      printHelp()
      process.exit(1)
    }
    const workDir = path.resolve(dir)
    const cfgPath = path.join(workDir, 'config.toml')
    if (!fs.existsSync(cfgPath)) {
      console.error(
        `config.toml not found in ${workDir}. Run: amaci init ${workDir}`,
      )
      process.exit(1)
    }
    let cfg: Config
    try {
      cfg = readConfigToml(cfgPath)
    } catch (e) {
      console.error(`Failed to parse config.toml: ${e}`)
      process.exit(1)
      return
    }
    cfg.workPath = cfg.workPath || workDir
    if (zkeyOpt) {
      cfg.zkeyPath = path.resolve(zkeyOpt)
    }
    // Resolve effective zkey path (CLI > config > default)
    const zk = cfg.zkeyPath || path.join(workDir, 'zkey')
    console.log(`Using config: ${cfgPath}`)
    console.log(`Using zkeyPath: ${zk}`)
    const required = STARTUP_REQUIRED_ZKEY_BUNDLES
    const missing = required.filter((r) => !isBundleComplete(zk, r))
    if (missing.length) {
      const details = missing
        .map(
          (bundle) =>
            `${bundle}: ${listMissingBundleFiles(zk, bundle).join(', ')}`,
        )
        .join('\n')
      console.error(
        `Missing required startup zkeys in ${zk}: ${missing.join(', ')}.\n` +
          `${details}\n` +
          `Please verify that zkeyPath is correct and the required startup circuit packs exist.\n` +
          `Download them first with: maci zkey download ${workDir} --zkey ${zk} --force`,
      )
      process.exit(1)
    }
    applyEnvFromConfig(cfg)
    require('..')
    return
  }
  if (cmd === 'zkey') {
    const sub = args[1]
    if (sub !== 'download') {
      console.error('Unknown zkey subcommand')
      printHelp()
      process.exit(1)
    }
    const dir = args[2]
    const force = args.includes('--force') || args.includes('-f')
    const zkeyIdx = Math.max(args.indexOf('--zkey'), args.indexOf('-z'))
    const zkeyOpt = zkeyIdx >= 0 ? args[zkeyIdx + 1] : undefined
    if (!dir) {
      console.error('Missing <dir>')
      printHelp()
      process.exit(1)
    }
    const workDir = path.resolve(dir)
    // Resolve default zkeyPath from config.toml if exists, else <workDir>/zkey
    let cfgZkey: string | undefined
    const cfgPath = path.join(workDir, 'config.toml')
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = readConfigToml(cfgPath)
        if (cfg && typeof cfg === 'object' && cfg.zkeyPath)
          cfgZkey = cfg.zkeyPath
      } catch {}
    }
    const targetZkey = zkeyOpt
      ? path.resolve(zkeyOpt)
      : cfgZkey || path.join(workDir, 'zkey')
    ensureDir(targetZkey)
    let overwriteExistingBundles = !!force
    const existingBundles = existingZkeyBundles(
      targetZkey,
      SUPPORTED_ZKEY_BUNDLES,
    )
    if (existingBundles.length > 0 && !force) {
      const choice = readlineSync.question(
        `Existing zkey bundles found at ${targetZkey}: ${existingBundles.join(', ')}. Overwrite only these bundles? (y/n): `,
      )
      overwriteExistingBundles = choice.toLowerCase() === 'y'
    }
    const { downloadAndExtractZKeys } = await import('../lib/downloadZkeys.js')
    for (const bundle of SUPPORTED_ZKEY_BUNDLES) {
      const exists = fs.existsSync(path.join(targetZkey, bundle))
      const complete = isBundleComplete(targetZkey, bundle)
      if (exists && complete && !overwriteExistingBundles) {
        continue
      }
      await downloadAndExtractZKeys(bundle, targetZkey, {
        force: exists,
      })
    }
    console.log(`ZKeys downloaded to ${targetZkey}`)
    process.exit(0)
  }
  if (cmd === 'set-operator') {
    const sub = args[1]
    const dir = args[2]
    if (!sub || !dir) {
      console.error('Usage: amaci set-operator <identity|maciPubKey> <workDir>')
      process.exit(1)
    }
    const normalizedSub = normalizeSetOperatorSubcommand(sub)
    if (!normalizedSub) {
      console.error(
        'Unknown set-operator subcommand. Use identity or maciPubKey',
      )
      process.exit(1)
    }
    const workDir = path.resolve(dir)
    const cfgPath = path.join(workDir, 'config.toml')
    if (!fs.existsSync(cfgPath)) {
      console.error(
        `config.toml not found in ${workDir}. Run: amaci init ${workDir}`,
      )
      process.exit(1)
    }
    // load config
    const cfg = readConfigToml(cfgPath)
    cfg.workPath = cfg.workPath || workDir
    // apply env for wallet
    applyEnvFromConfig(cfg)
    if (!cfg.registryContract) {
      console.error('Missing registryContract in config.toml')
      process.exit(1)
    }
    if (!process.env.RPC_ENDPOINT) {
      console.error('Missing rpcEndpoint in config.toml')
      process.exit(1)
    }
    if (normalizedSub === 'identity') {
      if (!cfg.identity) {
        console.error('Missing identity in config.toml (identity = "...")')
        process.exit(1)
      }
      const { getRegistrySignerClient } = await import('../lib/client/utils.js')
      const registry = await getRegistrySignerClient(cfg.registryContract)
      const res = await registry.setOperatorIdentity(cfg.identity)
      console.log(`set_maci_operator_identity sent. tx=${res.transactionHash}`)
      process.exit(0)
    }
    if (normalizedSub === 'maciPubkey') {
      // load key utils lazily
      const {
        genKeypair,
        deriveCoordinatorPubKey,
        serializePubKey,
      } = await import('../lib/keypair.js')
      const requestedModeRaw = readOptionValue(args, '--key-generation', '-k')
      if (requestedModeRaw) {
        console.error(
          '--key-generation is no longer needed. Operator pubkeys are always derived with the default padded mode.',
        )
        process.exit(1)
      }
      const deriveFromPriv = (privStr: string | undefined) => {
        if (!privStr) return undefined
        try {
          if (!/^\d+$/.test(privStr)) return undefined
          const privKey = BigInt(privStr)
          const pubKey = deriveCoordinatorPubKey(privKey)
          return {
            priv: privStr,
            padded: serializePubKey(pubKey),
          }
        } catch {
          return undefined
        }
      }

      const existing = deriveFromPriv(cfg.coordinatorPrivKey)
      let finalPriv: string
      let finalDerived:
        | NonNullable<ReturnType<typeof deriveFromPriv>>
        | undefined

      if (resolveCoordinatorPrivKeyStrategy(!!existing) === 'reuse-existing') {
        finalPriv = existing!.priv
        finalDerived = existing
        console.log('Using existing coordinatorPrivKey from config.toml')
      } else {
        const kp = genKeypair()
        finalPriv = String(kp.privKey)
        cfg.coordinatorPrivKey = finalPriv
        writeConfigToml(cfgPath, cfg)
        finalDerived = deriveFromPriv(finalPriv)
        console.log(
          'Generated and saved a new coordinatorPrivKey to config.toml',
        )
      }

      if (!finalDerived) {
        console.error(
          'Failed to derive operator pubkeys from coordinatorPrivKey',
        )
        process.exit(1)
      }

      const finalPubkey = finalDerived.padded

      console.log('Ready to set operator MACI public key on-chain:')
      console.log(`  pubkey: (${finalPubkey.x}, ${finalPubkey.y})`)
      console.log('Derived coordinator pubkey from the active private key:')
      console.log(`  padded: (${finalDerived.padded.x}, ${finalDerived.padded.y})`)
      const confirmation = readlineSync.question(
        'Confirm sending this operator pubkey on-chain? (y/n): ',
      )
      if (!isAffirmativeAnswer(confirmation)) {
        console.error('Aborted: operator pubkey was not submitted on-chain')
        process.exit(1)
      }

      // call registry with final pubkey
      const { getRegistrySignerClient } = await import('../lib/client/utils.js')
      const registry = await getRegistrySignerClient(cfg.registryContract)
      const res = await registry.setOperatorPubkey(finalPubkey.x, finalPubkey.y)
      console.log(
        `set_maci_operator_pubkey sent. pubkey=(${finalPubkey.x}, ${finalPubkey.y}) tx=${res.transactionHash}`,
      )
      process.exit(0)
    }
  }
  console.error(`Unknown command: ${cmd}`)
  printHelp()
  process.exit(1)
}

main(process.argv)
