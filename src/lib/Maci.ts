import { eddsa, poseidon } from 'circomlib'
import { encryptOdevity, decrypt } from './rerandomize'
import { solidityPackedSha256 } from 'ethers'
import {
  stringizing,
  genStaticRandomKey,
  genKeypair,
  genEcdhSharedKey,
} from './keypair'
import { Tree } from './Tree'

import { poseidonDecrypt } from '../js/poseidonCipher.js'
import { IKeypair } from '../types'
import { log } from '../log'

interface ICmd {
  nonce: bigint
  stateIdx: bigint
  voIdx: bigint
  newVotes: bigint
  newPubKey: [bigint, bigint]
  signature: {
    R8: [bigint, bigint]
    S: bigint
  }
  msgHash: bigint
}

interface IMsg {
  ciphertext: bigint[]
  encPubKey: bigint[]
  prevHash: bigint
  hash: bigint
}

interface IState {
  pubKey: [bigint, bigint]
  balance: bigint
  voTree: Tree
  nonce: bigint
  voted: boolean
  d1: [bigint, bigint]
  d2: [bigint, bigint]
}

const SNARK_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n
const UINT96 = 2n ** 96n
const UINT32 = 2n ** 32n

export enum MACI_STATES {
  FILLING, // sign up & publish message
  PROCESSING, // batch process message
  TALLYING, // tally votes
  ENDED, // ended
}

const zeroHash5 = poseidon([0, 0, 0, 0, 0])
const zeroHash10 = poseidon([zeroHash5, zeroHash5])

export class MACI {
  public readonly stateTreeDepth: number
  public readonly intStateTreeDepth: number
  public readonly voteOptionTreeDepth: number
  public readonly batchSize: number

  public states: MACI_STATES

  protected maxVoteOptions: number
  protected voSize: number
  protected numSignUps: number

  protected isQuadraticCost: boolean

  protected coordinator: IKeypair
  protected pubKeyHasher: bigint

  protected voTreeZeroRoot: bigint

  protected stateTree: Tree
  protected activeStateTree: Tree
  protected deactivateTree: Tree

  protected deactivateSize: number

  protected dCommands: (ICmd | null)[]
  protected dMessages: IMsg[]
  protected _processedDMsgCount: number

  protected stateLeaves: Map<number, IState>

  protected commands: (ICmd | null)[]
  protected messages: IMsg[]

  protected msgEndIdx: number = 0
  protected stateSalt: bigint = 0n
  protected _stateCommitment: bigint = 0n

  protected batchNum: number = 0
  protected tallySalt: bigint = 0n
  protected _tallyCommitment: bigint = 0n
  protected tallyResults: Tree

  protected logs: any[]

  get stateCommitment() {
    return this._stateCommitment
  }

  get tallyCommitment() {
    return this._tallyCommitment
  }

  get tallyResultsLeaves() {
    return this.tallyResults.leaves()
  }

  get processedDMsgCount() {
    return this._processedDMsgCount
  }

  get activeStateTreeLeaves() {
    return this.activeStateTree.leaves()
  }

  constructor(
    stateTreeDepth: number,
    intStateTreeDepth: number,
    voteOptionTreeDepth: number,
    batchSize: number,
    coordPriKey: bigint,
    maxVoteOptions: number,
    numSignUps: number,
    isQuadraticCost: boolean,
  ) {
    this.stateTreeDepth = stateTreeDepth
    this.intStateTreeDepth = intStateTreeDepth
    this.voteOptionTreeDepth = voteOptionTreeDepth
    this.batchSize = batchSize
    this.maxVoteOptions = maxVoteOptions
    this.voSize = 5 ** voteOptionTreeDepth
    this.numSignUps = numSignUps
    this.isQuadraticCost = isQuadraticCost

    this.coordinator = genKeypair(coordPriKey)
    this.pubKeyHasher = poseidon(this.coordinator.pubKey)

    const emptyVOTree = new Tree(5, voteOptionTreeDepth, 0n)

    const stateTree = new Tree(5, stateTreeDepth, zeroHash10)

    log(
      [
        '',
        'init MACI '.padEnd(40, '='),
        '- vo tree root:\t\t' + emptyVOTree.root,
        '- state tree root:\t' + stateTree.root,
        '',
      ].join('\n'),
    )

    this.voTreeZeroRoot = emptyVOTree.root
    this.stateTree = stateTree

    this.activeStateTree = new Tree(5, stateTreeDepth, 0n)
    this.tallyResults = new Tree(5, voteOptionTreeDepth, 0n)
    this.deactivateTree = new Tree(5, stateTreeDepth, 0n)
    this.deactivateSize = 0
    this.dCommands = []
    this.dMessages = []
    this._processedDMsgCount = 0

    this.stateLeaves = new Map()
    this.commands = []
    this.messages = []
    this.states = MACI_STATES.FILLING
    this.logs = []
  }

