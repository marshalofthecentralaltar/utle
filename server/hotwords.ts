/**
 * Round 7 (ARCHITECTURE 28.1): the hotword files for the local recogniser, written next to the
 * model by `npm run model` (scripts/hotwords.ts) and at server start when missing, and the part of
 * the recogniser config that uses them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bpeVocabFromTokens, hotwordsText } from '../src/core/hotwords.ts'

/**
 * How much each matched token of a hotword is boosted in modified_beam_search. 0 turns biasing
 * off (no hotwords file is passed). Chosen by scripts/asr-hotwords-eval.ts (ARCHITECTURE 28.1):
 * on the five fixtures 1.0 and 1.5 both take the word errors from 1 to 0 ("näita numbreid ja"
 * loses its "ja"); 1.5 also changes dictated text ("Tere! Ava" became "Tere, ava"); 3.0 inserts
 * command words that were not said. 1.0 changes nothing else.
 */
export const HOTWORDS_SCORE = 1.0

/** The phrases, one per line. */
export const HOTWORDS_FILE = join('models', 'hotwords.txt')
/** The vocabulary the recogniser encodes the phrases with ("piece<TAB>score"), built from tokens.txt. */
export const HOTWORDS_VOCAB = join('models', 'hotwords.vocab')

/** Writes both files under root from the model's tokens.txt. Throws when tokens.txt cannot be read. */
export function writeHotwords(root: string, modelDir: string): { file: string; vocab: string } {
  const file = join(root, HOTWORDS_FILE)
  const vocab = join(root, HOTWORDS_VOCAB)
  const tokens = readFileSync(join(modelDir, 'tokens.txt'), 'utf8')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(vocab, bpeVocabFromTokens(tokens))
  writeFileSync(file, hotwordsText())
  return { file, vocab }
}

/**
 * F5 (30.3): the start-up line after the model has loaded: the hotwords file the recogniser uses and
 * how many phrases it holds, or why there is none. Counts and a path only.
 */
export function hotwordsLine(root: string, score: number = HOTWORDS_SCORE): string {
  if (!(score > 0)) return '[asr] hotwords off (score 0)'
  const file = join(root, HOTWORDS_FILE)
  if (!existsSync(file)) return `[asr] hotwords off (${HOTWORDS_FILE} missing)`
  const phrases = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '').length
  return `[asr] hotwords on: ${HOTWORDS_FILE}, ${phrases} phrases, score ${score}`
}

export interface HotwordsConfig {
  /** Spread into modelConfig. */
  model: { modelingUnit?: string; bpeVocab?: string }
  /** Spread into the recogniser config. */
  recognizer: { hotwordsFile?: string; hotwordsScore?: number }
}

const OFF: HotwordsConfig = { model: {}, recognizer: {} }

/**
 * The hotword part of the recogniser config. Score 0 (or below): none. The files are written when
 * missing; when they cannot be, the recogniser runs without hotwords rather than not at all.
 */
export function hotwordsConfig(root: string, modelDir: string, score: number = HOTWORDS_SCORE): HotwordsConfig {
  if (!(score > 0)) return OFF
  let file = join(root, HOTWORDS_FILE)
  let vocab = join(root, HOTWORDS_VOCAB)
  if (!existsSync(file) || !existsSync(vocab)) {
    try {
      ;({ file, vocab } = writeHotwords(root, modelDir))
    } catch {
      return OFF
    }
  }
  return { model: { modelingUnit: 'bpe', bpeVocab: vocab }, recognizer: { hotwordsFile: file, hotwordsScore: score } }
}
