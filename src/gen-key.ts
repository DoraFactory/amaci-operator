import { utils } from 'ffjavascript'
import { genKeypair } from './lib/keypair'

const coordinator = genKeypair()

console.log(utils.stringifyBigInts(coordinator))
