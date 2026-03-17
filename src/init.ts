import fs from 'fs'
// import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { downloadAndExtractZKeys } from './lib/downloadZkeys'
import path from 'path'
import { genKeypair } from './lib/keypair'
import { GenerateWallet } from './wallet'
import { info, error as logError } from './logger'
import { SUPPORTED_ZKEY_BUNDLES } from './types'
import { isBundleComplete, listMissingBundleFiles } from './lib/bundlesZkey'

export async function init() {
  info('Init your coordinator info', 'INIT')

  // check if env params are set (from config.toml via CLI or env)
  const hasPrivKey = !!process.env.COORDINATOR_PRI_KEY
  const hasMnemonic = !!process.env.MNEMONIC
  if (!hasPrivKey) {
    logError('Missing coordinatorPrivKey in config.toml (MACI coordinator private key)', 'INIT')
    process.exit(1)
  }
  if (!hasMnemonic) {
    logError('Missing mnemonic in config.toml (operator wallet mnemonic)', 'INIT')
    process.exit(1)
  }

  if (!process.env.RPC_ENDPOINT) {
    logError('Missing RPC_ENDPOINT. Please set rpcEndpoint in config.toml')
    process.exit(1)
  }

  if (!process.env.IND_ENDPOINT) {
    logError('Missing IND_ENDPOINT. Please set indexerEndpoint in config.toml')
    process.exit(1)
  }

  if (!process.env.DEACTIVATE_RECORDER) {
    logError('Missing DEACTIVATE_RECORDER. Please set registryContract (or deactivateRecorder) in config.toml')
    process.exit(1)
  }

  if (!fs.existsSync(process.env.WORK_PATH || './work')) {
    fs.mkdirSync(process.env.WORK_PATH || './work')
  }
  // ensure sub-directories exist for new layout
  try {
    const root = process.env.WORK_PATH || './work'
    const ensure = (p: string) => {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
    }
    ensure(root)
    // Migrate old layout if detected: cache -> data, data -> log
    try {
      const oldCache = root + '/cache'
      const oldData = root + '/data'
      const newLog = root + '/log'
      const newData = root + '/data'
      // 1) Move old data (logs) to new log if present and new log missing
      if (fs.existsSync(oldData) && !fs.existsSync(newLog)) {
        fs.renameSync(oldData, newLog)
      }
      // 2) Move old cache to new data if present and new data missing
      if (fs.existsSync(oldCache) && !fs.existsSync(newData)) {
        fs.renameSync(oldCache, newData)
      }
    } catch {}
    // New layout: 'data' for caches, 'log' for logs, 'round' unchanged
    ensure(root + '/data')
    ensure(root + '/log')
    ensure(root + '/round')
  } catch {}

  const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY!))
  const wallet = await GenerateWallet(0)
  const [{ address }] = await wallet.getAccounts()

  info('************************************************', 'INIT')
  info(`Coordinator Public key🔑🔑🔑🔑:`, 'INIT')
  info(`X: ${coordinator.pubKey[0]}`, 'INIT')
  info(`Y: ${coordinator.pubKey[1]}`, 'INIT')
  info(`Coordinator Vota address: ${address}`, 'INIT')
  info('************************************************', 'INIT')

  info(`code id list: ${process.env.CODE_IDS}`, 'INIT')

  info('Check your required zkey files🧐🧐🧐🧐', 'INIT')

  const zkeyRoot = (process.env.ZKEY_PATH || path.join(process.env.WORK_PATH || './work', 'zkey'))
  for (const bundle of SUPPORTED_ZKEY_BUNDLES) {
    const missing = listMissingBundleFiles(zkeyRoot, bundle)
    if (!isBundleComplete(zkeyRoot, bundle)) {
      info(`download zkey: ${bundle}${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`, 'INIT')
      await downloadAndExtractZKeys(bundle, zkeyRoot, {
        force: fs.existsSync(path.join(zkeyRoot, bundle)),
      })
    }
  }
}
