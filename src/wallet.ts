import { Secp256k1HdWallet, Secp256k1Wallet } from '@cosmjs/launchpad'

export const getWallet = async () => {
  const mnemonic = process.env.MNEMONIC
  const privKey = process.env.PRIVATE

  if (mnemonic) {
    return Secp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: 'dora',
    })
  } else {
    return Secp256k1Wallet.fromKey(Buffer.from(privKey, 'hex'), 'dora')
  }
}
