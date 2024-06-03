import Web3, { Transaction } from 'web3'

import { Chain } from './type'
import { ChainId, ProofType } from '../types'
import { Groth16Proof } from 'snarkjs'

const web3FromChainId = (chainId: ChainId) => {
  switch (chainId) {
    case ChainId.eth:
    default:
      return new Web3(
        'https://sepolia.infura.io/v3/1d0842dba8df4b07a2a02ab24c44e6be',
      )
  }
}

const web3WithAccount = (chainId: ChainId, priKey: string) => {
  const web3 = web3FromChainId(chainId)
  const account = web3.eth.accounts.privateKeyToAccount(priKey)
  web3.eth.accounts.wallet.add(account)
  web3.defaultAccount = account.address
  return web3
}

const sendTx = async (web3: Web3, tx: Transaction) => {
  return new Promise<string>((resolve) => {
    web3.eth.sendTransaction(tx).on('receipt', (receipt) => {
      if (!!receipt.status) {
        resolve(receipt.transactionHash)
      } else {
        resolve('')
      }
    })
  }).catch(() => '')
}

export class EvmChain implements Chain {
  async isReadyToSendTx(chainId: ChainId, priKey: string): Promise<boolean> {
    return true
  }

  async stopVotingPeriod(
    chainId: ChainId,
    priKey: string,
    contractAddr: string,
    maxVoteOptions: number,
  ): Promise<string> {
    const web3 = web3WithAccount(chainId, priKey)

    const data = web3.eth.abi.encodeFunctionCall(
      {
        inputs: [
          {
            internalType: 'uint256',
            name: '_maxVoteOptions',
            type: 'uint256',
          },
        ],
        name: 'stopVotingPeriod',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
      [maxVoteOptions],
    )

    const txHash = await sendTx(web3, {
      to: contractAddr,
      data,
    })

    return txHash
  }

  async proof(
    chainId: ChainId,
    priKey: string,
    contractAddr: string,
    proofType: ProofType,
    commitment: string,
    proof: Groth16Proof,
  ): Promise<string> {
    const web3 = web3WithAccount(chainId, priKey)

    const proofArray: string[] = []
    proofArray.push(...proof.pi_a.slice(0, 2))
    proofArray.push(...proof.pi_b[0].reverse())
    proofArray.push(...proof.pi_b[1].reverse())
    proofArray.push(...proof.pi_c.slice(0, 2))

    const data = web3.eth.abi.encodeFunctionCall(
      {
        inputs: [
          {
            internalType: 'uint256',
            name: 'newCommitment',
            type: 'uint256',
          },
          {
            internalType: 'uint256[8]',
            name: '_proof',
            type: 'uint256[8]',
          },
        ],
        name: proofType === 'msg' ? 'processMessage' : 'processTally',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
      [commitment, proofArray],
    )

    const txHash = await sendTx(web3, {
      to: contractAddr,
      data,
    })

    return txHash
  }

  async stopTallyingPeriod(
    chainId: ChainId,
    priKey: string,
    contractAddr: string,
    results: string[],
    salt: string,
  ): Promise<string> {
    const web3 = web3WithAccount(chainId, priKey)

    const data = web3.eth.abi.encodeFunctionCall(
      {
        inputs: [
          {
            internalType: 'uint256[]',
            name: '_results',
            type: 'uint256[]',
          },
          {
            internalType: 'uint256',
            name: '_salt',
            type: 'uint256',
          },
        ],
        name: 'stopTallyingPeriod',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
      [results, salt],
    )

    const txHash = await sendTx(web3, {
      to: contractAddr,
      data,
    })

    return txHash
  }
}
