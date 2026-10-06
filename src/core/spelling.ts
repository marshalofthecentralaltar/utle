import type { FieldKind } from '../browser/protocol.ts'

/**
 * Round 5 (the fields lane): what he says, as a form field needs it. The recogniser writes numbers
 * as words ("kolm üheksa null kaks") and symbols as words ("ät", "punkt"); an ID code, a phone
 * number, an e-mail address or a PIN needs digits and characters. typedFromSpoken converts for
 * the kind of field the words go into. Pure: a string in, a string out, no state.
 *
 * Numbers: digit by digit when spoken one by one ("kolm üheksa null kaks" is 3902), as a number
 * when spoken as one ("kakskümmend kolm" is 23, "sada kaksteist" is 112, "kolm tuhat" is 3000),
 * Estonian and English, up to the thousands. Digits already written stay. A run of numbers is one
 * digit string with no spaces between its parts.
 */

export type SpellKind = FieldKind | 'auto'

const UNITS: Record<string, number> = {
  null: 0, üks: 1, kaks: 2, kolm: 3, neli: 4, viis: 5, kuus: 6, seitse: 7, kaheksa: 8, üheksa: 9,
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
}

/** Ten and the teens: a number of their own, never followed by a unit. */
const TEENS: Record<string, number> = {
  kümme: 10, üksteist: 11, kaksteist: 12, kolmteist: 13, neliteist: 14, viisteist: 15, kuusteist: 16, seitseteist: 17, kaheksateist: 18, üheksateist: 19,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}

