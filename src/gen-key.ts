import { genKeypair } from './lib/keypair'

const coordinator = genKeypair()

console.log({
  privKey: String(coordinator.privKey),
  pubKey: {
    x: String(coordinator.pubKey[0]),
    y: String(coordinator.pubKey[1]),
  },
})
