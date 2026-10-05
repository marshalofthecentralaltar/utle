import type { BrowserCommand, BrowserResult } from '../browser/protocol.ts'
import { browserIntent } from './browserIntent.ts'
import type { Candidate } from './candidates.ts'
import { numberOf, sampleDoc } from './document.ts'
import type { Doc } from './document.ts'
import type { Intent, InterpretRequest, Pending } from './intent.ts'
import { localIntent, sectionText } from './localIntent.ts'
import { asSentence, messageCommand } from './message.ts'
import type { MessageCommand } from './message.ts'
import { applyOps } from './ops.ts'
import { quickReply } from './quickReply.ts'
import type { Quick } from './quickReply.ts'
import { STRINGS } from './strings.ts'
import type { Lang, Strings } from './strings.ts'

export type Mode = 'listening' | 'thinking' | 'confirming' | 'choosing' | 'asleep' | 'confirmingSend' | 'sending'

/** A "which one" question waiting for a number. utterance is the instruction that raised it. */
export interface Choice {
  utterance: string
  question: string
  candidates: Candidate[]
}

/** The document a message draft replaced, kept to come back when the draft is sent or dropped. */
export interface Saved {
  doc: Doc
  history: Doc[]
  log: string[]
  focusId: string | null
}

/** A message being written. to is null when it goes into whatever message box is focused. */
export interface Draft {
  to: string | null
  saved: Saved
}