  emptyMessage(): IMsg {
    return {
      ciphertext: [0n, 0n, 0n, 0n, 0n, 0n, 0n],
      encPubKey: [0n, 0n],
      prevHash: 0n,
      hash: 0n,
    }
  }

  emptyState(): IState {
    return {
      pubKey: [0n, 0n],
      balance: 0n,
      voTree: new Tree(5, this.voteOptionTreeDepth, 0n),
      nonce: 0n,
      voted: false,
      d1: [0n, 0n],
      d2: [0n, 0n],
    }
  }

  msgToCmd(ciphertext: bigint[], encPubKey: [bigint, bigint]): ICmd | null {
    const sharedKey = genEcdhSharedKey(this.coordinator.privKey, encPubKey)
    try {
      const plaintext = poseidonDecrypt(ciphertext, sharedKey, 0n, 6)
      const packaged = plaintext[0]

      const nonce = packaged % UINT32
      const stateIdx = (packaged >> 32n) % UINT32
      const voIdx = (packaged >> 64n) % UINT32
      const newVotes = (packaged >> 96n) % UINT96

      const cmd: ICmd = {
        nonce,
        stateIdx,
        voIdx,
        newVotes,
        newPubKey: [plaintext[1], plaintext[2]],
        signature: {
          R8: [plaintext[3], plaintext[4]],
          S: plaintext[5],
        },
        msgHash: poseidon(plaintext.slice(0, 3)),
      }
      return cmd
    } catch (e: any) {
      log('[dev] msg decrypt error', e.message)
      return null
    }
  }

  initStateTree(
    leafIdx: number,
    pubKey: [bigint, bigint],
    balance: bigint,
    c = [0n, 0n, 0n, 0n],
  ) {
    if (this.states !== MACI_STATES.FILLING)
      throw new Error('vote period ended')

    const s: IState = this.stateLeaves.get(leafIdx) || this.emptyState()
    s.pubKey = [...pubKey]
    s.balance = balance
    s.d1 = [c[0], c[1]]
    s.d2 = [c[2], c[3]]

    this.stateLeaves.set(leafIdx, s)

    const hash = poseidon([
      poseidon([...s.pubKey, s.balance, s.voted ? s.voTree.root : 0n, s.nonce]),
      c ? poseidon([...c.map((ci) => BigInt(ci)), 0n]) : zeroHash5,
    ])
    this.stateTree.updateLeaf(leafIdx, hash)

    log(
      [
        `set State { idx: ${leafIdx} } `.padEnd(40, '='),
        '- leaf hash:\t\t' + hash,
        '- new tree root:\t' + this.stateTree.root,
        '',
      ].join('\n'),
    )
    this.logs.push({
      type: 'setStateLeaf',
      data: stringizing([leafIdx, pubKey, balance]),
      input: stringizing([pubKey, balance])
        .map((input: any) => JSON.stringify(input))
        .join(','),
    })
  }

  pushDeactivateMessage(ciphertext: bigint[], encPubKey: [bigint, bigint]) {
    if (this.states !== MACI_STATES.FILLING)
      throw new Error('vote period ended')

    const msgIdx = this.dMessages.length
    const prevHash = msgIdx > 0 ? this.dMessages[msgIdx - 1].hash : 0n

    const hash = poseidon([
      poseidon(ciphertext.slice(0, 5)),
      poseidon([...ciphertext.slice(5), ...encPubKey, prevHash]),
    ])

    this.dMessages.push({
      ciphertext: [...ciphertext],
      encPubKey: [...encPubKey],
      prevHash,
      hash,
    })

    this.dCommands.push(this.msgToCmd(ciphertext, encPubKey))

    log(
      [
        `push Deactivate Message { idx: ${msgIdx} } `.padEnd(40, '='),
        '- old msg hash:\t' + prevHash,
        '- new msg hash:\t' + hash,
        '',
      ].join('\n'),
    )
  }

