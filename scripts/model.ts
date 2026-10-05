/**
 * Downloads TalTech's streaming Estonian and English model for the local recogniser (ARCHITECTURE
 * 20.1) into models/streaming-zipformer-large.et-en/. Skips files that are already there.
 *
 *   npm run model
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { MODEL_DIR, MODEL_FILES } from '../server/asr.ts'

const SOURCE = 'https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en/resolve/main'
const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, MODEL_DIR)
mkdirSync(dir, { recursive: true })

for (const file of MODEL_FILES) {
  const target = join(dir, file)
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`have ${file}`)
    continue
  }
  console.log(`fetching ${file} ...`)
  const response = await fetch(`${SOURCE}/${file}`)
  if (!response.ok || !response.body) throw new Error(`${file}: HTTP ${response.status}`)
  const partial = `${target}.part`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  renameSync(partial, target)
  console.log(`saved ${file} (${Math.round(statSync(target).size / 1e6)} MB)`)
}
console.log(`model ready in ${MODEL_DIR}`)