export interface Session {
  /** The language of every line shown, and of the interpreter's replies. */
  lang: Lang
  /** Set while a message is being written; doc is then the draft. */
  draft: Draft | null
  /** True while numbered labels are showing in the browser. */
  hints: boolean
  /** Id of the latest browser command. A result with any other seq is ignored. */
  bridgeSeq: number
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
  /** What the user can say next. Derived from the mode at the end of every step. */
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
  | { type: 'language'; lang: Lang }
  | { type: 'browserResult'; seq: number; command: BrowserCommand; result: BrowserResult }

export type Effect =
  | { type: 'interpret'; seq: number; request: InterpretRequest }
  /** Read this text aloud. */
  | { type: 'speak'; text: string }
  /** Stop reading aloud. */
  | { type: 'hush' }
  /** Send this command to the browser extension and dispatch a browserResult with the same seq. */
  | { type: 'browser'; seq: number; command: BrowserCommand }

export interface StepResult {
  state: Session
  effects: Effect[]
}

function promptOf(s: Session): string {
  const t = STRINGS[s.lang]
  switch (s.mode) {
    case 'asleep':
      return t.promptAsleep
    case 'thinking':
      return t.promptThinking
    case 'sending':
      return t.promptSending
    default:
      break
  }
  if (s.reading) return t.promptReading
  switch (s.mode) {
    case 'confirming':
      return t.promptConfirming
    case 'choosing':
      return t.promptChoosing(s.choice?.candidates.length ?? 0)
    case 'confirmingSend':
      return t.promptConfirmSend
    default:
      return s.draft ? t.promptDraft : t.promptListening
  }
}

/** lang defaults to English so the existing tests read as written; the page passes Estonian. */
export function initialSession(doc: Doc, lang: Lang = 'en'): Session {
  const s: Session = {
    lang,
    draft: null,
    hints: false,
    bridgeSeq: 0,
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
    understood: STRINGS[lang].waiting,
    prompt: '',
    words: 0,
    hands: 0,
    seq: 0,
    asked: '',
  }
  return { ...s, prompt: promptOf(s) }
}

function done(state: Session): StepResult {
  return { state, effects: [] }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function str(s: Session): Strings {
  return STRINGS[s.lang]
}

/** Back to listening with nothing pending. */
function toListening(s: Session, understood: string): Session {
  return { ...s, mode: 'listening', resume: 'listening', pending: null, choice: null, understood }
}

/** Back to the mode the request started from, with the proposal or question intact (principle P4). */
function toResume(s: Session, understood: string): Session {
  if (s.resume === 'confirming' && s.pending) return { ...s, mode: 'confirming', understood }
  if (s.resume === 'choosing' && s.choice) return { ...s, mode: 'choosing', understood }
  return toListening(s, understood)
}

function ask(
  s: Session,
  utterance: string,
  context: Pick<InterpretRequest, 'pending' | 'choice'>,
  resume: Session['resume'],
): StepResult {
  const seq = s.seq + 1
  const state: Session = { ...s, mode: 'thinking', resume, seq, asked: utterance }
  const request: InterpretRequest = {
    doc: s.doc,
    utterance,
    pending: context.pending,
    choice: context.choice,
    lang: s.lang,
    message: s.draft ? { to: s.draft.to } : null,
  }
  return { state, effects: [{ type: 'interpret', seq, request }] }
}

function accept(s: Session): Session {
  const t = str(s)
  if (!s.pending) return toListening(s, t.nothingToConfirm)
  const result = applyOps(s.doc, s.pending.ops)
  if (!result.ok) return toListening(s, t.noLongerFits)
  return {
    ...toListening(s, t.saved),
    doc: result.doc,
    history: [...s.history, s.doc],
    log: [...s.log, s.pending.summary],
  }
}

function sleep(s: Session): Session {
  return { ...s, mode: 'asleep', resume: 'listening', pending: null, choice: null, focusId: null, understood: str(s).asleep }
}

/** Commands that put another page in front clear the numbered labels. */
const KEEPS_HINTS = new Set<BrowserCommand['kind']>(['showHints', 'scroll', 'ping'])

/** Sends a command to the browser. The mode, the proposal and the question stay as they are. */
function browse(s: Session, command: BrowserCommand): StepResult {
  const bridgeSeq = s.bridgeSeq + 1
  const state: Session = {
    ...s,
    bridgeSeq,
    hints: KEEPS_HINTS.has(command.kind) ? s.hints : false,
    understood: str(s).browserDoing(command),
  }
  return { state, effects: [{ type: 'browser', seq: bridgeSeq, command }] }
}

/** The draft's text as one line, so a line break never presses Enter early. */
function draftText(doc: Doc): string {
  return doc
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(' ')
}

/** The saved document comes back and the draft is gone. */
function restore(s: Session, understood: string): Session {
  const saved = s.draft?.saved
  if (!saved) return toListening(s, understood)
  return {
    ...toListening(s, understood),
    draft: null,
    doc: saved.doc,
    history: saved.history,
    log: saved.log,
    focusId: saved.focusId,
  }
}

/** Words for an empty draft, proposed as its text without the model. */
function dictation(s: Session, text: string): Intent {
  return {
    kind: 'propose_edit',
    summary: str(s).draftTextSummary,
    ops: [{ op: 'insert_block', afterBlockId: null, blockType: 'p', text: asSentence(text) }],
  }
}

function startDraft(s: Session, to: string | null, text: string | null): StepResult {
  const t = str(s)
  if (s.draft) return done({ ...s, understood: t.draftAlreadyOpen })
  const saved: Saved = { doc: s.doc, history: s.history, log: s.log, focusId: s.focusId }
  const opened: Session = {
    ...toListening(s, t.draftStarted(to)),
    draft: { to, saved },
    doc: [],
    history: [],
    log: [],
    focusId: null,
  }
  if (text === null || text === '') return done(opened)
  const result = onIntent(opened, dictation(opened, text))
  return { ...result, state: { ...result.state, understood: t.draftStarted(to) } }
}

function beginSend(s: Session): StepResult {
  const draft = s.draft
  if (!draft) return done(toListening(s, str(s).noDraft))
  const text = draftText(s.doc)
  const command: BrowserCommand = draft.to
    ? { kind: 'openConversation', name: draft.to }
    : { kind: 'insertText', text, submit: true }
  const bridgeSeq = s.bridgeSeq + 1
  const state: Session = { ...s, mode: 'sending', bridgeSeq, hints: false, understood: str(s).browserDoing(command) }
  return { state, effects: [{ type: 'browser', seq: bridgeSeq, command }] }
}

/** Start, send or drop a message. Null when the command does not apply and the utterance goes on. */
function onMessage(s: Session, m: MessageCommand): StepResult | null {
  const t = str(s)
  switch (m.kind) {
    case 'start':
      return startDraft(s, m.to, m.text)
    case 'drop':
      return done(s.draft ? restore(s, t.draftDropped) : { ...s, understood: t.noDraft })
    case 'send': {
      if (!s.draft) return done({ ...s, understood: t.noDraft })
      if (s.mode === 'confirming' || s.mode === 'choosing') return done({ ...s, understood: t.answerFirst })
      if (s.mode === 'confirmingSend') return done({ ...s, understood: t.sendYesOrNo })
      const text = draftText(s.doc)
      if (text === '') return done({ ...s, understood: t.draftEmpty })
      return done({ ...s, mode: 'confirmingSend', focusId: null, understood: t.confirmSend(s.draft.to, text) })
    }
  }
}

function onBrowserResult(s: Session, seq: number, command: BrowserCommand, result: BrowserResult): StepResult {
  if (seq !== s.bridgeSeq) return done(s)
  const t = str(s)

  if (s.mode === 'sending') {
    if (!result.ok) return done(toListening(s, t.sendFailed(t.browserFailed(command, result.code))))
    if (command.kind === 'openConversation') {
      const next: BrowserCommand = { kind: 'insertText', text: draftText(s.doc), submit: true }
      const bridgeSeq = s.bridgeSeq + 1
      return { state: { ...s, bridgeSeq, understood: t.browserDoing(next) }, effects: [{ type: 'browser', seq: bridgeSeq, command: next }] }
    }
    return done(restore(s, t.sent(s.draft?.to ?? null)))
  }

  if (!result.ok) {
    return done({ ...s, hints: command.kind === 'showHints' ? false : s.hints, understood: s.mode === 'asleep' ? s.understood : t.browserFailed(command, result.code) })
  }
  const hints = command.kind === 'showHints' ? true : s.hints
  if (s.mode === 'asleep') return done({ ...s, hints })
  return done({ ...s, hints, understood: t.browserDone(command, result.tab?.title ?? null, result.hints ?? null) })
}

/** Acts on an Intent, whether it came from the interpreter or from a local command. */
function onIntent(s: Session, intent: Intent): StepResult {
  const t = str(s)
  switch (intent.kind) {
    case 'propose_edit': {
      const result = applyOps(s.doc, intent.ops)
      if (!result.ok) return done(toResume(s, t.didNotFit))
      return done({
        ...s,
        mode: 'confirming',
        resume: 'confirming',
        pending: { summary: intent.summary, ops: intent.ops },
        choice: null,
        understood: intent.summary,
      })
    }

    case 'ask_which': {
      const candidates = intent.candidates.filter((c) => numberOf(s.doc, c.blockId) > 0)
      if (candidates.length < 2) return done(toResume(s, t.couldNotTell))
      return done({
        ...s,
        mode: 'choosing',
        resume: 'choosing',
        pending: null,
        choice: { utterance: s.asked, question: intent.question, candidates },
        understood: intent.question,
      })
    }

    case 'navigate': {
      const number = numberOf(s.doc, intent.blockId)
      if (number === 0) return done(toResume(s, t.placeNotFound))
      if (!intent.readAloud) return done({ ...toResume(s, t.paragraph(number)), focusId: intent.blockId })
      const state: Session = { ...toResume(s, t.readingParagraph(number)), focusId: intent.blockId, reading: true }
      return { state, effects: [{ type: 'speak', text: sectionText(s.doc, intent.blockId) }] }
    }

    case 'not_understood':
      return done(toResume(s, intent.message))
  }
}

/** What one utterance does in the modes that accept speech. The session is already counted. */
function handle(s: Session, heard: string, quick: Quick | null): StepResult {
  const t = str(s)
  if (quick?.kind === 'sleep') return done(sleep(s))
  if (quick?.kind === 'wake') return done({ ...s, understood: t.alreadyListening })
  if (quick?.kind === 'help') return done({ ...s, help: true, understood: t.helpShown })

  // While numbered labels show in the browser, a bare number clicks one (section 20.3).
  if (s.hints && quick?.kind === 'number' && s.mode !== 'choosing') return browse(s, { kind: 'clickHint', number: quick.n })

  if (s.mode === 'confirmingSend') {
    if (quick?.kind === 'yes') return beginSend(s)
    if (quick?.kind === 'no' || quick?.kind === 'undo') return done(toListening(s, t.sendCancelled))
    const message = messageCommand(heard)
    if (message?.kind === 'drop') return done(restore(s, t.draftDropped))
    return done({ ...s, understood: t.sendYesOrNo })
  }

  if (!quick) {
    const message = messageCommand(heard)
    const handled = message ? onMessage(s, message) : null
    if (handled) return handled
  }

  const local = (): Intent | null => localIntent(heard, s.doc, s.focusId, s.lang)
  const browser = (): BrowserCommand | null => browserIntent(heard)

  switch (s.mode) {
    case 'listening': {
      if (quick?.kind === 'undo') {
        const previous = s.history.at(-1)
        if (!previous) return done({ ...s, understood: t.nothingToUndo })
        const undone = s.log.at(-1) ?? t.lastEdit
        return done({
          ...s,
          doc: previous,
          history: s.history.slice(0, -1),
          log: s.log.slice(0, -1),
          understood: t.undone(undone),
        })
      }
      if (quick?.kind === 'number') {
        const block = s.doc[quick.n - 1]
        if (!block) return done({ ...s, understood: t.noParagraph(quick.n) })
        return done({ ...s, focusId: block.id, understood: t.paragraph(quick.n) })
      }
      if (quick?.kind === 'yes' || quick?.kind === 'no') return done({ ...s, understood: t.nothingToConfirm })

      const intent = local()
      if (intent) return onIntent({ ...s, resume: 'listening' }, intent)
      const command = browser()
      if (command) return browse(s, command)
      if (s.draft && s.doc.length === 0) return onIntent({ ...s, resume: 'listening' }, dictation(s, heard))
      return ask(s, heard, { pending: null, choice: null }, 'listening')
    }

    case 'confirming': {
      if (quick?.kind === 'yes') return done(accept(s))
      if (quick?.kind === 'no' || quick?.kind === 'undo') return done(toListening(s, t.discarded))
      const intent = local()
      if (intent?.kind === 'navigate') return onIntent({ ...s, resume: 'confirming' }, intent)
      const command = browser()
      if (command) return browse(s, command)
      return ask(s, heard, { pending: s.pending, choice: null }, 'confirming')
    }

    case 'choosing': {
      const choice = s.choice
      if (!choice) return done(toListening(s, t.nothingToChoose))
      if (quick?.kind === 'no' || quick?.kind === 'undo') return done(toListening(s, t.dropped))
      if (quick?.kind === 'number') {
        if (quick.n > choice.candidates.length) return done({ ...s, understood: t.countToChoose(choice.candidates.length) })
        const context = { utterance: choice.utterance, candidates: choice.candidates, picked: quick.n - 1 }
        return ask(s, choice.utterance, { pending: null, choice: context }, 'choosing')
      }
      const intent = local()
      if (intent?.kind === 'navigate') return onIntent({ ...s, resume: 'choosing' }, intent)
      const command = browser()
      if (command) return browse(s, command)
      const context = { utterance: choice.utterance, candidates: choice.candidates, picked: null }
      return ask(s, heard, { pending: null, choice: context }, 'choosing')
    }

    // 'thinking', 'sending' and 'asleep' never reach here.
    default:
      return done(s)
  }
}

function onUtterance(s: Session, text: string, source: 'voice' | 'typed'): StepResult {
  const heard = text.trim()
  if (heard === '') return done(s)
  const t = str(s)
  if (s.mode === 'thinking' || s.mode === 'sending') return done({ ...s, understood: t.stillWorking })

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

  if (counted.mode === 'asleep') return done(toListening(counted, t.listeningAgain))
  if (quick?.kind === 'stop') {
    return { state: toResume(counted, wasReading ? t.stoppedReading : t.nothingRead), effects: hush }
  }

  const result = handle(counted, heard, quick)
  return { state: result.state, effects: [...hush, ...result.effects] }
}

function onKey(s: Session, key: 'confirm' | 'reject'): StepResult {
  const t = str(s)
  if (s.mode === 'confirming') {
    const acted = { ...s, hands: s.hands + 1 }
    return done(key === 'confirm' ? accept(acted) : toListening(acted, t.discarded))
  }
  if (s.mode === 'confirmingSend') {
    const acted = { ...s, hands: s.hands + 1 }
    return key === 'confirm' ? beginSend(acted) : done(toListening(acted, t.sendCancelled))
  }
  if (s.mode === 'choosing' && key === 'reject') {
    return done(toListening({ ...s, hands: s.hands + 1 }, t.dropped))
  }
  return done(s)
}

function sameDoc(a: Doc, b: Doc): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

function onLanguage(s: Session, lang: Lang): StepResult {
  if (lang === s.lang) return done(s)
  const untouched = s.history.length === 0 && s.draft === null && s.mode === 'listening' && sameDoc(s.doc, sampleDoc(s.lang))
  return done({
    ...s,
    lang,
    doc: untouched ? sampleDoc(lang) : s.doc,
    focusId: untouched ? null : s.focusId,
    understood: s.heard === '' ? STRINGS[lang].waiting : s.understood,
  })
}

function inner(s: Session, e: Event): StepResult {
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
      return done(s.reading ? { ...s, reading: false } : s)
    case 'language':
      return onLanguage(s, e.lang)
    case 'browserResult':
      return onBrowserResult(s, e.seq, e.command, e.result)
  }
}

/**
 * The whole conversation logic. Pure: returns the next session and the effects to run.
 * See the transition tables in docs/ARCHITECTURE.md sections 8, 18 and 20.3.
 */
export function step(s: Session, e: Event): StepResult {
  const result = inner(s, e)
  const prompt = promptOf(result.state)
  return result.state.prompt === prompt ? result : { ...result, state: { ...result.state, prompt } }
}