  pushMessage(ciphertext: bigint[], encPubKey: [bigint, bigint]) {
    if (this.states !== MACI_STATES.FILLING)
      throw new Error('vote period ended')

    const msgIdx = this.messages.length
    const prevHash = msgIdx > 0 ? this.messages[msgIdx - 1].hash : 0n

    const hash = poseidon([
      poseidon(ciphertext.slice(0, 5)),
      poseidon([...ciphertext.slice(5), ...encPubKey, prevHash]),
    ])

    this.messages.push({
      ciphertext: [...ciphertext],
      encPubKey: [...encPubKey],
      prevHash,
      hash,
    })

    this.commands.push(this.msgToCmd(ciphertext, encPubKey))

    log(
      [
        `push Message { idx: ${msgIdx} } `.padEnd(40, '='),
        '- old msg hash:\t' + prevHash,
        '- new msg hash:\t' + hash,
        '',
      ].join('\n'),
    )
    this.logs.push({
      type: 'publishMessage',
      data: stringizing(arguments),
      input: stringizing([[ciphertext], encPubKey])
        .map((input: any) => JSON.stringify(input))
        .join(','),
    })
  }

  initProcessedDeactivateLog(deactivates: bigint[][], activeState: bigint[]) {
    for (let i = 0; i < deactivates.length; i++) {
      const dLeaf = deactivates[i]
      this.deactivateTree.updateLeaf(i, poseidon(dLeaf))
    }

    this.activeStateTree.initLeaves(activeState)

    this._processedDMsgCount += deactivates.length
  }

  uploadDeactivateHistory(deactivates: bigint[][], subStateTreeLength: number) {
    for (let i = 0; i < deactivates.length; i++) {
      const dLeaf = deactivates[i]
      this.deactivateTree.updateLeaf(i, poseidon(dLeaf))

      const activeState = BigInt(this.processedDMsgCount + i + 1)

      const cmd = this.dCommands[i]

      const error = this.checkDeactivateCommand(cmd, subStateTreeLength)

      let stateIdx = 5 ** this.stateTreeDepth - 1
      if (!error && cmd) {
        stateIdx = Number(cmd.stateIdx)
      }

      if (!error) {
        // UPDATE STATE =======================================================
        this.activeStateTree.updateLeaf(stateIdx, activeState)
      }
    }

    this._processedDMsgCount += deactivates.length
  }

