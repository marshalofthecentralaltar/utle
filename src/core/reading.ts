// Reading aloud (docs/ARCHITECTURE.md 29.5, "Built (checkpoint 2)"): the sentences of a text, the
// words that stop a reading, and the reader's state machine. Pure: the extension's reader
// (extension/src/reader.ts) owns the voice, the timers and the microphone.

/** A reading is at most this many characters, cut at a block or sentence boundary. */
export const READ_MAX_CHARS = 20_000
/** A longer sentence is cut at a comma (else a space), so no single utterance runs long. */
export const MAX_SENTENCE_CHARS = 300

/** Titles and abbreviations after which a dot never ends a sentence, lower case, without the dot. */
const NEVER_ENDS = new Set(['nt', 'vt', 'dr', 'hr', 'pr', 'prl', 'mr', 'mrs', 'ms', 'st', 'nr', 'lk', 'u', 'ca', 'e.g', 'i.e', 'vs'])
/** The end of a sentence: its marks, then closing quotes or brackets, then white space or the end. */
const END = /[.!?…]+["'”»)\]]*(?=\s|$)/gu
const OPENING = /^["'„“«(]+/u

/** A sentence over MAX_SENTENCE_CHARS cut at its last comma, semicolon or colon before the limit, else its last space. */
function cutLong(sentence: string): string[] {
  const parts: string[] = []
  let rest = sentence
  while (rest.length > MAX_SENTENCE_CHARS) {
    const window = rest.slice(0, MAX_SENTENCE_CHARS)
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': ')) + 1
    if (cut < MAX_SENTENCE_CHARS / 3) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = MAX_SENTENCE_CHARS
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest !== '') parts.push(rest)
  return parts
}

/** One block of text (a heading, a paragraph) as its sentences, white space collapsed. */
export function splitSentences(text: string): string[] {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s === '') return []
  const out: string[] = []
  let from = 0
  for (const m of s.matchAll(END)) {
    const stop = m.index + m[0].length
    const next = s.slice(stop).trimStart().charAt(0)
    if (next !== '') {
      // "nt. kui", "22. oktoobril", "3. koht": the sentence goes on.
      if (/[\p{Ll}\p{N}]/u.test(next)) continue
      if (m[0].startsWith('.')) {
        const word = (/(\S+)$/.exec(s.slice(from, m.index))?.[1] ?? '').replace(OPENING, '')
        if (NEVER_ENDS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word)) continue
      }
    }
    const sentence = s.slice(from, stop).trim()
    if (sentence !== '') out.push(sentence)
    from = stop
  }
  const tail = s.slice(from).trim()
  if (tail !== '') out.push(tail)
  return out.flatMap(cutLong)
}

/** What a reading speaks: the blocks joined (capped at READ_MAX_CHARS) and their sentences in order. */
export function readingText(blocks: readonly string[]): { text: string; sentences: string[] } {
  const parts: string[] = []
  const sentences: string[] = []
  let total = 0
  for (const raw of blocks) {
    const block = raw.replace(/\s+/g, ' ').trim()
    if (block === '') continue
    const gap = parts.length === 0 ? 0 : 2
    const own = splitSentences(block)
    if (total + gap + block.length <= READ_MAX_CHARS) {
      parts.push(block)
      sentences.push(...own)
      total += gap + block.length
      continue
    }
    // The block that does not fit: as many of its sentences as do, then nothing more.
    const kept: string[] = []
    let length = total + gap
    for (const sentence of own) {
      const add = (kept.length === 0 ? 0 : 1) + sentence.length
      if (length + add > READ_MAX_CHARS) break
      kept.push(sentence)
      length += add
    }
    if (kept.length > 0) {
      parts.push(kept.join(' '))
      sentences.push(...kept)
    }
    break
  }
  return { text: parts.join('\n\n'), sentences }
}

