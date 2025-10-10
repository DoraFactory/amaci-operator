import fs from 'fs'
// import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { downloadAndExtractZKeys } from './lib/downloadZkeys'
import path from 'path'
import { genKeypair } from './lib/keypair'
import { GenerateWallet } from './wallet'
import { info, error as logError } from './logger'

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
    ensure(root + '/cache')
    ensure(root + '/data')
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
  if (!fs.existsSync(path.join(zkeyRoot, '2-1-1-5_v3'))) {
    info('Start to download zkey: 2-1-1-5_v3', 'INIT')
    await downloadAndExtractZKeys('2-1-1-5_v3')
  }

  if (!fs.existsSync(path.join(zkeyRoot, '4-2-2-25_v3'))) {
    info('download zkey: 4-2-2-25_v3', 'INIT')
    await downloadAndExtractZKeys('4-2-2-25_v3')
  }
}