  processDeactivateMessage(inputSize: number, subStateTreeLength: number) {
    const batchSize = this.batchSize
    const batchStartIdx = this.processedDMsgCount
    const size = Math.min(inputSize, this.dMessages.length - batchStartIdx)
    const batchEndIdx = batchStartIdx + size

    log(
      `= Process d-message [${batchStartIdx}, ${batchEndIdx}) `.padEnd(40, '='),
    )

    const messages = this.dMessages.slice(batchStartIdx, batchEndIdx)
    const commands = this.dCommands.slice(batchStartIdx, batchEndIdx)

    while (messages.length < batchSize) {
      messages.push(this.emptyMessage())
      commands.push(null)
    }

    const subStateTree = this.stateTree.subTree(subStateTreeLength)
    const currentStateRoot = subStateTree.root
    const deactivateIndex0 = this.processedDMsgCount

    const currentActiveStateRoot = this.activeStateTree.root
    const currentDeactivateRoot = this.deactivateTree.root
    const currentDeactivateCommitment = poseidon([
      currentActiveStateRoot,
      currentDeactivateRoot,
    ])

    // PROCESS ================================================================
    const currentActiveState = new Array(batchSize)
    const newActiveState = new Array(batchSize)
    const currentStateLeaves = new Array(batchSize)
    const currentStateLeavesPathElements = new Array(batchSize)
    const activeStateLeavesPathElements = new Array(batchSize)
    const deactivateLeavesPathElements = new Array(batchSize)
    // const nonce = new Array(batchSize)

    for (let i = 0; i < batchSize; i++) {
      // nonce[i] = BigInt(this.processedDMsgCount + i)
      newActiveState[i] = BigInt(this.processedDMsgCount + i + 1)
    }

    const newDeactivate = []
    const c1 = []
    const c2 = []

    for (let i = 0; i < batchSize; i++) {
      const cmd = commands[i]
      const error = this.checkDeactivateCommand(cmd, subStateTreeLength)

      let stateIdx = 5 ** this.stateTreeDepth - 1
      if (error === 'signature error' && cmd) {
        stateIdx = Math.min(Number(cmd.stateIdx), stateIdx)
      } else if (!error && cmd) {
        stateIdx = Number(cmd.stateIdx)
      }

      const s = this.stateLeaves.get(stateIdx) || this.emptyState()
      currentStateLeaves[i] = [
        ...s.pubKey,
        s.balance,
        s.voted ? s.voTree.root : 0n,
        s.nonce,
        s.d1[0],
        s.d1[1],
        s.d2[0],
        s.d2[1],
        0,
      ]
      currentStateLeavesPathElements[i] = subStateTree.pathElementOf(stateIdx)
      activeStateLeavesPathElements[i] =
        this.activeStateTree.pathElementOf(stateIdx)
      deactivateLeavesPathElements[i] = this.deactivateTree.pathElementOf(
        deactivateIndex0 + i,
      )
      currentActiveState[i] = this.activeStateTree.leaf(stateIdx)

      const sharedKey = genEcdhSharedKey(this.coordinator.privKey, s.pubKey)

      const deactivate = encryptOdevity(
        !!error,
        this.coordinator.pubKey,
        genStaticRandomKey(this.coordinator.privKey, 20040n, newActiveState[i]),
      )
      const dLeaf = [
        deactivate.c1.x,
        deactivate.c1.y,
        deactivate.c2.x,
        deactivate.c2.y,
        poseidon(sharedKey),
      ]
      c1.push([deactivate.c1.x, deactivate.c1.y])
      c2.push([deactivate.c2.x, deactivate.c2.y])

      if (!error) {
        // UPDATE STATE =======================================================
        this.activeStateTree.updateLeaf(stateIdx, newActiveState[i])

        this.deactivateTree.updateLeaf(deactivateIndex0 + i, poseidon(dLeaf))
        newDeactivate.push(dLeaf)
      } else if (messages[i].ciphertext[0] !== 0n) {
        // INVALID MSG
        this.deactivateTree.updateLeaf(deactivateIndex0 + i, poseidon(dLeaf))
        newDeactivate.push(dLeaf)
      }

      log(`- dmessage <${i}> ${error || '√'}`)
    }

    const newDeactivateRoot = this.deactivateTree.root
    const newDeactivateCommitment = poseidon([
      this.activeStateTree.root,
      newDeactivateRoot,
    ])

    // GEN INPUT JSON =========================================================
    const batchStartHash = this.dMessages[batchStartIdx].prevHash
    const batchEndHash = this.dMessages[batchEndIdx - 1].hash

    const inputHash =
      BigInt(
        solidityPackedSha256(
          new Array(7).fill('uint256'),
          stringizing([
            newDeactivateRoot,
            this.pubKeyHasher,
            batchStartHash,
            batchEndHash,
            currentDeactivateCommitment,
            newDeactivateCommitment,
            subStateTree.root,
          ]),
        ),
      ) % SNARK_FIELD_SIZE

    const msgs = messages.map((msg) => msg.ciphertext)
    const encPubKeys = messages.map((msg) => msg.encPubKey)
    const input = {
      inputHash,
      currentActiveStateRoot,
      currentDeactivateRoot,
      batchStartHash,
      batchEndHash,
      msgs,
      coordPrivKey: this.coordinator.formatedPrivKey,
      coordPubKey: this.coordinator.pubKey,
      encPubKeys,
      // nonce,
      c1,
      c2,
      currentActiveState,
      newActiveState,
      deactivateIndex0,
      currentStateRoot,
      currentStateLeaves,
      currentStateLeavesPathElements,
      activeStateLeavesPathElements,
      deactivateLeavesPathElements,
      currentDeactivateCommitment,
      newDeactivateRoot,
      newDeactivateCommitment,
    }

    this._processedDMsgCount = batchEndIdx

    return { input, newDeactivate }
  }

