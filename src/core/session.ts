import type { Candidate } from './candidates.ts'
import { numberOf } from './document.ts'
import type { Doc } from './document.ts'
import type { Intent, InterpretRequest, Pending } from './intent.ts'
import { localIntent, sectionText } from './localIntent.ts'
import { applyOps } from './ops.ts'
import { quickReply } from './quickReply.ts'
import type { Quick } from './quickReply.ts'

export type Mode = 'listening' | 'thinking' | 'confirming' | 'choosing' | 'asleep'

/** A "which one" question waiting for a number. utterance is the instruction that raised it. */
export interface Choice {
  utterance: string
  question: string
  candidates: Candidate[]
}

export interface Session {
  doc: Doc
  /** Undo stack. Its length is the number of finished edits. */
  history: Doc[]
  /** One line per finished edit, same length as history. */
  log: string[]
  mode: Mode
  /** Where to return when a request fails or is not understood. */
  resume: 'listening' | 'confirming' | 'choosing'
  pending: Pending | null
  choice: Choice | null
  focusId: string | null
  /** True while the editor is reading text aloud. */
  reading: boolean
  /** True while the list of things to say is shown. */
  help: boolean
  /** The last utterance, as recognised. */
  heard: string
  /** What the editor made of it. */
  understood: string
  /** What the user can say next. */
  prompt: string
  /** Words spoken or typed. */
  words: number
  /** Typed submissions and key presses that were acted on. */
  hands: number
  /** Id of the request in flight. A response with any other seq is ignored. */
  seq: number
  /** The instruction sent with the request in flight. */
  asked: string
}

export type Event =
  | { type: 'utterance'; text: string; source: 'voice' | 'typed' }
  | { type: 'key'; key: 'confirm' | 'reject' }
  | { type: 'intent'; seq: number; intent: Intent }
  | { type: 'interpretFailed'; seq: number; message: string }
  | { type: 'speechEnded' }

export type Effect =
  | { type: 'interpret'; seq: number; request: InterpretRequest }
  /** Read this text aloud. */
  | { type: 'speak'; text: string }
  /** Stop reading aloud. */
  | { type: 'hush' }

export interface StepResult {
  state: Session
  effects: Effect[]
}

const PROMPT = {
  listening: 'Say what to change, or a paragraph number.',
  thinking: 'Working on it.',
  confirming: 'Say yes or no, or only the word to change.',
  asleep: 'Say wake up to continue.',
  reading: 'Say stop to end the reading.',
} as const

function choosingPrompt(count: number): string {
  return `Say a number from 1 to ${count}, or no.`
}

export function initialSession(doc: Doc): Session {
  return {
    doc,
    history: [],
    log: [],
    mode: 'listening',
    resume: 'listening',
    pending: null,
    choice: null,
    focusId: null,
    reading: false,
    help: false,
    heard: '',
    understood: 'Waiting for you to speak.',
    prompt: PROMPT.listening,
    words: 0,
    hands: 0,
    seq: 0,
    asked: '',
  }
}

