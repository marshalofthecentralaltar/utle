import type { Candidate } from './candidates.ts'
import { numberOf } from './document.ts'
import type { Doc } from './document.ts'
import type { Intent, InterpretRequest, Pending } from './intent.ts'
import { applyOps } from './ops.ts'
import { quickReply } from './quickReply.ts'

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

export type Effect = { type: 'interpret'; seq: number; request: InterpretRequest }

export interface StepResult {
  state: Session
  effects: Effect[]
}

const PROMPT = {
  listening: 'Say what to change, or a paragraph number.',
  thinking: 'Working on it.',
  confirming: 'Say yes or no, or only the word to change.',
  asleep: 'Say wake up to continue.',
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

function onUtterance(s: Session, text: string, source: 'voice' | 'typed'): StepResult {
  const heard = text.trim()
  if (heard === '') return done(s)
  if (s.mode === 'thinking') return done({ ...s, understood: 'One moment, still working on the last one.' })

  const quick = quickReply(heard, { expectNumber: s.mode === 'choosing' })
  if (s.mode === 'asleep') {
    if (quick?.kind !== 'wake') return done(s)
  }

  const counted: Session = {
    ...s,
    heard,
    words: s.words + wordCount(heard),
    hands: s.hands + (source === 'typed' ? 1 : 0),
  }

  if (counted.mode === 'asleep') return done(toListening(counted, 'Listening.'))
  if (quick?.kind === 'sleep') return done(sleep(counted))
  if (quick?.kind === 'wake') return done({ ...counted, understood: 'Already listening.' })

  switch (counted.mode) {
    case 'listening': {
      if (quick?.kind === 'undo') {
        const previous = counted.history.at(-1)
        if (!previous) return done({ ...counted, understood: 'Nothing to undo.' })
        const undone = counted.log.at(-1) ?? 'the last edit'
        return done({
          ...counted,
          doc: previous,
          history: counted.history.slice(0, -1),
          log: counted.log.slice(0, -1),
          understood: `Undone: ${undone}`,
        })
      }
      if (quick?.kind === 'number') {
        const block = counted.doc[quick.n - 1]
        if (!block) return done({ ...counted, understood: `There is no paragraph ${quick.n}.` })
        return done({ ...counted, focusId: block.id, understood: `Paragraph ${quick.n}.` })
      }
      if (quick?.kind === 'yes' || quick?.kind === 'no') {
        return done({ ...counted, understood: 'Nothing to confirm.' })
      }
      return ask(counted, heard, { pending: null, choice: null }, 'listening')
    }

    case 'confirming': {
      if (quick?.kind === 'yes') return done(accept(counted))
      if (quick?.kind === 'no' || quick?.kind === 'undo') {
        return done(toListening(counted, 'Discarded. Nothing changed.'))
      }
      return ask(counted, heard, { pending: counted.pending, choice: null }, 'confirming')
    }

    case 'choosing': {
      const choice = counted.choice
      if (!choice) return done(toListening(counted, 'Nothing to choose.'))
      if (quick?.kind === 'no' || quick?.kind === 'undo') {
        return done(toListening(counted, 'Dropped. Nothing changed.'))
      }
      if (quick?.kind === 'number') {
        if (quick.n > choice.candidates.length) {
          return done({ ...counted, understood: `There are ${choice.candidates.length} to choose from.` })
        }
        const context = { utterance: choice.utterance, candidates: choice.candidates, picked: quick.n - 1 }
        return ask(counted, choice.utterance, { pending: null, choice: context }, 'choosing')
      }
      const context = { utterance: choice.utterance, candidates: choice.candidates, picked: null }
      return ask(counted, heard, { pending: null, choice: context }, 'choosing')
    }

    // 'thinking' and 'asleep' returned above; the compiler cannot see that through the copy.
    default:
      return done(counted)
  }
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
      return done({ ...toResume(s, `Paragraph ${number}.`), focusId: intent.blockId })
    }

    case 'not_understood':
      return done(toResume(s, intent.message))
  }
}

/**
 * The whole conversation logic. Pure: returns the next session and the effects to run.
 * See the transition table in docs/ARCHITECTURE.md section 8.
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
  }
}