  endVotePeriod() {
    if (this.states !== MACI_STATES.FILLING)
      throw new Error('vote period ended')
    this.states = MACI_STATES.PROCESSING

    this.msgEndIdx = this.messages.length
    this.stateSalt = 0n
    this._stateCommitment = poseidon([this.stateTree.root, 0n])

    log(['Vote End '.padEnd(60, '='), ''].join('\n'))

    if (this.messages.length === 0) {
      this.endProcessingPeriod()
      if (this.numSignUps === 0) {
        this.states = MACI_STATES.ENDED
      }
    }
  }

  checkCommandNow(cmd: ICmd | null) {
    if (!cmd) {
      return 'empty command'
    }
    if (cmd.stateIdx > BigInt(this.numSignUps)) {
      return 'state leaf index overflow'
    }
    if (cmd.voIdx >= BigInt(this.maxVoteOptions)) {
      return 'vote option index overflow'
    }
    const stateIdx = Number(cmd.stateIdx)
    const voIdx = Number(cmd.voIdx)
    const s = this.stateLeaves.get(stateIdx) || this.emptyState()

    const as = this.activeStateTree.leaf(stateIdx) || 0n
    if (as !== 0n) {
      return 'inactive'
    }

    const deactivate = decrypt(this.coordinator.formatedPrivKey, {
      c1: { x: s.d1[0], y: s.d1[1] },
      c2: { x: s.d2[0], y: s.d2[1] },
      xIncrement: 0n,
    })
    if (deactivate % 2n === 1n) {
      return 'deactivated'
    }

    if (s.nonce + 1n !== cmd.nonce) {
      return 'nonce error'
    }
    const verified = eddsa.verifyPoseidon(cmd.msgHash, cmd.signature, s.pubKey)
    if (!verified) {
      return 'signature error'
    }
    const currVotes = s.voTree.leaf(voIdx)
    if (this.isQuadraticCost) {
      if (s.balance + currVotes * currVotes < cmd.newVotes * cmd.newVotes) {
        return 'insufficient balance'
      }
    } else {
      if (s.balance + currVotes < cmd.newVotes) {
        return 'insufficient balance'
      }
    }
  }

  checkDeactivateCommand(cmd: ICmd | null, subStateTreeLength: number) {
    if (!cmd) {
      return 'empty command'
    }
    if (cmd.stateIdx >= BigInt(subStateTreeLength)) {
      return 'state leaf index overflow'
    }
    const stateIdx = Number(cmd.stateIdx)
    const s = this.stateLeaves.get(stateIdx) || this.emptyState()

    const deactivate = decrypt(this.coordinator.formatedPrivKey, {
      c1: { x: s.d1[0], y: s.d1[1] },
      c2: { x: s.d2[0], y: s.d2[1] },
      xIncrement: 0n,
    })
    if (deactivate % 2n === 1n) {
      return 'deactivated'
    }

    const verified = eddsa.verifyPoseidon(cmd.msgHash, cmd.signature, s.pubKey)
    if (!verified) {
      return 'signature error'
    }
  }

