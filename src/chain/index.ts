import { Chain } from './type'
import { ChainId } from '../types'
import { EvmChain } from './EvmChain'

const evm = new EvmChain()

export const getChain = (chainId: ChainId): Chain => {
  // TODO: cosmos
  return evm
}
