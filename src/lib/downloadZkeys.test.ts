import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyArchiveChecksum } from './downloadZkeys'

let tmpDir = ''

describe('verifyArchiveChecksum', () => {
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  })

  it('rejects an untrusted v6 zkey archive', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amaci-zkey-checksum-test-'))
    const archivePath = path.join(tmpDir, 'amaci_9-4-3-125_v6_zkeys.tar.gz')
    fs.writeFileSync(archivePath, 'not the trusted v6 zkey archive')

    await expect(
      verifyArchiveChecksum('9-4-3-125_v6', archivePath),
    ).rejects.toThrow('SHA256 mismatch for 9-4-3-125_v6')
  })
})