  processMessage(newStateSalt = 0n) {
    if (this.states !== MACI_STATES.PROCESSING) throw new Error('period error')

    const batchSize = this.batchSize
    const batchStartIdx =
      Math.floor((this.msgEndIdx - 1) / batchSize) * batchSize
    const batchEndIdx = Math.min(batchStartIdx + batchSize, this.msgEndIdx)

    log(`= Process message [${batchStartIdx}, ${batchEndIdx}) `.padEnd(40, '='))

    const messages = this.messages.slice(batchStartIdx, batchEndIdx)
    const commands = this.commands.slice(batchStartIdx, batchEndIdx)

    while (messages.length < batchSize) {
      messages.push(this.emptyMessage())
      commands.push(null)
    }

    const currentStateRoot = this.stateTree.root

    // PROCESS ================================================================
    const currentStateLeaves = new Array(batchSize)
    const currentStateLeavesPathElements = new Array(batchSize)
    const currentVoteWeights = new Array(batchSize)
    const currentVoteWeightsPathElements = new Array(batchSize)

    const activeStateLeaves = new Array(batchSize)
    const activeStateLeavesPathElements = new Array(batchSize)

    for (let i = batchSize - 1; i >= 0; i--) {
      const cmd = commands[i]
      const error = this.checkCommandNow(cmd)

      let stateIdx = 0
      let voIdx = 0
      if (!error && cmd) {
        stateIdx = Number(cmd.stateIdx)
        voIdx = Number(cmd.voIdx)
      }

      const s = this.stateLeaves.get(stateIdx) || this.emptyState()
      const currVotes = s.voTree.leaf(voIdx)
      currentStateLeaves[i] = [
        ...s.pubKey,
        s.balance,
        s.voted ? s.voTree.root : 0n,
        s.nonce,
        ...s.d1,
        ...s.d2,
        0n,
      ]
      currentStateLeavesPathElements[i] = this.stateTree.pathElementOf(stateIdx)
      currentVoteWeights[i] = currVotes
      currentVoteWeightsPathElements[i] = s.voTree.pathElementOf(voIdx)

      activeStateLeaves[i] = this.activeStateTree.leaf(stateIdx)
      activeStateLeavesPathElements[i] =
        this.activeStateTree.pathElementOf(stateIdx)

      if (!error && cmd) {
        // UPDATE STATE =======================================================
        s.pubKey = [...cmd.newPubKey]
        if (this.isQuadraticCost) {
          s.balance =
            s.balance + currVotes * currVotes - cmd.newVotes * cmd.newVotes
        } else {
          s.balance = s.balance + currVotes - cmd.newVotes
        }
        s.voTree.updateLeaf(voIdx, cmd.newVotes)
        s.nonce = cmd.nonce
        s.voted = true

        this.stateLeaves.set(stateIdx, s)

        const hash = poseidon([
          poseidon([...s.pubKey, s.balance, s.voTree.root, s.nonce]),
          poseidon([...s.d1, ...s.d2, 0n]),
        ])
        this.stateTree.updateLeaf(stateIdx, hash)
      }

      log(`- message <${i}> ${error || '√'}`)
    }

    const newStateRoot = this.stateTree.root
    const newStateCommitment = poseidon([newStateRoot, newStateSalt])

    // GEN INPUT JSON =========================================================
    const packedVals =
      BigInt(this.maxVoteOptions) +
      (BigInt(this.numSignUps) << 32n) +
      (this.isQuadraticCost ? 1n << 64n : 0n)
    const batchStartHash = this.messages[batchStartIdx].prevHash
    const batchEndHash = this.messages[batchEndIdx - 1].hash

    const activeStateRoot = this.activeStateTree.root
    const deactivateRoot = this.deactivateTree.root
    const deactivateCommitment = poseidon([activeStateRoot, deactivateRoot])

    const inputHash =
      BigInt(
        solidityPackedSha256(
          new Array(7).fill('uint256'),
          stringizing([
            packedVals,
            this.pubKeyHasher,
            batchStartHash,
            batchEndHash,
            this.stateCommitment,
            newStateCommitment,
            deactivateCommitment,
          ]),
        ),
      ) % SNARK_FIELD_SIZE

    const msgs = messages.map((msg) => msg.ciphertext)
    const encPubKeys = messages.map((msg) => msg.encPubKey)
    const input = {
      inputHash,
      packedVals,
      batchStartHash,
      batchEndHash,
      msgs,
      coordPrivKey: this.coordinator.formatedPrivKey,
      coordPubKey: this.coordinator.pubKey,
      encPubKeys,
      currentStateRoot,
      currentStateLeaves,
      currentStateLeavesPathElements,
      currentStateCommitment: this.stateCommitment,
      currentStateSalt: this.stateSalt,
      newStateCommitment,
      newStateSalt,
      currentVoteWeights,
      currentVoteWeightsPathElements,

      activeStateRoot,
      deactivateRoot,
      deactivateCommitment,
      activeStateLeaves,
      activeStateLeavesPathElements,
    }

    this.msgEndIdx = batchStartIdx
    this._stateCommitment = newStateCommitment
    this.stateSalt = newStateSalt

    log(['', '* new state root:\n\n' + newStateRoot, ''].join('\n'))

    if (batchStartIdx === 0) {
      this.endProcessingPeriod()
    }

    return input
  }

