import fs from 'fs'
// import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { downloadAndExtractZKeys } from './lib/downloadZkeys'
import { genKeypair } from './lib/keypair'
import { getWallet } from './wallet'

export async function init() {
  console.log('Init')
  if (!fs.existsSync(process.env.WORK_PATH)) {
    fs.mkdirSync(process.env.WORK_PATH)
  }

  // ==========================================================================

  const coordinator = genKeypair(BigInt(process.env.COORDINATOR_PRI_KEY))

  console.log('\nCoordinator public key:')
  console.log('X:', String(coordinator.pubKey[0]))
  console.log('Y:', String(coordinator.pubKey[1]))

  // ==========================================================================

  const wallet = await getWallet()
  const [{ address }] = await wallet.getAccounts()
  console.log('\nVota address:')
  console.log(address)

  // ==========================================================================

  console.log('\nStart to download zkey:')

  if (!fs.existsSync('./zkey/2-1-1-5_v2')) {
    console.log('download zkey: 2-1-1-5_v2')
    await downloadAndExtractZKeys('2-1-1-5_v2')
  }

  if (!fs.existsSync('./zkey/4-2-2-25_v2')) {
    console.log('download zkey: 4-2-2-25_v2')
    await downloadAndExtractZKeys('4-2-2-25_v2')
  }
}
