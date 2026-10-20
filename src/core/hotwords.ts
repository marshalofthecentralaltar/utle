/**
 * Round 7 (ARCHITECTURE 28.1): the hotword list that biases the local recogniser toward the
 * command vocabulary. sherpa-onnx's contextual biasing works on the model's own tokens; this
 * model ships tokens.txt and no bpe.model, so the recogniser is given words (modelingUnit 'bpe')
 * and a vocabulary built here from tokens.txt, and encodes the words itself. Pure: strings in,
 * strings out.
 */
import { SITES } from './browserIntent.ts'
import { COMMAND_PHRASES, COMMAND_WORDS } from './inpage.ts'

/**
 * Words that only the English command phrases use. A phrase made of nothing else is English and
 * left out: the person speaks Estonian, and an English hotword would pull Estonian speech toward it.
 */
const ENGLISH = new Set([
  'a', 'add', 'after', 'again', 'all', 'an', 'and', 'as', 'cancel', 'comma', 'digits', 'exclamation', 'mark', 'normally', 'period', 'question', 'words', 'arrow', 'back', 'backspace', 'bar', 'before', 'beginning', 'bigger', 'bit', 'bottom', 'box',
  'browser', 'but', 'change', 'chat', 'clear', 'close', 'code', 'conversation', 'data', 'delete', 'details', 'do', 'dont', 'down',
  'email', 'end', 'enter', 'escape', 'everything', 'exit', 'field', 'forward', 'full', 'fullscreen', 'go', 'here', 'hide', 'hints',
  'id', 'in', 'insert', 'it', 'larger', 'last', 'left', 'letter', 'line', 'listening', 'little', 'louder', 'make', 'message', 'mute',
  'my', 'new', 'next', 'normal', 'not', 'number', 'numbers', 'of', 'one', 'open', 'out', 'page', 'pause', 'phone', 'play', 'previous',
  'quieter', 'redo', 'refresh', 'reload', 'replace', 'reset', 'right', 'save', 'screen', 'scroll', 'scrolling', 'search', 'select',
  'selection', 'send', 'sentence', 'settings', 'show', 'size', 'skip', 'sleep', 'slowly', 'smaller', 'start', 'stop', 'tab', 'tell',
  'text', 'that', 'the', 'this', 'to', 'top', 'turn', 'type', 'undo', 'unmute', 'up', 'video', 'volume', 'wake', 'window', 'with',
  'word', 'write', 'zoom',
])

/** True when every word of the phrase is one only English commands use. */
export function isEnglishPhrase(phrase: string): boolean {
  return phrase.split(' ').every((word) => ENGLISH.has(word))
}

/**
 * The site names as they are written, not the sound-alike spellings beside them in SITES
 * ("juutuba", "vatsap"): a name counts when it, without spaces, is in its own address.
 */
function siteNames(): string[] {
  return Object.entries(SITES)
    .filter(([name, url]) => !name.includes(' ') && new URL(url).hostname.includes(name))
    .map(([name]) => name)
}

/** Letters, digits and single spaces only: what a hotword line may hold. */
const PLAIN = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u

/**
 * Every fixed Estonian command phrase and word, and the site names, lowercase, once each, in a
 * stable order: the lines of the hotwords file.
 */
export function hotwordPhrases(): string[] {
  const all = [...COMMAND_PHRASES, ...COMMAND_WORDS, ...siteNames()].map((phrase) => phrase.toLowerCase().trim())
  return [...new Set(all)].filter((phrase) => PLAIN.test(phrase) && !isEnglishPhrase(phrase)).sort()
}

/** The hotwords file: one phrase per line, as the sherpa-onnx docs require with modelingUnit 'bpe'. */
export function hotwordsText(phrases: readonly string[] = hotwordPhrases()): string {
  return `${phrases.join('\n')}\n`
}

/**
 * The sentencepiece-style vocabulary sherpa-onnx's 'bpe' encoder reads ("piece<TAB>score" per
 * line), from the model's tokens.txt ("piece id" per line). The real scores are not shipped; the
 * pieces are in the order the tokeniser ranked them, so the score is -ln(id), a Zipf estimate of
 * the log probability. The blank, the special symbols (<...>) and the disambiguation ids (#n) are left out.
 */
export function bpeVocabFromTokens(tokensTxt: string): string {
  const lines: string[] = []
  for (const line of tokensTxt.split(/\r?\n/u)) {
    const match = /^(\S+) (\d+)$/u.exec(line)
    if (match === null) continue
    const [, piece = '', id = '0'] = match
    const n = Number(id)
    if (piece.startsWith('<') || /^#\d+$/u.test(piece) || n === 0) continue
    lines.push(`${piece}\t${(-Math.log(n)).toFixed(4)}`)
  }
  return `${lines.join('\n')}\n`
}
