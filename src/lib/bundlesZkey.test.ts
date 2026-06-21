import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isBundleComplete,
  listMissingBundleFiles,
  resolveBundleProofFiles,
} from './bundlesZkey'

const bundle = '9-4-3-125_v5'
let tmpDir = ''

function writeBundleFile(file: string) {
  const target = path.join(tmpDir, bundle, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, 'test')
}

describe('bundlesZkey', () => {
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  })

  it('accepts process.* as the message circuit alias for v5 bundles', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amaci-zkey-test-'))
    for (const file of [
      'process.wasm',
      'process.zkey',
      'tally.wasm',
      'tally.zkey',
      'deactivate.wasm',
      'deactivate.zkey',
    ]) {
      writeBundleFile(file)
    }

    expect(isBundleComplete(tmpDir, bundle)).toBe(true)
    expect(resolveBundleProofFiles(tmpDir, bundle, 'msg')).toEqual({
      witnessPath: path.join(tmpDir, bundle, 'process.wasm'),
      zkeyPath: path.join(tmpDir, bundle, 'process.zkey'),
    })
  })

  it('reports msg/process alternatives when the message circuit is missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amaci-zkey-test-'))
    for (const file of [
      'tally.wasm',
      'tally.zkey',
      'deactivate.wasm',
      'deactivate.zkey',
    ]) {
      writeBundleFile(file)
    }

    expect(listMissingBundleFiles(tmpDir, bundle)).toEqual([
      path.join(bundle, 'msg.zkey or process.zkey'),
      path.join(bundle, 'msg.wasm or process.wasm'),
    ])
  })
})
