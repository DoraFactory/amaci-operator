#!/usr/bin/env node
// Mark CLI mode so shared logger won't attach long-lived exit handlers
process.env.AMACI_CLI = process.env.AMACI_CLI || '1'
import fs from 'fs'
import path from 'path'
// note: import heavy deps lazily inside subcommands to avoid keeping the process alive
import * as readlineSync from 'readline-sync'

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
  prover?: {
    pipeline?: number
    concurrency?: number
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
      pipeline: 1,
      concurrency: 2,
      saveChunk: 0,
      submitBatch: { msg: 0, tally: 0, deactivate: 0 },
    },
    deactivateInterval: 60000,
    logLevel: 'info',
    metricsPort: 3001,
    zkeyPath: path.join(workPath, 'zkey'),
  }
}

function moveExtractedZkeys(extracted: string, target: string) {
  const src = path.resolve(extracted)
  const dst = path.resolve(target)
  if (!fs.existsSync(src)) return
  if (src === dst) return
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true })
  const entries = fs.readdirSync(src)
  for (const name of entries) {
    const s = path.join(src, name)
    const t = path.join(dst, name)
    try {
      if (fs.existsSync(t)) fs.rmSync(t, { recursive: true, force: true })
    } catch {}
    fs.renameSync(s, t)
  }
  try {
    fs.rmSync(src, { recursive: true, force: true })
  } catch {}
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
  lines.push('# Operator identity (set on registry via: amaci set-operator identity <workDir>)')
  lines.push(`identity = "${cfg.identity || ''}"`)
  lines.push('')
  lines.push('# Filter rounds by code IDs (array of strings)')
  const codeIds = (cfg.codeIds && cfg.codeIds.length ? cfg.codeIds : [''])
    .map((s) => `"${s}"`)
    .join(', ')
  lines.push(`codeIds = [${codeIds}]`)
  lines.push('')
  lines.push('# aMACI operator account mnemonic on vota chain.')
  lines.push('# Please pay special attention that this operator must be used independently for the operator.')
  lines.push('# Otherwise it will cause sequence conflicts. It is also necessary to monitor the account balance to ensure the operator can pay the on-chain fees.')
  lines.push('# It is recommended to set an alert if it falls below 500 DORA and replenish funds in a timely manner.')
  lines.push(`mnemonic = "${cfg.mnemonic || ''}"`)
  lines.push('# operator MACI PrivKey(generated locally when set MACI key, do not share it)')
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
    '# Path to zkey folder containing circuit packs (2-1-1-5_v3, 4-2-2-25_v3)',
  )
  lines.push(`zkeyPath = "${cfg.zkeyPath || path.join(cfg.workPath, 'zkey')}"`)
  lines.push('')
  lines.push('# Prover configuration')
  lines.push('[prover]')
  lines.push('# Enable pipeline submission (1 to enable)')
  lines.push(`pipeline = ${cfg.prover?.pipeline ?? 1}`)
  lines.push('# Number of concurrent prover workers')
  lines.push(`concurrency = ${cfg.prover?.concurrency ?? 2}`)
  lines.push('# Persist proofs/inputs in chunks (0 = use the number of concurrency)')
  lines.push(`saveChunk = ${cfg.prover?.saveChunk ?? 0}`)
  lines.push('')
  lines.push('# Submission batch sizes (0 = use saveChunk if > 0, otherwise concurrency)')
  lines.push('[prover.submitBatch]')
  lines.push(`msg = ${cfg.prover?.submitBatch?.msg ?? 0}`)
  lines.push(`tally = ${cfg.prover?.submitBatch?.tally ?? 0}`)
  lines.push(`deactivate = ${cfg.prover?.submitBatch?.deactivate ?? 0}`)
  fs.writeFileSync(cfgPath, lines.join('\n'))
}

