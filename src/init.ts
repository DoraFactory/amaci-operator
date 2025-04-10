import fs from 'fs'
// import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { downloadAndExtractZKeys } from './lib/downloadZkeys'
import { genKeypair } from './lib/keypair'
import { GenerateWallet } from './wallet'
import { info, error as logError } from './logger'

export async function init() {
  info('Init your coordinator info', 'INIT')

  // check if env params are set
  if (!process.env.COORDINATOR_PRI_KEY) {
    logError('empty COORDINATOR_PRI_KEY in .env file!')
    process.exit(1)
  }

  if (!process.env.MNEMONIC) {
    logError('empty MNEMONIC in .env file!')
    process.exit(1)
  }

  if (!process.env.RPC_ENDPOINT) {
    logError('empty RPC_ENDPOINT in .env file!')
    process.exit(1)
  }

  if (!process.env.IND_ENDPOINT) {
    logError('empty IND_ENDPOINT in .env file!')
    process.exit(1)
  }

  if (!process.env.DEACTIVATE_RECORDER) {
    logError('empty DEACTIVATE_RECORDER in .env file!')
    process.exit(1)
  }

  if (!fs.existsSync(process.env.WORK_PATH || './work')) {
    fs.mkdirSync(process.env.WORK_PATH || './work')
  }

  const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY))
  const wallet = await GenerateWallet(0)
  const [{ address }] = await wallet.getAccounts()

  info('************************************************', 'INIT')
  info(`Coordinator Public key🔑🔑🔑🔑:`, 'INIT')
  info(`X: ${coordinator.pubKey[0]}`, 'INIT')
  info(`Y: ${coordinator.pubKey[1]}`, 'INIT')
  info(`Coordinator Vota address: ${address}`, 'INIT')
  info('************************************************', 'INIT')

  info('Check your required zkey files🧐🧐🧐🧐', 'INIT')

  if (!fs.existsSync('./zkey/2-1-1-5_v2')) {
    info('Start to download zkey: 2-1-1-5_v2', 'INIT')
    await downloadAndExtractZKeys('2-1-1-5_v2')
  }

  if (!fs.existsSync('./zkey/4-2-2-25_v2')) {
    info('download zkey: 4-2-2-25_v2', 'INIT')
    await downloadAndExtractZKeys('4-2-2-25_v2')
  }
}