/**
 * Whole utterances that stop a reading in progress (29.5); "paus" and "peata" too, since a reading is
 * what is playing. Outside a reading they all keep their meanings.
 */
const READ_STOPS = new Set(['stopp', 'stop', 'aitab', 'seis', 'lõpeta', 'lõpeta lugemine', 'stop reading', 'lugemine seis', 'paus', 'peata'])

export function isReadStop(utterance: string): boolean {
  const s = utterance
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return READ_STOPS.has(s)
}

/** idle: nothing read yet; speaking: sentence `at` is being spoken; stopped: "stopp" came at `at`; ended: the last sentence ended. */
export type ReadPhase = 'idle' | 'speaking' | 'stopped' | 'ended'

export interface ReadState {
  sentences: readonly string[]
  at: number
  phase: ReadPhase
  /** The sentence at `at` has failed once and was spoken again. */
  retried: boolean
  /** Sentences skipped in this reading after a failed retry. */
  skipped: number
}

export const READ_IDLE: ReadState = { sentences: [], at: 0, phase: 'idle', retried: false, skipped: 0 }

export type ReadEvent =
  | { kind: 'start'; sentences: readonly string[] }
  | { kind: 'sentenceEnd' }
  | { kind: 'sentenceError' }
  | { kind: 'stop' }
  | { kind: 'continue' }

/** What the reader does: speak a sentence, cancel the one being spoken, reading on or off, a line on the bar. */
export type ReadEffect =
  | { kind: 'speak'; index: number; text: string }
  | { kind: 'cancel' }
  | { kind: 'reading'; on: boolean }
  | { kind: 'line'; line: 'skipped' | 'ended' }

type Step = { state: ReadState; effects: ReadEffect[] }

const speakAt = (state: ReadState): ReadEffect => ({ kind: 'speak', index: state.at, text: state.sentences[state.at] ?? '' })

/** The next sentence after `at`, or the end of the reading. */
function advance(state: ReadState, before: ReadEffect[]): Step {
  const at = state.at + 1
  if (at >= state.sentences.length) {
    return { state: { ...state, at: state.sentences.length - 1, phase: 'ended', retried: false }, effects: [...before, { kind: 'reading', on: false }, { kind: 'line', line: 'ended' }] }
  }
  const next = { ...state, at, retried: false }
  return { state: next, effects: [...before, speakAt(next)] }
}

/** The reader's state machine (29.5): one event in, the new state and what to do. */
export function readStep(state: ReadState, event: ReadEvent): Step {
  const none: Step = { state, effects: [] }
  switch (event.kind) {
    case 'start': {
      if (event.sentences.length === 0) return none
      const next: ReadState = { sentences: [...event.sentences], at: 0, phase: 'speaking', retried: false, skipped: 0 }
      const lead: ReadEffect[] = state.phase === 'speaking' ? [{ kind: 'cancel' }] : [{ kind: 'reading', on: true }]
      return { state: next, effects: [...lead, speakAt(next)] }
    }
    case 'sentenceEnd':
      return state.phase === 'speaking' ? advance(state, []) : none
    case 'sentenceError': {
      if (state.phase !== 'speaking') return none
      if (!state.retried) {
        const next = { ...state, retried: true }
        return { state: next, effects: [speakAt(next)] }
      }
      const skipped = { ...state, skipped: state.skipped + 1 }
      return advance(skipped, state.skipped === 0 ? [{ kind: 'line', line: 'skipped' }] : [])
    }
    case 'stop':
      return state.phase === 'speaking' ? { state: { ...state, phase: 'stopped' }, effects: [{ kind: 'cancel' }, { kind: 'reading', on: false }] } : none
    case 'continue': {
      if (state.phase !== 'stopped' || state.at + 1 >= state.sentences.length) return none
      const next: ReadState = { ...state, at: state.at + 1, phase: 'speaking', retried: false }
      return { state: next, effects: [{ kind: 'reading', on: true }, speakAt(next)] }
    }
  }
}
