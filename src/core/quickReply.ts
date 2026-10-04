/**
 * One-word replies recognised locally, without a network request (principle P3).
 * The whole utterance must match: "yes" is a quick reply, "yes, but make it Friday" is not.
 */
export type Quick =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'undo' }
  | { kind: 'sleep' }
  | { kind: 'wake' }
  | { kind: 'number'; n: number }

const PHRASES: Record<Exclude<Quick['kind'], 'number'>, readonly string[]> = {
  yes: ['yes', 'yeah', 'yep', 'ok', 'okay', 'correct', 'do it', 'confirm', 'accept', 'jah', 'jaa', 'just nii'],
  no: ['no', 'nope', 'cancel', 'discard', 'reject', 'ei', 'tühista'],
  undo: ['undo', 'undo that', 'võta tagasi'],
  sleep: ['stop listening', 'go to sleep', 'sleep', 'ära kuula', 'maga'],
  wake: ['wake up', 'start listening', 'ärka', 'ärka üles'],
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  üks: 1, kaks: 2, kolm: 3, neli: 4, viis: 5, kuus: 6, seitse: 7, kaheksa: 8, üheksa: 9, kümme: 10,
}

/** What recognisers write when a lone number is spoken. Used only while a number is expected. */
const NUMBER_HOMOPHONES: Record<string, number> = { won: 1, to: 2, too: 2, tree: 3, for: 4, fore: 4, ate: 8 }

const NUMBER_PREFIXES = ['number', 'option', 'paragraph', 'the', 'punkt', 'lõik']

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumber(text: string, expectNumber: boolean): number | null {
  let rest = text
  const [first, ...others] = text.split(' ')
  if (first && others.length > 0 && NUMBER_PREFIXES.includes(first)) rest = others.join(' ')

  if (/^\d{1,2}$/.test(rest)) {
    const n = Number(rest)
    return n >= 1 ? n : null
  }
  const word = NUMBER_WORDS[rest]
  if (word !== undefined) return word
  if (expectNumber) {
    const homophone = NUMBER_HOMOPHONES[rest]
    if (homophone !== undefined) return homophone
  }
  return null
}

export function quickReply(text: string, opts: { expectNumber?: boolean } = {}): Quick | null {
  const clean = normalise(text)
  if (clean === '') return null

  for (const kind of ['yes', 'no', 'undo', 'sleep', 'wake'] as const) {
    if (PHRASES[kind].includes(clean)) return { kind }
  }
  const n = parseNumber(clean, opts.expectNumber === true)
  return n === null ? null : { kind: 'number', n }
}
