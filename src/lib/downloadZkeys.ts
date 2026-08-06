import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { createHash } from 'node:crypto'
import * as tar from 'tar'
import ProgressBar from 'progress'
import { MaciType } from '../types'
import { getRequiredBundleFiles, isBundleDirectoryComplete } from './bundlesZkey'

const ZKEY_ARCHIVE_SHA256: Partial<Record<MaciType, string>> = {
  '9-4-3-125_v5':
    '792352fddaaaab9ac16befe8dbabff1757598b55640f0476be1d2f8b935f9904',
  '9-4-3-125_v6':
    '0a0a983ca9cd15aaae1272b7e5f43392b93011856407d614b096398e4c833936',
}

const ZKEY_ARCHIVE_SIZE: Partial<Record<MaciType, number>> = {
  '9-4-3-125_v6': 8_490_961_031,
}

const DOWNLOAD_PROGRESS_LOG_INTERVAL_MS = 30_000
const DOWNLOAD_PROGRESS_PERCENT_STEP = 5
const DOWNLOAD_PROGRESS_BAR_WIDTH = 20

const activeBundleDownloads = new Map<string, Promise<void>>()

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** unitIndex
  const precision = unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--'

  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainingSeconds = rounded % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return `${remainingSeconds}s`
}

export function formatDownloadProgress(
  downloadedBytes: number,
  totalBytes: number,
  elapsedMs: number,
  initialBytes: number = 0,
): string {
  const downloaded = Math.max(0, downloadedBytes)
  const elapsedSeconds = Math.max(0, elapsedMs) / 1000
  const transferredBytes = Math.max(0, downloaded - initialBytes)
  const bytesPerSecond = elapsedSeconds > 0
    ? transferredBytes / elapsedSeconds
    : 0
  const speed = bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '--'

  if (totalBytes <= 0) {
    return `${formatBytes(downloaded)} downloaded | ${speed}`
  }

  const ratio = Math.min(1, downloaded / totalBytes)
  const completedWidth = Math.floor(ratio * DOWNLOAD_PROGRESS_BAR_WIDTH)
  const bar = `${'='.repeat(completedWidth)}${' '.repeat(
    DOWNLOAD_PROGRESS_BAR_WIDTH - completedWidth,
  )}`
  const eta = bytesPerSecond > 0
    ? formatDuration((totalBytes - downloaded) / bytesPerSecond)
    : '--'

  return `[${bar}] ${(ratio * 100).toFixed(1)}% ${formatBytes(downloaded)} / ${formatBytes(totalBytes)} | ${speed} | ETA ${eta}`
}

type DownloadProgressReporterOptions = {
  isTTY?: boolean
  log?: (message: string) => void
  now?: () => number
  stream?: NodeJS.WritableStream
  logIntervalMs?: number
  percentStep?: number
  initialBytes?: number
}

