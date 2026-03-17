import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as tar from 'tar'
import ProgressBar from 'progress'
import { MaciType } from '../types'

const REQUIRED_FILES = [
  'msg.wasm',
  'msg.zkey',
  'tally.wasm',
  'tally.zkey',
  'deactivate.wasm',
  'deactivate.zkey',
] as const

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function hasRequiredFiles(dir: string): boolean {
  return REQUIRED_FILES.every((file) => fs.existsSync(path.join(dir, file)))
}

function bundleAliases(circuitPower: MaciType): string[] {
  const powerOnly = circuitPower.replace(/_v[34]$/, '')
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
  const candidates = walkDirectories(extractRoot).filter((dir) => hasRequiredFiles(dir))

  if (candidates.length === 0) {
    throw new Error(
      `Extracted archive for ${circuitPower} does not contain a valid bundle directory. Expected files: ${REQUIRED_FILES.join(', ')}`,
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
  const shouldReplace = opts.force || !hasRequiredFiles(bundleRoot)

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
    await new Promise((resolve) => setTimeout(resolve, 500))
    await extractZKeys(archivePath, extractRoot)

    const sourceBundleDir = locateBundleDirectory(extractRoot, circuitPower)
    copyDirectoryContents(sourceBundleDir, stagedBundleDir)

    if (!hasRequiredFiles(stagedBundleDir)) {
      throw new Error(
        `Normalized bundle for ${circuitPower} is incomplete after extraction`,
      )
    }

    replaceBundleDirectory(stagedBundleDir, bundleRoot)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
}

async function downloadZKeys(archivePath: string, fileName: string) {
  const url = `https://vota-zkey.s3.ap-southeast-1.amazonaws.com/${fileName}`
  console.log(url)
  const file = fs.createWriteStream(archivePath)

  // Initialize progress bar
  const progressBar = new ProgressBar('Downloading [:bar] :percent :etas', {
    complete: '=',
    incomplete: ' ',
    width: 20,
    total: 0, // Will be updated dynamically
  })

  await new Promise<void>((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          console.error('Invalid status code:', response.statusCode)
          reject(new Error(`Invalid status code: ${response.statusCode}`))
          return
        }

        // Update progress bar total based on content length
        const totalSize = parseInt(
          response.headers['content-length'] || '0',
          10,
        )
        progressBar.total = totalSize

        // Update progress bar with each received data chunk
        response.on('data', (chunk) => {
          progressBar.tick(chunk.length)
          file.write(chunk)
        })

        response.on('end', () => {
          file.end()
          resolve()
        })
      })
      .on('error', (err) => {
        console.error('Error during download:', err)
        try { fs.unlinkSync(archivePath) } catch {}
        reject(err)
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