function readConfigToml(cfgPath: string): Config {
  const text = fs.readFileSync(cfgPath, 'utf8')
  const lines = text.split(/\r?\n/)
  const cfg: any = { prover: { submitBatch: {} } }
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
    // Download zkeys into parent dir of zkeyPath, which creates 'zkey/' folder
    const destRoot = path.dirname(zkeyPath)
    // Single override prompt for zkey target
    let doDownload = true
    let forceDownload = !!force
    if (fs.existsSync(zkeyPath) && !force) {
      const choice = readlineSync.question(
        `Zkey folder already exists at ${zkeyPath}, override? (y/n): `,
      )
      if (choice.toLowerCase() === 'y') {
        try {
          fs.rmSync(zkeyPath, { recursive: true, force: true })
        } catch {}
        forceDownload = true
      } else {
        doDownload = false
      }
    }
    try {
      const { downloadAndExtractZKeys } = await import(
        '../lib/downloadZkeys.js'
      )
      // Download two circuit packs by default
      if (doDownload) {
        await downloadAndExtractZKeys('2-1-1-5_v3', destRoot, {
          force: forceDownload,
        })
        await downloadAndExtractZKeys('4-2-2-25_v3', destRoot, {
          force: forceDownload,
        })
        // If actual extracted path is destRoot/zkey but zkeyPath differs, rename
        const extracted = path.join(destRoot, 'zkey')
        moveExtractedZkeys(extracted, zkeyPath)
      } else {
        console.log('Skip downloading zkeys (user chose not to override)')
      }
    } catch (e: any) {
      console.error(`ZKey download failed: ${e?.message || e}`)
      console.error(
        `You can retry later with: amaci zkey download ${workDir} --zkey ${zkeyPath} --force`,
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
    const required = ['2-1-1-5_v3', '4-2-2-25_v3']
    let missing = required.filter((r) => !fs.existsSync(path.join(zk, r)))
    if (missing.length) {
      const choice = readlineSync.question(
        `ZKey path ${zk} is missing: ${missing.join(', ')}.\n` +
          `Please verify the zkey directory exists and the path is correct.\n` +
          `Would you like to download the missing zkeys now? (y/n): `,
      )
      if (choice.toLowerCase() === 'y') {
        try {
          const destRoot = path.dirname(zk)
          const { downloadAndExtractZKeys } = await import(
            '../lib/downloadZkeys.js'
          )
          // download both packs (force to ensure presence)
          await downloadAndExtractZKeys('2-1-1-5_v3', destRoot, { force: true })
          await downloadAndExtractZKeys('4-2-2-25_v3', destRoot, {
            force: true,
          })
          moveExtractedZkeys(path.join(destRoot, 'zkey'), zk)
          missing = required.filter((r) => !fs.existsSync(path.join(zk, r)))
        } catch (e) {
          console.error(`Failed to download zkeys: ${e}`)
        }
      }
      if (missing.length) {
        console.error(
          `ZKey path ${zk} is missing: ${missing.join(', ')}. You can run: amaci zkey download ${workDir} --zkey ${zk} --force`,
        )
        process.exit(1)
      }
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
    // download two packs into parent of target zkey
    const destRoot = path.dirname(targetZkey)
    ensureDir(destRoot)
    // Single override prompt
    let proceed = true
    let forceDownload = !!force
    if (fs.existsSync(targetZkey) && !force) {
      const choice = readlineSync.question(
        `Zkey folder already exists at ${targetZkey}, override? (y/n): `,
      )
      if (choice.toLowerCase() === 'y') {
        try {
          fs.rmSync(targetZkey, { recursive: true, force: true })
        } catch {}
        forceDownload = true
      } else {
        proceed = false
      }
    }
    const { downloadAndExtractZKeys } = await import('../lib/downloadZkeys.js')
    if (proceed) {
      await downloadAndExtractZKeys('2-1-1-5_v3', destRoot, {
        force: forceDownload,
      })
      await downloadAndExtractZKeys('4-2-2-25_v3', destRoot, {
        force: forceDownload,
      })
      const extracted = path.join(destRoot, 'zkey')
      moveExtractedZkeys(extracted, targetZkey)
    } else {
      console.log('Skip downloading zkeys (user chose not to override)')
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
    const workDir = path.resolve(dir)
    const cfgPath = path.join(workDir, 'config.toml')
    if (!fs.existsSync(cfgPath)) {
      console.error(`config.toml not found in ${workDir}. Run: amaci init ${workDir}`)
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
    // connect signing client via shared utils
    const { getRegistrySignerClient } = await import('../lib/client/utils.js')
    const registry = await getRegistrySignerClient(cfg.registryContract)
    if (sub === 'identity') {
      if (!cfg.identity) {
        console.error('Missing identity in config.toml (identity = "...")')
        process.exit(1)
      }
      const res = await registry.setOperatorIdentity(cfg.identity)
      console.log(`set_maci_operator_identity sent. tx=${res.transactionHash}`)
      process.exit(0)
    }
    if (sub === 'maciPubkey') {
      // load key utils lazily
      const { genKeypair } = await import('../lib/keypair.js')
      // helper to validate and derive pubkey from an existing privKey
      const deriveFromPriv = (privStr: string | undefined) => {
        if (!privStr) return undefined
        try {
          if (!/^\d+$/.test(privStr)) return undefined
          const kp = genKeypair(BigInt(privStr))
          return { priv: String(kp.privKey), x: String(kp.pubKey[0]), y: String(kp.pubKey[1]) }
        } catch {
          return undefined
        }
      }

      const existing = deriveFromPriv(cfg.coordinatorPrivKey)
      let finalPriv: string
      let finalX: string
      let finalY: string

      if (existing) {
        const ans = readlineSync.question(
          'Detected existing coordinatorPrivKey in config. Overwrite with a new key? (y/n): ',
        )
        if (ans.toLowerCase() === 'y') {
          const kp = genKeypair()
          finalPriv = String(kp.privKey)
          finalX = String(kp.pubKey[0])
          finalY = String(kp.pubKey[1])
          cfg.coordinatorPrivKey = finalPriv
          writeConfigToml(cfgPath, cfg)
        } else {
          finalPriv = existing.priv
          finalX = existing.x
          finalY = existing.y
        }
      } else {
        const ans = readlineSync.question(
          'No valid coordinatorPrivKey found in config. Generate a new MACI key now? (y/n): ',
        )
        if (ans.toLowerCase() !== 'y') {
          console.error('Aborted: coordinatorPrivKey is required to set operator pubkey')
          process.exit(1)
        }
        const kp = genKeypair()
        finalPriv = String(kp.privKey)
        finalX = String(kp.pubKey[0])
        finalY = String(kp.pubKey[1])
        cfg.coordinatorPrivKey = finalPriv
        writeConfigToml(cfgPath, cfg)
      }

      // call registry with final pubkey
      const res = await registry.setOperatorPubkey(finalX, finalY)
      console.log(
        `set_maci_operator_pubkey sent. pubkey=(${finalX}, ${finalY}) tx=${res.transactionHash}`,
      )
      process.exit(0)
    }
    console.error('Unknown set-operator subcommand. Use maciPubkey')
    process.exit(1)
  }
  console.error(`Unknown command: ${cmd}`)
  printHelp()
  process.exit(1)
}

main(process.argv)
