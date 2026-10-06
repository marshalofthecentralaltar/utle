/**
 * Downloads TalTech's streaming Estonian and English model for the local recogniser (ARCHITECTURE
 * 20.1) into models/streaming-zipformer-large.et-en/, then, as a second and optional step, the
 * speaker embedding model (round 4, server/speaker.ts) into models/speaker/. Skips files that are
 * already there. A failure of the second step is a warning: the recogniser works without it.
 *
 *   npm run model
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { MODEL_DIR, MODEL_FILES } from '../server/asr.ts'
import { SPEAKER_DIR, SPEAKER_MODEL_BYTES, SPEAKER_MODEL_FILE, SPEAKER_MODEL_URL } from '../server/speaker.ts'

const SOURCE = 'https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en/resolve/main'
const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, MODEL_DIR)
mkdirSync(dir, { recursive: true })

/** Fetches url to target unless target is already there. */
async function fetchFile(url: string, target: string, file: string): Promise<void> {
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`have ${file}`)
    return
  }
  console.log(`fetching ${file} ...`)
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${file}: HTTP ${response.status}`)
  const partial = `${target}.part`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  renameSync(partial, target)
  console.log(`saved ${file} (${Math.round(statSync(target).size / 1e6)} MB)`)
}

for (const file of MODEL_FILES) await fetchFile(`${SOURCE}/${file}`, join(dir, file), file)
console.log(`model ready in ${MODEL_DIR}`)

// The speaker model (optional): without it "Kuula ainult mind" goes by loudness alone.
const speakerDir = join(root, SPEAKER_DIR)
mkdirSync(speakerDir, { recursive: true })
try {
  await fetchFile(SPEAKER_MODEL_URL, join(speakerDir, SPEAKER_MODEL_FILE), `${SPEAKER_MODEL_FILE} (${Math.round(SPEAKER_MODEL_BYTES / 1e6)} MB, the owner's-voice model)`)
  console.log(`speaker model ready in ${SPEAKER_DIR}`)
} catch (error) {
  console.warn(`speaker model not fetched (${error instanceof Error ? error.message : String(error)}); the recogniser works without it, "Kuula ainult mind" goes by loudness alone. Run npm run model again later.`)
}
