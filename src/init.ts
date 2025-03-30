import fs from 'fs'
// import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { downloadAndExtractZKeys } from './lib/downloadZkeys'
import { genKeypair } from './lib/keypair'
import { getWallet } from './wallet'

import {
  info,
} from './logger'

export async function init() {

  info('Init your coordinator info', 'INIT')

  if (!fs.existsSync(process.env.WORK_PATH)) {
    fs.mkdirSync(process.env.WORK_PATH)
  }

  const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY))
  const wallet = await getWallet()
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