function done(state: Session): StepResult {
  return { state, effects: [] }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Back to listening with nothing pending. */
function toListening(s: Session, understood: string): Session {
  return { ...s, mode: 'listening', resume: 'listening', pending: null, choice: null, understood, prompt: PROMPT.listening }
}

/** Back to the mode the request started from, with the proposal or question intact (principle P4). */
function toResume(s: Session, understood: string): Session {
  if (s.resume === 'confirming' && s.pending) {
    return { ...s, mode: 'confirming', understood, prompt: PROMPT.confirming }
  }
  if (s.resume === 'choosing' && s.choice) {
    return { ...s, mode: 'choosing', understood, prompt: choosingPrompt(s.choice.candidates.length) }
  }
  return toListening(s, understood)
}

function ask(
  s: Session,
  utterance: string,
  context: Pick<InterpretRequest, 'pending' | 'choice'>,
  resume: Session['resume'],
): StepResult {
  const seq = s.seq + 1
  const state: Session = { ...s, mode: 'thinking', resume, seq, asked: utterance, prompt: PROMPT.thinking }
  const request: InterpretRequest = { doc: s.doc, utterance, pending: context.pending, choice: context.choice }
  return { state, effects: [{ type: 'interpret', seq, request }] }
}

function accept(s: Session): Session {
  if (!s.pending) return toListening(s, 'Nothing to confirm.')
  const result = applyOps(s.doc, s.pending.ops)
  if (!result.ok) return toListening(s, 'That no longer fits the document. Nothing changed.')
  return {
    ...toListening(s, 'Done. Saved as a tracked change.'),
    doc: result.doc,
    history: [...s.history, s.doc],
    log: [...s.log, s.pending.summary],
  }
}

function sleep(s: Session): Session {
  return {
    ...s,
    mode: 'asleep',
    resume: 'listening',
    pending: null,
    choice: null,
    focusId: null,
    understood: 'Asleep. The microphone is ignored.',
    prompt: PROMPT.asleep,
  }
}

/** Acts on an Intent, whether it came from the interpreter or from a local command. */
function onIntent(s: Session, intent: Intent): StepResult {
  switch (intent.kind) {
    case 'propose_edit': {
      const result = applyOps(s.doc, intent.ops)
      if (!result.ok) return done(toResume(s, 'That did not fit the document. Nothing changed.'))
      return done({
        ...s,
        mode: 'confirming',
        resume: 'confirming',
        pending: { summary: intent.summary, ops: intent.ops },
        choice: null,
        understood: intent.summary,
        prompt: PROMPT.confirming,
      })
    }

    case 'ask_which': {
      const candidates = intent.candidates.filter((c) => numberOf(s.doc, c.blockId) > 0)
      if (candidates.length < 2) return done(toResume(s, 'I could not tell which part you meant. Say it another way.'))
      return done({
        ...s,
        mode: 'choosing',
        resume: 'choosing',
        pending: null,
        choice: { utterance: s.asked, question: intent.question, candidates },
        understood: intent.question,
        prompt: choosingPrompt(candidates.length),
      })
    }

    case 'navigate': {
      const number = numberOf(s.doc, intent.blockId)
      if (number === 0) return done(toResume(s, 'I could not find that place.'))
      if (!intent.readAloud) return done({ ...toResume(s, `Paragraph ${number}.`), focusId: intent.blockId })
      const state: Session = {
        ...toResume(s, `Reading paragraph ${number}.`),
        focusId: intent.blockId,
        reading: true,
        prompt: PROMPT.reading,
      }
      return { state, effects: [{ type: 'speak', text: sectionText(s.doc, intent.blockId) }] }
    }

    case 'not_understood':
      return done(toResume(s, intent.message))
  }
}

/** What one utterance does in the three modes that accept speech. The session is already counted. */
function handle(s: Session, heard: string, quick: Quick | null): StepResult {
  if (quick?.kind === 'sleep') return done(sleep(s))
  if (quick?.kind === 'wake') return done({ ...s, understood: 'Already listening.' })
  if (quick?.kind === 'help') return done({ ...s, help: true, understood: 'Here is what you can say.' })

  switch (s.mode) {
    case 'listening': {
      if (quick?.kind === 'undo') {
        const previous = s.history.at(-1)
        if (!previous) return done({ ...s, understood: 'Nothing to undo.' })
        const undone = s.log.at(-1) ?? 'the last edit'
        return done({
          ...s,
          doc: previous,
          history: s.history.slice(0, -1),
          log: s.log.slice(0, -1),
          understood: `Undone: ${undone}`,
        })
      }
      if (quick?.kind === 'number') {
        const block = s.doc[quick.n - 1]
        if (!block) return done({ ...s, understood: `There is no paragraph ${quick.n}.` })
        return done({ ...s, focusId: block.id, understood: `Paragraph ${quick.n}.` })
      }
      if (quick?.kind === 'yes' || quick?.kind === 'no') return done({ ...s, understood: 'Nothing to confirm.' })

      const local = localIntent(heard, s.doc, s.focusId)
      if (local) return onIntent({ ...s, resume: 'listening' }, local)
      return ask(s, heard, { pending: null, choice: null }, 'listening')
    }

    case 'confirming': {
      if (quick?.kind === 'yes') return done(accept(s))
      if (quick?.kind === 'no' || quick?.kind === 'undo') return done(toListening(s, 'Discarded. Nothing changed.'))
      const local = localIntent(heard, s.doc, s.focusId)
      if (local?.kind === 'navigate') return onIntent({ ...s, resume: 'confirming' }, local)
      return ask(s, heard, { pending: s.pending, choice: null }, 'confirming')
    }

    case 'choosing': {
      const choice = s.choice
      if (!choice) return done(toListening(s, 'Nothing to choose.'))
      if (quick?.kind === 'no' || quick?.kind === 'undo') return done(toListening(s, 'Dropped. Nothing changed.'))
      if (quick?.kind === 'number') {
        if (quick.n > choice.candidates.length) {
          return done({ ...s, understood: `There are ${choice.candidates.length} to choose from.` })
        }
        const context = { utterance: choice.utterance, candidates: choice.candidates, picked: quick.n - 1 }
        return ask(s, choice.utterance, { pending: null, choice: context }, 'choosing')
      }
      const local = localIntent(heard, s.doc, s.focusId)
      if (local?.kind === 'navigate') return onIntent({ ...s, resume: 'choosing' }, local)
      const context = { utterance: choice.utterance, candidates: choice.candidates, picked: null }
      return ask(s, heard, { pending: null, choice: context }, 'choosing')
    }

    // 'thinking' and 'asleep' never reach here.
    default:
      return done(s)
  }
}

function onUtterance(s: Session, text: string, source: 'voice' | 'typed'): StepResult {
  const heard = text.trim()
  if (heard === '') return done(s)
  if (s.mode === 'thinking') return done({ ...s, understood: 'One moment, still working on the last one.' })

  const quick = quickReply(heard, { expectNumber: s.mode === 'choosing' })
  if (s.mode === 'asleep' && quick?.kind !== 'wake') return done(s)

  const wasReading = s.reading
  const counted: Session = {
    ...s,
    heard,
    help: false,
    reading: false,
    words: s.words + wordCount(heard),
    hands: s.hands + (source === 'typed' ? 1 : 0),
  }
  // Anything heard while reading stops the reading first (spec section 18).
  const hush: Effect[] = wasReading ? [{ type: 'hush' }] : []

  if (counted.mode === 'asleep') return done(toListening(counted, 'Listening.'))
  if (quick?.kind === 'stop') {
    return { state: { ...toResume(counted, wasReading ? 'Stopped reading.' : 'Nothing is being read.') }, effects: hush }
  }

  const result = handle(counted, heard, quick)
  return { state: result.state, effects: [...hush, ...result.effects] }
}

function onKey(s: Session, key: 'confirm' | 'reject'): StepResult {
  if (s.mode === 'confirming') {
    const acted = { ...s, hands: s.hands + 1 }
    return done(key === 'confirm' ? accept(acted) : toListening(acted, 'Discarded. Nothing changed.'))
  }
  if (s.mode === 'choosing' && key === 'reject') {
    return done(toListening({ ...s, hands: s.hands + 1 }, 'Dropped. Nothing changed.'))
  }
  return done(s)
}

/**
 * The whole conversation logic. Pure: returns the next session and the effects to run.
 * See the transition tables in docs/ARCHITECTURE.md sections 8 and 18.
 */
export function step(s: Session, e: Event): StepResult {
  switch (e.type) {
    case 'utterance':
      return onUtterance(s, e.text, e.source)
    case 'key':
      return onKey(s, e.key)
    case 'intent':
      if (s.mode !== 'thinking' || e.seq !== s.seq) return done(s)
      return onIntent(s, e.intent)
    case 'interpretFailed':
      if (s.mode !== 'thinking' || e.seq !== s.seq) return done(s)
      return done(toResume(s, e.message))
    case 'speechEnded':
      return done(s.reading ? { ...s, reading: false, prompt: s.mode === 'listening' ? PROMPT.listening : s.prompt } : s)
  }
}
