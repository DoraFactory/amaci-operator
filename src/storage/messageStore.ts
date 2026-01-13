import fs from 'fs'
import path from 'path'
import { poseidon } from 'circomlib'

export interface StoredMessage {
  ciphertext: bigint[]
  encPubKey: [bigint, bigint]
  prevHash: bigint
  hash: bigint
}

export interface MessageStoreReader {
  appendMessage(ciphertext: bigint[], encPubKey: [bigint, bigint]): StoredMessage
  getBatch(startIdx: number): StoredMessage[]
  getMessageCount(): number
}

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))

const parse = (text: string) =>
  JSON.parse(text, (_, v) =>
    typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : v,
  )

export class DiskMessageStore implements MessageStoreReader {
  private readonly baseDir: string
  private readonly batchSize: number
  private batchStartIdx = 0
  private batch: StoredMessage[] = []
  private messageCount = 0
  private lastHash = 0n

  constructor(baseDir: string, batchSize: number) {
    this.baseDir = baseDir
    this.batchSize = Math.max(1, batchSize)
    fs.mkdirSync(this.baseDir, { recursive: true })
  }

  reset() {
    fs.rmSync(this.baseDir, { recursive: true, force: true })
    fs.mkdirSync(this.baseDir, { recursive: true })
    this.batchStartIdx = 0
    this.batch = []
    this.messageCount = 0
    this.lastHash = 0n
  }

  appendMessage(ciphertext: bigint[], encPubKey: [bigint, bigint]) {
    const prevHash = this.messageCount > 0 ? this.lastHash : 0n
    const hash = poseidon([
      poseidon(ciphertext.slice(0, 5)),
      poseidon([...ciphertext.slice(5), ...encPubKey, prevHash]),
    ])
    const msg: StoredMessage = {
      ciphertext: [...ciphertext],
      encPubKey: [...encPubKey],
      prevHash,
      hash,
    }

    this.batch.push(msg)
    this.messageCount += 1
    this.lastHash = hash

    if (this.batch.length >= this.batchSize) {
      this.flushBatch()
    }

    return msg
  }

  finalize() {
    if (this.batch.length > 0) {
      this.flushBatch()
    }
  }

  getBatch(startIdx: number) {
    const alignedStart =
      Math.floor(startIdx / this.batchSize) * this.batchSize
    const filePath = this.batchPath(alignedStart)
    if (!fs.existsSync(filePath)) {
      return []
    }
    const raw = fs.readFileSync(filePath, 'utf8')
    return parse(raw) as StoredMessage[]
  }

  getMessageCount() {
    return this.messageCount
  }

  private batchPath(startIdx: number) {
    return path.join(this.baseDir, `messages_${startIdx}.json`)
  }

  private flushBatch() {
    const filePath = this.batchPath(this.batchStartIdx)
    fs.writeFileSync(filePath, stringify(this.batch))
    this.batchStartIdx += this.batch.length
    this.batch = []
  }
}
