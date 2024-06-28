import fs from 'fs'
import { Secp256k1HdWallet } from '@cosmjs/launchpad'
import { downloadAndExtractZKeys } from './lib/downloadZkeys'
import { genKeypair } from './lib/keypair'

async function main() {
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

  const mnemonic = process.env.MNEMONIC
  const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'dora',
  })
  const [{ address }] = await wallet.getAccounts()
  console.log('\nVota address:')
  console.log(address)

  // ==========================================================================

  console.log('\nStart to download zkey:')

  await downloadAndExtractZKeys('2-1-1-5')
}

main()