const TENS: Record<string, number> = {
  kakskümmend: 20, kolmkümmend: 30, nelikümmend: 40, viiskümmend: 50, kuuskümmend: 60, seitsekümmend: 70, kaheksakümmend: 80, üheksakümmend: 90,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

/** "kakssada" as one word; "kaks sada" as two is handled by the parser. */
const HUNDREDS: Record<string, number> = {
  sada: 100, kakssada: 200, kolmsada: 300, nelisada: 400, viissada: 500, kuussada: 600, seitsesada: 700, kaheksasada: 800, üheksasada: 900,
}
const HUNDRED = new Set(['sada', 'hundred'])
const THOUSAND = new Set(['tuhat', 'thousand'])
/** "kaks kümmend": the tens word split in two. */
const TENS_SUFFIX = 'kümmend'

const SYMBOLS: Record<string, string> = {
  '@': '@', ät: '@', ätt: '@', at: '@',
  punkt: '.', dot: '.', point: '.',
  sidekriips: '-', miinus: '-', kriips: '-', minus: '-', dash: '-', hyphen: '-',
  alakriips: '_', alljoon: '_', allkriips: '_', underscore: '_',
  tühik: ' ', space: ' ',
  kaldkriips: '/', slash: '/',
  koolon: ':', colon: ':',
  koma: ',', comma: ',',
  pluss: '+', plus: '+',
}

/** Estonian letter names, as the recogniser writes them. A single letter is itself. */
const LETTERS: Record<string, string> = {
  bee: 'b', tsee: 'c', dee: 'd', ee: 'e', eff: 'f', gee: 'g', haa: 'h', ii: 'i', jott: 'j', kaa: 'k', ell: 'l', emm: 'm', enn: 'n',
  oo: 'o', pee: 'p', kuu: 'q', ärr: 'r', ess: 's', tee: 't', uu: 'u', vee: 'v', kaksisvee: 'w', iks: 'x', igrek: 'y', tsett: 'z',
}

/** "suur a" is A: the next letter or word is capitalised (codes and passwords). */
const CAPITAL = new Set(['suur', 'suurtäht', 'capital', 'uppercase'])

const DIGITS = /^[+-]?\d+(?:[.,]\d+)?$/u
const TRAILING_MARKS = /[.,!?;:]+$/u

/** A table lookup that never finds "constructor" or another inherited name. */
function get<T>(table: Record<string, T>, k: string): T | undefined {
  return Object.hasOwn(table, k) ? table[k] : undefined
}

function isNumberWord(word: string): boolean {
  return get(UNITS, word) !== undefined || get(TEENS, word) !== undefined || get(TENS, word) !== undefined || get(HUNDREDS, word) !== undefined || HUNDRED.has(word) || THOUSAND.has(word)
}

function isNumberToken(word: string): boolean {
  return DIGITS.test(word) || isNumberWord(word)
}

/** The lowercase lookup form of a token: trailing marks dropped. */
function key(token: string): string {
  return token.toLocaleLowerCase().replace(TRAILING_MARKS, '')
}

/** One spoken number starting at words[i]: its digits and where the next token starts, or null. */
function numberAt(words: readonly string[], i: number, allowThousands = true): { digits: string; next: number } | null {
  const at = (j: number): string => words[j] ?? ''
  const written = at(i)
  if (DIGITS.test(written)) return { digits: written, next: i + 1 }
  let j = i
  let total = 0
  let compound = false
  if (allowThousands) {
    const small = numberAt(words, j, false)
    if (small !== null && THOUSAND.has(at(small.next))) {
      total += Number(small.digits) * 1000
      j = small.next + 1
      compound = true
    } else if (THOUSAND.has(at(j))) {
      total += 1000
      j++
      compound = true
    }
  }
  const hundreds = get(HUNDREDS, at(j))
  const lead = get(UNITS, at(j)) ?? 0
  if (hundreds !== undefined) {
    total += hundreds
    j++
    compound = true
  } else if (lead !== 0 && HUNDRED.has(at(j + 1))) {
    total += lead * 100
    j += 2
    compound = true
  } else if (HUNDRED.has(at(j))) {
    total += 100
    j++
    compound = true
  }
  const teen = get(TEENS, at(j))
  const tens = get(TENS, at(j))
  const tensLead = get(UNITS, at(j)) ?? 0
  if (teen !== undefined) {
    total += teen
    j++
    compound = true
  } else if (tens !== undefined) {
    total += tens
    j++
    compound = true
    const unit = get(UNITS, at(j))
    if (unit !== undefined && unit !== 0) {
      total += unit
      j++
    }
  } else if (tensLead !== 0 && at(j + 1) === TENS_SUFFIX) {
    total += tensLead * 10
    j += 2
    compound = true
    const unit = get(UNITS, at(j))
    if (unit !== undefined && unit !== 0) {
      total += unit
      j++
    }
  } else {
    const unit = get(UNITS, at(j))
    if (unit !== undefined && (!compound || unit !== 0)) {
      total += unit
      j++
      // A unit alone is one digit ("null" is 0, "kolm" is 3), so digits spoken one by one keep their zeros.
      if (!compound) return { digits: String(unit), next: j }
    }
  }
  return j === i ? null : { digits: String(total), next: j }
}

type Piece =
  | { kind: 'digits'; text: string }
  | { kind: 'symbol'; text: string }
  | { kind: 'letter'; text: string }
  | { kind: 'word'; text: string }

/** The utterance as pieces: number runs as digit strings, symbols, spelled letters, the other words. */
function pieces(words: readonly string[], spellLetters: boolean, domains = false): Piece[] {
  const out: Piece[] = []
  let capital = false
  const cased = (text: string): string => {
    if (!capital) return text
    capital = false
    return text.charAt(0).toLocaleUpperCase() + text.slice(1)
  }
  const keys = words.map(key)
  let i = 0
  while (i < keys.length) {
    const k = keys[i] ?? ''
    if (k === '') {
      i++
      continue
    }
    let run = ''
    let j = i
    for (;;) {
      const n = numberAt(keys, j)
      if (n === null) break
      run += n.digits
      j = n.next
    }
    if (run !== '') {
      out.push({ kind: 'digits', text: run })
      i = j
      continue
    }
    if (CAPITAL.has(k)) {
      capital = true
      i++
      continue
    }
    const symbol = get(SYMBOLS, k)
    if (symbol !== undefined) {
      out.push({ kind: 'symbol', text: symbol })
      i++
      continue
    }
    // In an address what follows a dot is a domain ending: ".ee" is Estonia, not the letter e.
    const afterDot = domains && out.at(-1)?.kind === 'symbol' && out.at(-1)?.text === '.'
    if (spellLetters && !afterDot) {
      const named = get(LETTERS, k)
      if (named !== undefined) {
        out.push({ kind: 'letter', text: cased(named) })
        i++
        continue
      }
      if (/^\p{L}$/u.test(k)) {
        out.push({ kind: 'letter', text: cased(k) })
        i++
        continue
      }
    }
    out.push({ kind: 'word', text: cased(lowerInitial(words[i] ?? '')) })
    i++
  }
  return out
}

/** The recogniser's capital at the start of an utterance, taken off; a word's own capitals (ERR) kept. */
function lowerInitial(word: string): string {
  const bare = word.replace(TRAILING_MARKS, '')
  if (/\p{Lu}/u.test(bare.slice(1))) return bare
  return bare.charAt(0).toLocaleLowerCase() + bare.slice(1)
}

function tokenise(text: string): string[] {
  return text
    .trim()
    .split(/\s+/u)
    .flatMap((token) => {
      // "twenty-three": the hyphen between two number words is a space.
      const [a, b, ...rest] = token.split('-')
      if (rest.length === 0 && a !== undefined && b !== undefined && isNumberWord(a.toLocaleLowerCase()) && isNumberWord(key(b))) return [a, b]
      return [token]
    })
    .filter((token) => token !== '')
}

/** For a text box: only a run of three or more number words becomes digits ("kell viis" stays). */
function asText(text: string): string {
  const tokens = text.split(/(\s+)/u)
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i] ?? ''
    if (/^\s*$/u.test(token) || !isNumberToken(key(token))) {
      out.push(token)
      i++
      continue
    }
    // A run of number tokens, separated by whitespace tokens.
    const run: string[] = []
    let j = i
    while (j < tokens.length && isNumberToken(key(tokens[j] ?? ''))) {
      run.push(tokens[j] ?? '')
      j += 2
    }
    const last = run.at(-1) ?? ''
    const end = i + run.length * 2 - 1
    if (run.length >= 3) {
      const keys = run.map(key)
      let digits = ''
      let at = 0
      while (at < keys.length) {
        const n = numberAt(keys, at)
        if (n === null) break
        digits += n.digits
        at = n.next
      }
      const marks = TRAILING_MARKS.exec(last)?.[0] ?? ''
      out.push(digits + marks)
    } else {
      out.push(...tokens.slice(i, end))
    }
    i = end
  }
  return out.join('')
}

