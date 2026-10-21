/**
 * Round 7 (ARCHITECTURE 28.1): writes the recogniser's hotword list (models/hotwords.txt) and the
 * vocabulary it is encoded with (models/hotwords.vocab) from the command vocabulary in src/core
 * and the model's tokens.txt. `npm run model` runs this too; the server writes them when missing.
 *
 *   npx tsx scripts/hotwords.ts            into models/
 *   npx tsx scripts/hotwords.ts <folder>   into <folder>/models/ (a look without touching models/)
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_DIR } from '../server/asrModel.ts'
import { writeHotwords } from '../server/hotwords.ts'
import { hotwordPhrases } from '../src/core/hotwords.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = process.argv[2] ?? root
const { file, vocab } = writeHotwords(out, join(root, MODEL_DIR))
console.log(`${hotwordPhrases().length} phrases: ${file}\nvocabulary: ${vocab}`)