export function createDownloadProgressReporter(
  fileName: string,
  totalBytes: number,
  options: DownloadProgressReporterOptions = {},
) {
  const isTTY = options.isTTY ?? Boolean(process.stderr.isTTY)
  const log = options.log ?? console.log
  const now = options.now ?? Date.now
  const stream = options.stream ?? process.stderr
  const logIntervalMs = options.logIntervalMs ?? DOWNLOAD_PROGRESS_LOG_INTERVAL_MS
  const percentStep = Math.max(
    1,
    options.percentStep ?? DOWNLOAD_PROGRESS_PERCENT_STEP,
  )
  const initialBytes = Math.max(
    0,
    Math.min(options.initialBytes ?? 0, totalBytes > 0 ? totalBytes : Infinity),
  )
  const startedAt = now()
  let downloadedBytes = initialBytes
  let lastLogAt = startedAt
  const initialPercent = totalBytes > 0 ? (initialBytes / totalBytes) * 100 : 0
  let nextPercent = (Math.floor(initialPercent / percentStep) + 1) * percentStep

  const progressBar = isTTY && totalBytes > 0
    ? new ProgressBar(
      'Downloading [:bar] :percent | :downloaded / :totalSize | :speed | ETA :eta s',
      {
        complete: '=',
        incomplete: ' ',
        width: DOWNLOAD_PROGRESS_BAR_WIDTH,
        total: totalBytes,
        curr: initialBytes,
        stream,
      },
    )
    : undefined

  const tokens = () => {
    const elapsedMs = Math.max(0, now() - startedAt)
    const transferredBytes = Math.max(0, downloadedBytes - initialBytes)
    const bytesPerSecond = elapsedMs > 0
      ? transferredBytes / (elapsedMs / 1000)
      : 0
    return {
      downloaded: formatBytes(downloadedBytes),
      totalSize: formatBytes(totalBytes),
      speed: bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '--',
    }
  }

  if (!progressBar) {
    const action = initialBytes > 0 ? 'Resuming' : 'Downloading'
    log(
      `${action} ${fileName}: ${formatDownloadProgress(
        initialBytes,
        totalBytes,
        0,
        initialBytes,
      )}`,
    )
  }

  const update = (downloaded: number) => {
    downloadedBytes = Math.max(downloadedBytes, downloaded)

    if (progressBar) {
      const increment = downloadedBytes - progressBar.curr
      if (increment > 0) progressBar.tick(increment, tokens())
      return
    }

    // The completion path emits the final 100% line with a distinct label.
    if (totalBytes > 0 && downloadedBytes >= totalBytes) return

    const currentTime = now()
    const percent = totalBytes > 0
      ? (downloadedBytes / totalBytes) * 100
      : 0
    const reachedPercentStep = totalBytes > 0 && percent >= nextPercent
    const reachedTimeInterval = currentTime - lastLogAt >= logIntervalMs
    if (!reachedPercentStep && !reachedTimeInterval) return

    while (percent >= nextPercent) nextPercent += percentStep
    lastLogAt = currentTime
    log(
      `Downloading ${fileName}: ${formatDownloadProgress(
        downloadedBytes,
        totalBytes,
        currentTime - startedAt,
        initialBytes,
      )}`,
    )
  }

  const complete = (downloaded: number) => {
    downloadedBytes = Math.max(downloadedBytes, downloaded)
    if (progressBar) {
      update(downloadedBytes)
      if (!progressBar.complete) progressBar.terminate()
      return
    }

    log(
      `Downloaded ${fileName}: ${formatDownloadProgress(
        downloadedBytes,
        totalBytes,
        now() - startedAt,
        initialBytes,
      )}`,
    )
  }

  const stop = () => {
    if (progressBar && !progressBar.complete) progressBar.terminate()
  }

  return { update, complete, stop }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function verifyArchiveChecksum(
  circuitPower: MaciType,
  archivePath: string,
) {
  const expected = ZKEY_ARCHIVE_SHA256[circuitPower]
  if (!expected) return

  const actual = await sha256File(archivePath)
  if (actual !== expected) {
    throw new Error(
      `SHA256 mismatch for ${circuitPower}: expected ${expected}, got ${actual}`,
    )
  }
}

function verifyArchiveSize(circuitPower: MaciType, archivePath: string) {
  const expected = ZKEY_ARCHIVE_SIZE[circuitPower]
  if (!expected) return

  const actual = fs.statSync(archivePath).size
  if (actual !== expected) {
    throw new Error(
      `Archive size mismatch for ${circuitPower}: expected ${expected}, got ${actual}`,
    )
  }
}

function bundleAliases(circuitPower: MaciType): string[] {
  const powerOnly = circuitPower.replace(/_v\d+$/, '')
  return [
    circuitPower,
    powerOnly,
    `amaci_${circuitPower}_zkeys`,
    `amaci_${powerOnly}_zkeys`,
    `maci_${circuitPower}_zkeys`,
    `maci_${powerOnly}_zkeys`,
  ]
}

function walkDirectories(root: string): string[] {
  const dirs = [root]
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    dirs.push(...walkDirectories(path.join(root, entry.name)))
  }
  return dirs
}

function locateBundleDirectory(extractRoot: string, circuitPower: MaciType): string {
  const aliases = new Set(bundleAliases(circuitPower))
  const candidates = walkDirectories(extractRoot).filter((dir) =>
    isBundleDirectoryComplete(dir),
  )

  if (candidates.length === 0) {
    throw new Error(
      `Extracted archive for ${circuitPower} does not contain a valid bundle directory. Expected files: ${getRequiredBundleFiles(circuitPower).join(', ')}`,
    )
  }

  const exact = candidates.find((dir) => path.basename(dir) === circuitPower)
  if (exact) return exact

  const alias = candidates.find((dir) => aliases.has(path.basename(dir)))
  if (alias) return alias

  if (candidates.length === 1) return candidates[0]

  throw new Error(
    `Extracted archive for ${circuitPower} contains multiple candidate bundle directories: ${candidates.join(', ')}`,
  )
}

function copyDirectoryContents(sourceDir: string, targetDir: string) {
  ensureDir(targetDir)
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name)
    const target = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      fs.cpSync(source, target, { recursive: true })
      continue
    }
    fs.copyFileSync(source, target)
  }
}

function replaceBundleDirectory(stagedBundleDir: string, targetBundleDir: string) {
  const backupDir = `${targetBundleDir}.bak`
  let movedExisting = false
  try {
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true })
    if (fs.existsSync(targetBundleDir)) {
      fs.renameSync(targetBundleDir, backupDir)
      movedExisting = true
    }
    fs.renameSync(stagedBundleDir, targetBundleDir)
    if (movedExisting && fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true })
    }
  } catch (error) {
    if (!fs.existsSync(targetBundleDir) && movedExisting && fs.existsSync(backupDir)) {
      try {
        fs.renameSync(backupDir, targetBundleDir)
      } catch {}
    }
    throw error
  }
}