const KEEP_IN_NUMBER = new Set(['.', ',', '-', '+'])

/** A number field: digits, one decimal point, a leading sign; nothing else. With no digit at all the words stay. */
function asNumber(parts: readonly Piece[], original: string): string {
  let out = ''
  for (const p of parts) {
    if (p.kind === 'digits') out += p.text.replace(',', '.')
    else if (p.kind === 'symbol' && KEEP_IN_NUMBER.has(p.text)) out += p.text === ',' ? '.' : p.text
  }
  const sign = out.startsWith('-') ? '-' : ''
  const body = out.replace(/[^\d.]/gu, '')
  const [whole = '', ...fraction] = body.split('.')
  const number = fraction.length > 0 ? `${whole}.${fraction.join('')}` : whole
  return /\d/u.test(number) ? sign + number : original.trim()
}

function asTel(parts: readonly Piece[]): string {
  const joined = parts.map((p) => p.text).join('')
  const plus = joined.trimStart().startsWith('+') ? '+' : ''
  return plus + joined.replace(/\D/gu, '')
}

/** Chooses by content: an "ät" is an e-mail address, mostly numbers is a code, else text. */
function detect(words: readonly string[]): FieldKind {
  const keys = words.map(key).filter((k) => k !== '')
  if (keys.some((k) => get(SYMBOLS, k) === '@')) return 'email'
  const numbers = keys.filter(isNumberToken).length
  if (numbers > 0 && numbers * 2 >= keys.length) return 'code'
  return 'text'
}

/**
 * What to type into a field of this kind for what he said. "auto" chooses by content.
 * - text: unchanged, except that three or more number words in a row become digits.
 * - email: lowercase, no spaces, numbers to digits, "ät" to @, "punkt" to a dot, letters spelled
 *   by name joined; ordinary words are joined with nothing between them ("ralf sepp" is "ralfsepp").
 * - tel: digits only, with a leading + kept ("pluss kolm seitse kaks" is +372).
 * - code: digits and letters, no spaces; "suur a" is A.
 * - number: a number with a decimal point ("viis koma kaks" is 5.2); the words stay when there is no digit.
 * - password: spelled letters, digits and words joined with nothing; "suur a" is A.
 */
export function typedFromSpoken(text: string, kind: SpellKind): string {
  const words = tokenise(text)
  const k: FieldKind = kind === 'auto' ? detect(words) : kind
  if (k === 'text') return asText(text)
  const parts = pieces(words, k !== 'number', k === 'email')
  switch (k) {
    case 'email':
      return parts
        .map((p) => (p.kind === 'symbol' && p.text === ',' ? 'koma' : p.text))
        .join('')
        .replace(/\s+/gu, '')
        .toLocaleLowerCase()
    case 'tel':
      return asTel(parts)
    case 'number':
      return asNumber(parts, text)
    case 'code':
    case 'password':
      return parts.map((p) => p.text).join('').replace(/\s+/gu, '')
  }
}

