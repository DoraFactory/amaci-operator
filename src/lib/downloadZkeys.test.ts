import fs from 'fs'
import { EventEmitter } from 'events'
import type { IncomingMessage } from 'http'
import * as https from 'https'
import os from 'os'
import path from 'path'
import { PassThrough } from 'stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDownloadProgressReporter,
  downloadZKeys,
  formatDownloadProgress,
  parseContentRange,
  verifyArchiveChecksum,
} from './downloadZkeys'

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

describe('download progress', () => {
  it('formats percentage, size, speed, and ETA', () => {
    const gib = 1024 ** 3
    const progress = formatDownloadProgress(4 * gib, 8 * gib, 2_000)

    expect(progress).toContain('50.0%')
    expect(progress).toContain('4.0 GiB / 8.0 GiB')
    expect(progress).toContain('2.0 GiB/s')
    expect(progress).toContain('ETA 2s')
  })

  it('emits periodic progress lines when stdout is not a TTY', () => {
    let now = 0
    const logs: string[] = []
    const progress = createDownloadProgressReporter('bundle.tar.gz', 100, {
      isTTY: false,
      log: (message) => logs.push(message),
      now: () => now,
      logIntervalMs: 10_000,
      percentStep: 25,
    })

    progress.update(10)
    progress.update(25)
    now = 10_000
    progress.update(30)
    progress.complete(100)

    expect(logs).toHaveLength(4)
    expect(logs[0]).toContain('0.0%')
    expect(logs[1]).toContain('25.0%')
    expect(logs[2]).toContain('30.0%')
    expect(logs[3]).toContain('Downloaded bundle.tar.gz')
    expect(logs[3]).toContain('100.0%')
  })

  it('starts resumed progress from the existing byte count', () => {
    const logs: string[] = []
    const progress = createDownloadProgressReporter('bundle.tar.gz', 100, {
      isTTY: false,
      initialBytes: 50,
      log: (message) => logs.push(message),
    })

    progress.complete(100)

    expect(logs[0]).toContain('Resuming bundle.tar.gz')
    expect(logs[0]).toContain('50.0%')
    expect(logs[1]).toContain('100.0%')
  })
})

describe('resumable downloads', () => {
  it('parses satisfied and unsatisfied content ranges', () => {
    expect(parseContentRange('bytes 100-199/1000')).toEqual({
      start: 100,
      end: 199,
      total: 1000,
    })
    expect(parseContentRange('bytes */1000')).toEqual({ total: 1000 })
    expect(parseContentRange('invalid')).toBeUndefined()
  })

  it('requests the remaining range and appends it to a partial archive', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amaci-zkey-resume-test-'))
    const archivePath = path.join(tmpDir, 'bundle.tar.gz.part')
    fs.writeFileSync(archivePath, 'hello ')

    const requestGet = ((
      _url: string | URL,
      options: https.RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      expect(options.headers).toEqual({ Range: 'bytes=6-' })

      const response = new PassThrough() as PassThrough & IncomingMessage
      response.statusCode = 206
      response.headers = {
        'content-length': '5',
        'content-range': 'bytes 6-10/11',
      }
      response.complete = true

      queueMicrotask(() => {
        callback(response)
        response.end('world')
      })

      return new EventEmitter() as unknown as ReturnType<typeof https.get>
    }) as typeof https.get

    await downloadZKeys(archivePath, 'bundle.tar.gz', 11, requestGet)

    expect(fs.readFileSync(archivePath, 'utf8')).toBe('hello world')
  })

  it('restarts safely when the server ignores the range request', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amaci-zkey-restart-test-'))
    const archivePath = path.join(tmpDir, 'bundle.tar.gz.part')
    fs.writeFileSync(archivePath, 'old')

    const requestGet = ((
      _url: string | URL,
      options: https.RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      expect(options.headers).toEqual({ Range: 'bytes=3-' })

      const response = new PassThrough() as PassThrough & IncomingMessage
      response.statusCode = 200
      response.headers = { 'content-length': '4' }
      response.complete = true

      queueMicrotask(() => {
        callback(response)
        response.end('new!')
      })

      return new EventEmitter() as unknown as ReturnType<typeof https.get>
    }) as typeof https.get

    await downloadZKeys(archivePath, 'bundle.tar.gz', 4, requestGet)

    expect(fs.readFileSync(archivePath, 'utf8')).toBe('new!')
  })

  it('keeps the partial archive after an interrupted response', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amaci-zkey-interrupt-test-'))
    const archivePath = path.join(tmpDir, 'bundle.tar.gz.part')
    fs.writeFileSync(archivePath, 'hello ')

    const requestGet = ((
      _url: string | URL,
      _options: https.RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      const response = new PassThrough() as PassThrough & IncomingMessage
      response.statusCode = 206
      response.headers = {
        'content-length': '5',
        'content-range': 'bytes 6-10/11',
      }
      response.complete = false

      queueMicrotask(() => {
        callback(response)
        response.write('wo')
        response.emit('aborted')
      })

      return new EventEmitter() as unknown as ReturnType<typeof https.get>
    }) as typeof https.get

    await expect(
      downloadZKeys(archivePath, 'bundle.tar.gz', 11, requestGet),
    ).rejects.toThrow('Download aborted')

    expect(fs.existsSync(archivePath)).toBe(true)
    expect(fs.statSync(archivePath).size).toBeGreaterThanOrEqual(6)
  })
})