// Download and normalize a zkey bundle into targetZkeyRoot/<bundle>.
// The tarball filename remains fixed, but the extracted top-level directory may vary.
export async function downloadAndExtractZKeys(
  circuitPower: MaciType,
  targetZkeyRoot: string = '.',
  opts: { force?: boolean } = {},
) {
  const fileName = `amaci_${circuitPower}_zkeys.tar.gz`
  const bundleRoot = path.join(targetZkeyRoot, circuitPower)
  const shouldReplace = opts.force || !isBundleDirectoryComplete(bundleRoot)

  if (!shouldReplace) return

  ensureDir(targetZkeyRoot)
  const downloadRoot = path.join(targetZkeyRoot, '.amaci-zkey-downloads')
  ensureDir(downloadRoot)
  const workspace = fs.mkdtempSync(path.join(targetZkeyRoot, '.amaci-zkey-'))
  const archivePath = path.join(downloadRoot, `${fileName}.part`)
  const extractRoot = path.join(workspace, 'extract')
  const stagedBundleDir = path.join(workspace, 'stage', circuitPower)

  ensureDir(extractRoot)
  ensureDir(path.dirname(stagedBundleDir))

  try {
    await downloadZKeysWithRetry(
      archivePath,
      fileName,
      3,
      ZKEY_ARCHIVE_SIZE[circuitPower],
    )
    try {
      verifyArchiveSize(circuitPower, archivePath)
      await verifyArchiveChecksum(circuitPower, archivePath)
    } catch (error) {
      fs.rmSync(archivePath, { force: true })
      throw error
    }
    await extractZKeys(archivePath, extractRoot)

    const sourceBundleDir = locateBundleDirectory(extractRoot, circuitPower)
    copyDirectoryContents(sourceBundleDir, stagedBundleDir)

    if (!isBundleDirectoryComplete(stagedBundleDir)) {
      throw new Error(
        `Normalized bundle for ${circuitPower} is incomplete after extraction`,
      )
    }

    replaceBundleDirectory(stagedBundleDir, bundleRoot)
    fs.rmSync(archivePath, { force: true })
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
}

export async function ensureZkeyBundle(
  circuitPower: MaciType,
  targetZkeyRoot: string,
) {
  const bundleRoot = path.join(targetZkeyRoot, circuitPower)
  if (isBundleDirectoryComplete(bundleRoot)) return

  const downloadKey = path.resolve(bundleRoot)
  const activeDownload = activeBundleDownloads.get(downloadKey)
  if (activeDownload) {
    await activeDownload
    return
  }

  const download = downloadAndExtractZKeys(circuitPower, targetZkeyRoot, {
    force: fs.existsSync(bundleRoot),
  }).then(() => {
    if (!isBundleDirectoryComplete(bundleRoot)) {
      throw new Error(`Downloaded zkey bundle is incomplete: ${circuitPower}`)
    }
  })
  activeBundleDownloads.set(downloadKey, download)

  try {
    await download
  } finally {
    if (activeBundleDownloads.get(downloadKey) === download) {
      activeBundleDownloads.delete(downloadKey)
    }
  }
}

type ParsedContentRange = {
  start?: number
  end?: number
  total?: number
}

export function parseContentRange(value?: string): ParsedContentRange | undefined {
  if (!value) return undefined

  const satisfied = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value)
  if (satisfied) {
    const start = Number(satisfied[1])
    const end = Number(satisfied[2])
    const total = satisfied[3] === '*' ? undefined : Number(satisfied[3])
    if (end < start) return undefined
    return { start, end, total }
  }

  const unsatisfied = /^bytes\s+\*\/(\d+)$/i.exec(value)
  if (unsatisfied) return { total: Number(unsatisfied[1]) }

  return undefined
}

