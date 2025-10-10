import * as fs from 'fs'
import * as path from 'path'
import * as readlineSync from 'readline-sync'
import * as https from 'https'
import * as tar from 'tar'
import ProgressBar from 'progress'
import { MaciType } from '../types'

// Download and extract zkey bundle into a destination root.
// The tarball contains a top-level `zkey/` folder with power-specific subfolders.
// destRoot should be the parent directory where `zkey/` will be created.
export async function downloadAndExtractZKeys(
  circuitPower: MaciType,
  destRoot: string = '.',
  opts: { force?: boolean } = {},
) {
  const fileName = `amaci_${circuitPower}_zkeys.tar.gz`
  const zkeyRoot = path.join(destRoot, 'zkey')

  if (fs.existsSync(zkeyRoot) && !opts.force) {
    // When called by CLI, override is handled there; avoid double prompt here.
    // Default to skip removal and proceed to extraction (will overwrite files where needed).
    // If full cleanup is desired, caller should pass opts.force=true.
  } else if (opts.force && fs.existsSync(zkeyRoot)) {
    await removeZKeys(zkeyRoot)
  }

  await downloadZKeysWithRetry(fileName, 3)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await extractZKeys(fileName, destRoot)
}

async function downloadZKeys(fileName: string) {
  const url = `https://vota-zkey.s3.ap-southeast-1.amazonaws.com/${fileName}`
  console.log(url)
  const file = fs.createWriteStream(fileName)

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
        try { fs.unlinkSync(fileName) } catch {}
        reject(err)
      })
  })
}

async function downloadZKeysWithRetry(fileName: string, retries: number) {
  let attempt = 0
  while (true) {
    try {
      await downloadZKeys(fileName)
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

async function extractZKeys(fileName: string, destRoot: string) {
  try {
    await tar.x({
      C: destRoot,
      file: fileName,
      // cwd: ".", // Extract to the current working directory
      // filter: (path: any) => path.endsWith("zkeys"),
    })
  } catch (error) {
    console.error('An error occurred during extraction:', error)
    throw error
  }
}

async function removeZKeys(zkeyRoot: string) {
  try {
    fs.rmSync(zkeyRoot, { recursive: true, force: true })
  } catch {}
}
