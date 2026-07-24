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
}

const ZKEY_ARCHIVE_SIZE: Partial<Record<MaciType, number>> = {
  '9-4-3-125_v6': 8_490_961_031,
}

const activeBundleDownloads = new Map<string, Promise<void>>()

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

async function verifyArchiveChecksum(
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
  const workspace = fs.mkdtempSync(path.join(targetZkeyRoot, '.amaci-zkey-'))
  const archivePath = path.join(workspace, fileName)
  const extractRoot = path.join(workspace, 'extract')
  const stagedBundleDir = path.join(workspace, 'stage', circuitPower)

  ensureDir(extractRoot)
  ensureDir(path.dirname(stagedBundleDir))

  try {
    await downloadZKeysWithRetry(archivePath, fileName, 3)
    verifyArchiveSize(circuitPower, archivePath)
    await verifyArchiveChecksum(circuitPower, archivePath)
    await extractZKeys(archivePath, extractRoot)

    const sourceBundleDir = locateBundleDirectory(extractRoot, circuitPower)
    copyDirectoryContents(sourceBundleDir, stagedBundleDir)

    if (!isBundleDirectoryComplete(stagedBundleDir)) {
      throw new Error(
        `Normalized bundle for ${circuitPower} is incomplete after extraction`,
      )
    }

    replaceBundleDirectory(stagedBundleDir, bundleRoot)
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

async function downloadZKeys(archivePath: string, fileName: string) {
  const url = `https://vota-zkey.s3.ap-southeast-1.amazonaws.com/${fileName}`
  console.log(url)

  // Initialize progress bar
  const progressBar = new ProgressBar('Downloading [:bar] :percent :etas', {
    complete: '=',
    incomplete: ' ',
    width: 20,
    total: 0, // Will be updated dynamically
  })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    let file: fs.WriteStream | undefined

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      file?.destroy()
      try {
        fs.rmSync(archivePath, { force: true })
      } catch {}
      reject(error)
    }

    const request = https.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        fail(new Error(`Invalid status code: ${response.statusCode}`))
        return
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10)
      progressBar.total = totalSize

      file = fs.createWriteStream(archivePath, { flags: 'w' })
      response.on('data', (chunk) => progressBar.tick(chunk.length))
      response.on('aborted', () => fail(new Error('Download aborted')))
      response.on('error', fail)
      file.on('error', fail)
      file.on('finish', () => {
        if (settled) return
        if (!response.complete) {
          fail(new Error('Download ended before the response was complete'))
          return
        }
        settled = true
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
) {
  let attempt = 0
  while (true) {
    try {
      await downloadZKeys(archivePath, fileName)
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
