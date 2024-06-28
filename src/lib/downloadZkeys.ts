import * as fs from 'fs'

import * as readlineSync from 'readline-sync'
import * as https from 'https'
import * as tar from 'tar'
import ProgressBar from 'progress'
import { MaciType } from '../types'

export async function downloadAndExtractZKeys(circuitPower: MaciType) {
  const fileName = `amaci_${circuitPower}_zkeys.tar.gz`

  if (fs.existsSync('zkeys')) {
    const choice = readlineSync.question(
      'Zkey folder already exists, do you want to override? (y/n): ',
    )
    if (choice.toLowerCase() !== 'y') {
      return
    } else {
      await removeZKeys()
    }
  }

  await downloadZKeys(fileName)
  await new Promise((resolve) => setTimeout(resolve, 2000))
  await extractZKeys(fileName)
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
        fs.unlink(fileName, () => {
          reject(err)
        })
      })
  })
}

async function extractZKeys(fileName: string) {
  try {
    await tar.x({
      C: '.',
      file: fileName,
      // cwd: ".", // Extract to the current working directory
      // filter: (path: any) => path.endsWith("zkeys"),
    })
  } catch (error) {
    console.error('An error occurred during extraction:', error)
    throw error
  }
}

async function removeZKeys() {
  fs.rmdirSync('zkey', { recursive: true })
}