  endProcessingPeriod() {
    if (this.states !== MACI_STATES.PROCESSING)
      throw new Error('vote period ended')
    this.states = MACI_STATES.TALLYING

    this.batchNum = 0
    // resultsRootSalt, perVOVotesRootSalt, perVOSpentVoiceCreditsRootSalt
    this.tallySalt = 0n
    this._tallyCommitment = 0n

    log(['Process Finished '.padEnd(60, '='), ''].join('\n'))
  }

  processTally(tallySalt = 0n) {
    if (this.states !== MACI_STATES.TALLYING) throw new Error('period error')

    const batchSize = 5 ** this.intStateTreeDepth
    const batchStartIdx = this.batchNum * batchSize
    const batchEndIdx = batchStartIdx + batchSize

    log(`= Process tally [${batchStartIdx}, ${batchEndIdx}) `.padEnd(40, '='))

    const statePathElements = this.stateTree
      .pathElementOf(batchStartIdx)
      .slice(this.intStateTreeDepth)

    // PROCESS ================================================================

    const currentResults = this.tallyResults!.leaves()

    const stateLeaf = new Array(batchSize)
    const votes = new Array(batchSize)

    const MAX_VOTES = 10n ** 24n

    for (let i = 0; i < batchSize; i++) {
      const stateIdx = batchStartIdx + i

      const s = this.stateLeaves.get(stateIdx) || this.emptyState()

      stateLeaf[i] = [
        ...s.pubKey,
        s.balance,
        s.voted ? s.voTree.root : 0n,
        s.nonce,
        ...s.d1,
        ...s.d2,
        0n,
      ]
      votes[i] = s.voTree.leaves()

      if (!s.voted) continue

      for (let j = 0; j < this.voSize; j++) {
        const v = s.voTree.leaf(j)

        this.tallyResults.updateLeaf(
          j,
          this.tallyResults.leaf(j) + v * (v + MAX_VOTES),
        )
      }
    }

    const newTallyCommitment = poseidon([this.tallyResults.root, tallySalt])

    // GEN INPUT JSON =========================================================
    const packedVals = BigInt(this.batchNum) + (BigInt(this.numSignUps) << 32n)

    const inputHash =
      BigInt(
        solidityPackedSha256(
          new Array(4).fill('uint256'),
          stringizing([
            packedVals,
            this.stateCommitment,
            this.tallyCommitment,
            newTallyCommitment,
          ]),
        ),
      ) % SNARK_FIELD_SIZE

    const input = {
      stateRoot: this.stateTree.root,
      stateSalt: this.stateSalt,
      packedVals,
      stateCommitment: this.stateCommitment,
      currentTallyCommitment: this.tallyCommitment,
      newTallyCommitment,
      inputHash,
      stateLeaf,
      statePathElements,
      votes,
      currentResults,
      currentResultsRootSalt: this.tallySalt,
      newResultsRootSalt: tallySalt,
      // currentPerVOVotes,
      // currentPerVOVotesRootSalt: this.tallySalts[1],
      // newPerVOVotesRootSalt: tallySalts[1],
      // currentPerVOSpentVoiceCredits,
      // currentPerVOSpentVoiceCreditsRootSalt: this.tallySalts[2],
      // newPerVOSpentVoiceCreditsRootSalt: tallySalts[2],
    }

    this.batchNum++
    this._tallyCommitment = newTallyCommitment
    this.tallySalt = tallySalt

    log(['', '* new tally commitment:\n\n' + newTallyCommitment, ''].join('\n'))

    if (batchEndIdx >= this.numSignUps) {
      this.states = MACI_STATES.ENDED
      log(['Tally Finished '.padEnd(60, '='), ''].join('\n'))
    }

    return input
  }
}

export type MsgInput = ReturnType<typeof MACI.prototype.processMessage>

export type TallyInput = ReturnType<typeof MACI.prototype.processTally>

export type DMsgInput = ReturnType<
  typeof MACI.prototype.processDeactivateMessage
>['input']