function numericHeader(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number.parseInt(raw || '0', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export async function downloadZKeys(
  archivePath: string,
  fileName: string,
  expectedSize?: number,
  requestGet: typeof https.get = https.get,
) {
  const url = `https://vota-zkey.s3.ap-southeast-1.amazonaws.com/${fileName}`
  console.log(url)

  let resumeOffset = fs.existsSync(archivePath)
    ? fs.statSync(archivePath).size
    : 0
  if (expectedSize && resumeOffset > expectedSize) {
    console.warn(
      `Discarding oversized partial download for ${fileName}: ${resumeOffset} > ${expectedSize}`,
    )
    fs.rmSync(archivePath, { force: true })
    resumeOffset = 0
  }
  if (expectedSize && resumeOffset === expectedSize) {
    console.log(
      `Found a complete partial download for ${fileName}; verifying checksum`,
    )
    return
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let file: fs.WriteStream | undefined
    let progress: ReturnType<typeof createDownloadProgressReporter> | undefined
    let downloadedBytes = resumeOffset

    const fail = (error: Error, discardPartial: boolean = false) => {
      if (settled) return
      settled = true
      progress?.stop()

      const rejectAfterClose = () => {
        if (discardPartial) {
          try {
            fs.rmSync(archivePath, { force: true })
          } catch {}
        }
        reject(error)
      }

      if (file && !file.closed) {
        file.once('close', rejectAfterClose)
        file.destroy()
      } else {
        rejectAfterClose()
      }
    }

    const headers = resumeOffset > 0
      ? { Range: `bytes=${resumeOffset}-` }
      : undefined
    const request = requestGet(url, { headers }, (response) => {
      const statusCode = response.statusCode || 0
      const contentRange = parseContentRange(response.headers['content-range'])
      let writeOffset = resumeOffset
      let writeFlags: 'a' | 'w' = resumeOffset > 0 ? 'a' : 'w'

      if (resumeOffset > 0 && statusCode === 206) {
        if (contentRange?.start !== resumeOffset) {
          response.resume()
          fail(
            new Error(
              `Invalid Content-Range while resuming ${fileName}: expected start ${resumeOffset}, got ${response.headers['content-range'] || 'missing'}`,
            ),
            true,
          )
          return
        }
      } else if (resumeOffset > 0 && statusCode === 200) {
        console.warn(
          `Download server ignored the Range request for ${fileName}; restarting from byte 0`,
        )
        writeOffset = 0
        downloadedBytes = 0
        writeFlags = 'w'
      } else if (resumeOffset > 0 && statusCode === 416) {
        response.resume()
        if (contentRange?.total === resumeOffset) {
          settled = true
          resolve()
        } else {
          fail(
            new Error(
              `Range request rejected for ${fileName}: local=${resumeOffset}, remote=${contentRange?.total ?? 'unknown'}`,
            ),
            true,
          )
        }
        return
      } else if (resumeOffset === 0 && statusCode === 206) {
        if (contentRange?.start !== 0) {
          response.resume()
          fail(
            new Error(
              `Invalid initial Content-Range for ${fileName}: ${response.headers['content-range'] || 'missing'}`,
            ),
            true,
          )
          return
        }
      } else if (statusCode !== 200) {
        response.resume()
        fail(new Error(`Invalid status code: ${statusCode}`))
        return
      }

      const responseSize = numericHeader(response.headers['content-length'])
      const responseTotal = contentRange?.total
        || (responseSize > 0
          ? (statusCode === 206 ? writeOffset + responseSize : responseSize)
          : 0)
      const totalSize = responseTotal || expectedSize || 0
      if (expectedSize && totalSize > 0 && totalSize !== expectedSize) {
        response.resume()
        fail(
          new Error(
            `Unexpected archive size for ${fileName}: expected ${expectedSize}, server reported ${totalSize}`,
          ),
          true,
        )
        return
      }
      progress = createDownloadProgressReporter(fileName, totalSize, {
        initialBytes: writeOffset,
      })

      file = fs.createWriteStream(archivePath, { flags: writeFlags })
      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        progress?.update(downloadedBytes)
      })
      response.on('aborted', () => fail(new Error('Download aborted')))
      response.on('error', fail)
      file.on('error', fail)
      file.on('finish', () => {
        if (settled) return
        if (!response.complete) {
          fail(new Error('Download ended before the response was complete'))
          return
        }
        if (totalSize > 0 && downloadedBytes !== totalSize) {
          fail(
            new Error(
              `Download size mismatch for ${fileName}: expected ${totalSize}, got ${downloadedBytes}`,
            ),
            downloadedBytes > totalSize,
          )
          return
        }
        settled = true
        progress?.complete(downloadedBytes)
        file?.close(() => resolve())
      })
      response.pipe(file)
    })

    request.on('error', (error) => {
      console.error('Error during download:', error)
      fail(error)
    })
  })
}

async function downloadZKeysWithRetry(
  archivePath: string,
  fileName: string,
  retries: number,
  expectedSize?: number,
) {
  let attempt = 0
  while (true) {
    try {
      await downloadZKeys(archivePath, fileName, expectedSize)
      return
    } catch (e) {
      attempt++
      if (attempt > retries) throw e
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10000)
      console.warn(`Download failed (attempt ${attempt}/${retries + 1}): ${e}. Retrying in ${delay}ms...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

async function extractZKeys(archivePath: string, destRoot: string) {
  try {
    await tar.x({
      C: destRoot,
      file: archivePath,
    })
  } catch (error) {
    console.error('An error occurred during extraction:', error)
    throw error
  }
}
