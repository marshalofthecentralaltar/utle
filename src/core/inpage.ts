import type { BoxState, BrowserCommand, BrowserFailure, BrowserResult, PageContext, PressableKey } from '../browser/protocol.ts'
import type { PageIntent } from './pageIntent.ts'
import { BRIDGE_TIMED_OUT, BROWSER_PHRASES, browserUnderstood, SITES } from './browserIntent.ts'
import { endsWithConnective } from './chain.ts'
import { messageCommand, nameFromSpoken } from './message.ts'
import { soundsLike } from './phonetic.ts'
import { normalise, quickReply, spokenNumber } from './quickReply.ts'
import { STRINGS } from './strings.ts'
import type { Lang, Strings } from './strings.ts'

/**
 * In-page mode (docs/ARCHITECTURE.md section 21): the user stays on the site he is writing in.
 * What he says is typed straight into that site's message box, repaired there, and sent from
 * there; the same voice moves around the browser. This module decides what one utterance does.
 * Pure: the extension reads the box, calls step, and carries out the commands in order.
 *
 * THIS FILE IS THE CONTRACT between the core lane (which implements step) and the extension lane
 * (which calls it). The types and the two function signatures do not change without both.
 */

export interface InpageSession {
  lang: Lang
  /** While asleep everything is ignored except the wake phrase. */
  asleep: boolean
  /** True while numbered labels are showing on the page. */
  hints: boolean
  /** Earlier texts of the message box, newest last, for "võta tagasi". */
  undo: string[]
}

export interface InpageStep {
  session: InpageSession
  /**
   * Commands for the page in front, to run in order. The extension stops at the first failure
   * and reports it with inpageResult. Empty when the utterance changed nothing on the page.
   */
  commands: BrowserCommand[]
  /** One short line for the strip, in the session's language: what was understood or done. */
  line: string
  /**
   * M7: the rules took the utterance for dictation. An extension with a model asks it what was
   * meant (readPage, POST /api/intent, applyIntent) and runs that step instead of this one; without
   * a model, or when the model cannot tell, this step stands.
   */
  ask?: boolean
  /** Round 5: "katkesta": the engine drops every job, chain and verification in flight and clears the bar. */
  cancel?: boolean
}

export function initialInpage(lang: Lang): InpageSession {
  return { lang, asleep: false, hints: false, undo: [] }
}

/**
 * What one utterance does. box is the message box of the page in front as it was when the
 * utterance ended (present false when the page has no text field; armed false when the field is
 * one the page focused by itself, where nothing is typed, M7).
 */
export function inpageStep(session: InpageSession, utterance: string, box: BoxState): InpageStep {
  const classified = classify(session, utterance)
  const spoken: Action = { kind: 'dictate', text: utterance.trim().replace(/\s+/g, ' ') }
  // One ordinary word while he is writing is a word of the message, not a command (section 22, "Soft words").
  // With the labels showing he is navigating, not writing: "stopp" hides them whatever the box holds.
  const soft = classified.action.kind === 'browser' && !session.hints && SOFT_WORDS.has(normalise(utterance)) && box.present && box.armed && box.text.trim() !== ''
  // "mine X juurde", "vali X": the caret or a selection only when X is in the box; else the words go to the model,
  // which may mean a section of the page or a choice in a list (round 3, editing).
  const wanted = classified.action.kind === 'browser' ? findOf(classified.action.command) : classified.action.kind === 'deleteNamed' ? classified.action.find : null
  const missing = wanted !== null && !textHas(box, wanted)
  const action: Action = soft || missing ? spoken : classified.action
  const understood = soft || missing ? null : classified.understood
  const step = act(session, action, box)
  const asked = action.kind === 'dictate' ? { ...step, ask: true } : step
  if (understood === null) return asked
  return { ...asked, line: `${STRINGS[session.lang].inpage.understood(understood)} ${asked.line}` }
}

/**
 * M7: the step for what the model said an utterance meant (docs/plans/2026-10-05-m7-understanding.md).
 * The intent has passed pageIntentFrom. It goes through the same act as the rules, so undo, the
 * labels and the lines behave the same. say is the model's short line about what it took the words
 * to be; it comes first when it is not empty.
 */
export function applyIntent(session: InpageSession, intent: PageIntent, page: PageContext, say = ''): InpageStep {
  const s = STRINGS[session.lang]
  const box = page.box
  const action = intentAction(intent)
  const step = action === null ? { session, commands: [], line: intent.kind === 'unclear' ? intent.say || s.inpage.notUnderstood : s.inpage.notUnderstood } : act(session, action, box)
  return say === '' ? step : { ...step, line: `${s.inpage.understood(say)} ${step.line}` }
}

function intentAction(intent: PageIntent): Action | null {
  switch (intent.kind) {
    case 'dictate':
      return { kind: 'dictate', text: intent.text.trim().replace(/\s+/g, ' ') }
    case 'command':
      return { kind: 'browser', command: intent.command }
    case 'send':
      return { kind: 'send' }
    case 'sleep':
      return { kind: 'sleep' }
    case 'wake':
      return { kind: 'wake' }
    case 'unclear':
      return null
    case 'edit': {
      const e = intent.edit
      if (e.kind === 'undo') return { kind: 'undo' }
      if (e.kind === 'replace') return { kind: 'edit', edit: { kind: 'replace', from: e.from, to: e.to, loose: false } }
      return { kind: 'edit', edit: { kind: e.kind } }
    }
  }
}

/**
 * The line to show after the commands of a step ran: result is the first failure, or the last
 * success. Also keeps the session true to the page (for example hints off after a failed showHints).
 */
export function inpageResult(
  session: InpageSession,
  commands: readonly BrowserCommand[],
  result: BrowserResult,
): { session: InpageSession; line: string } {
  const s = STRINGS[session.lang]
  const first = commands[0]
  const last = commands.at(-1)
  if (first === undefined || last === undefined) return { session, line: '' }
  const typed = commands.find((c) => c.kind === 'setText')
  // An undo types the newest undo entry; every other setText pushed the old text first (section 21.1).
  const wasUndo = typed?.kind === 'setText' && session.undo.at(-1) === typed.text

  if (result.ok) {
    let undo = wasUndo ? session.undo.slice(0, -1) : session.undo
    if (last.kind === 'pressSend') undo = []
    const hints = last.kind === 'showHints' ? true : session.hints
    const opened = commands.find((c) => c.kind === 'openConversation')
    let line: string
    if (last.kind === 'pressSend') line = s.inpage.sent
    else if (opened?.kind === 'openConversation') line = s.inpage.conversationOpen(opened.name)
    else if (last.kind === 'setText') line = s.inpage.written
    else line = s.browserDone(last, result.tab?.title ?? null, result.hints ?? null)
    return { session: { ...session, undo, hints }, line }
  }

  // The extension stops at the first failure; only the one-breath form has two commands, and when
  // its openConversation fails the setText never ran, so the first command is taken as the failed one.
  const edited = commands.some((c) => pushesUndo(c))
  const undo = (typed !== undefined && !wasUndo) || (typed === undefined && edited) ? session.undo.slice(0, -1) : session.undo
  const hints = first.kind === 'showHints' ? false : session.hints
  return { session: { ...session, undo, hints }, line: failureLine(s, first, result.code, result.message) }
}

function failureLine(s: Strings, command: BrowserCommand, code: BrowserFailure, message: string): string {
  if (code === 'failed' && message === BRIDGE_TIMED_OUT) {
    return command.kind === 'pressSend' ? s.sendTimedOut : s.browserTimedOut
  }
  const box = command.kind === 'setText' || command.kind === 'pressSend' || command.kind === 'readBox'
  const reason = box && code === 'not_found' ? s.inpage.boxNotFound : s.browserFailed(command, code)
  return command.kind === 'pressSend' ? s.inpage.notSent(reason) : reason
}

/** True for an utterance that should not wait to be joined with more speech: a command, not dictation. */
export function inpageInstant(session: InpageSession, utterance: string): boolean {
  // Round 4: "keri alla ja" promises more; it waits for the rest of the chain.
  if (endsWithConnective(utterance)) return false
  const kind = classify(session, utterance).action.kind
  return kind !== 'dictate' && kind !== 'oneBreath' && kind !== 'empty'
}

// ---------------------------------------------------------------------------------------------
// Private: what an utterance means (classify) and what it does to the box (act). Section 21.1.

type Action =
  | { kind: 'empty' }
  | { kind: 'ignored' }
  | { kind: 'sleep' }
  | { kind: 'wake' }
  /** repeat: the same command that many times ("kolm sõna tagasi"); absent is once. */
  | { kind: 'browser'; command: BrowserCommand; repeat?: number }
  | { kind: 'open'; name: string }
  | { kind: 'oneBreath'; name: string; text: string }
  | { kind: 'sayWho' }
  | { kind: 'send' }
  | { kind: 'undo' }
  /** M7: "tagasi" / "back": undo when there are words to take back, else the page history. */
  | { kind: 'back' }
  /** Round 3: "kustuta sõna X": select the word in the box, then Backspace. */
  | { kind: 'deleteNamed'; find: string }
  | { kind: 'edit'; edit: Edit }
  | { kind: 'dictate'; text: string }
  /** Round 5: "katkesta": the engine drops everything in flight. Instant, never previewed, never soft. */
  | { kind: 'cancel' }

type Edit =
  | { kind: 'replace'; from: string; to: string; loose: boolean }
  | { kind: 'deleteWord' }
  | { kind: 'deleteSentence' }
  | { kind: 'clear' }
  | { kind: 'newLine' }
  | { kind: 'mark'; mark: string }

const UNDO_LIMIT = 30

const EDITS: Record<string, Edit> = {}
function edits(edit: Edit, ...list: string[]): void {
  for (const phrase of list) EDITS[phrase] = edit
}
edits({ kind: 'deleteWord' }, 'kustuta viimane sõna', 'delete the last word', 'delete last word')
edits({ kind: 'deleteSentence' }, 'kustuta viimane lause', 'delete the last sentence', 'delete last sentence')
edits(
  { kind: 'clear' },
  'kustuta kõik',
  'tühjenda',
  'alusta uuesti',
  'katkesta sõnum',
  'delete everything',
  'clear',
  'clear everything',
  'start again',
  'cancel the message',
)
edits({ kind: 'newLine' }, 'uus rida', 'reavahetus', 'new line')
edits({ kind: 'mark', mark: '.' }, 'punkt', 'full stop', 'period')
edits({ kind: 'mark', mark: ',' }, 'koma', 'comma')
edits({ kind: 'mark', mark: '?' }, 'küsimärk', 'question mark')
edits({ kind: 'mark', mark: '!' }, 'hüüumärk', 'exclamation mark')

/** "mitte X, vaid Y" and its kin: [pattern, loose]. Loose: the genitive of "X asemel Y" (section 21.1). */
const REPLACE: ReadonlyArray<readonly [RegExp, boolean]> = [
  [/^mitte\s+(.+?)\s*,?\s+vaid\s+(.+)$/iu, false],
  [/^asenda\s+(.+?)\s+sõnaga\s+(.+)$/iu, false],
  [/^(\S+(?:\s+\S+)?)\s*,?\s+asemel\s*,?\s+(\S+(?:\s+\S+)?)$/iu, true],
  [/^not\s+(.+?)\s*,?\s+but\s+(.+)$/iu, false],
  [/^replace\s+(.+?)\s+with\s+(.+)$/iu, false],
  [/^change\s+(.+?)\s+to\s+(.+)$/iu, false],
]

/** Bare words that mean the browser in this mode, where there is no document (section 21.1). */
const BARE_BROWSER: Record<string, BrowserCommand> = {
  järgmine: { kind: 'switchTab', to: 'next' },
  eelmine: { kind: 'switchTab', to: 'previous' },
  next: { kind: 'switchTab', to: 'next' },
  previous: { kind: 'switchTab', to: 'previous' },
}

/** M7 (section 22): undo while the armed box is being written in, else the page history. */
const BACK = new Set(['tagasi', 'back', 'go back'])

/**
 * M7 (section 22): one-word fixed phrases that are also ordinary words of a message ("välja", "siia",
 * "edasi", "enter"). While the armed box holds words they are dictation, so that a one-word answer
 * never presses Escape or Enter in the composer; with an empty or unarmed box they are the command.
 */
const SOFT_WORDS = new Set([
  'välja', 'siia', 'edasi', 'sulge', 'enter', 'sisesta', 'kinnita', 'paus', 'peata', 'mängi', 'esita',
  'close', 'play', 'pause', 'forward', 'escape',
  // Round 3: "aitab" and "lõpeta" are chat replies too; "stopp", "seis" and "stop" always stop (a slow scroll must be stoppable in one word).
  'aitab', 'lõpeta',
])

/** M7: "stopp" while the labels show hides them. */
const STOP = new Set(['stopp', 'stop', 'lõpeta'])

/** M7: while the labels show, "ava viis", "vali 5", "vajuta number viis", "open five" are the number. */
const HINT_PICK = /^(?:ava|vali|vajuta|klõpsa|kliki|number|open|choose|pick|select|click|press)(?: number)? (.+)$/u

const OPEN_ET_WITH = /^ava vestlus (?:koos )?(\p{L}+(?: \p{L}+)?)$/u
const OPEN_ET_OF = /^ava (\p{L}+(?: \p{L}+)?) vestlus$/u
const OPEN_EN = /^(?:open (?:the )?(?:chat|conversation) with|chat with|write to) (\p{L}+(?: \p{L}+)?)$/u

/** Allative pronouns after the name rule: "kirjuta mulle" is dictation, not a conversation. */
const PRONOUNS = new Set(['Mul', 'Sul', 'Tal', 'Mei', 'Tei', 'Nei', 'Enda'])

/** Commands that leave the numbered labels on the page (20.2; M7 adds the ones that touch nothing the labels sit on). */
const KEEPS_HINTS = new Set<BrowserCommand['kind']>([
  'showHints', 'scroll', 'ping', 'readBox', 'setText', 'pressSend', 'readPage', 'media', 'bar', 'arm', 'clearField',
])
/** Commands that leave the same message box in front, so the undo texts still belong to it. */
const KEEPS_BOX = new Set<BrowserCommand['kind']>([...KEEPS_HINTS, 'hideHints'])

// Round 3 (editing): the caret, a selection, typing at the caret and the editing keys all stay in the
// box in front; Escape, Enter and Tab leave it (a dialog closes, a form submits, the focus moves).
const LEAVING_KEYS = new Set<PressableKey>(['Escape', 'Enter', 'Tab'])
const EDITING_KINDS = new Set<BrowserCommand['kind']>(['caret', 'select', 'typeText'])

/** An editing command: it needs a box in front (act refuses it with pickField otherwise). */
function isEditing(c: BrowserCommand): boolean {
  return EDITING_KINDS.has(c.kind) || (c.kind === 'pressKey' && !LEAVING_KEYS.has(c.key))
}

function keepsHints(c: BrowserCommand): boolean {
  return KEEPS_HINTS.has(c.kind) || isEditing(c)
}

function keepsBox(c: BrowserCommand): boolean {
  return KEEPS_BOX.has(c.kind) || isEditing(c)
}

/** Commands that change the box text in a way the box undo of 21.1 can take back: the old text is pushed first. */
function pushesUndo(c: BrowserCommand): boolean {
  return c.kind === 'typeText' || (c.kind === 'pressKey' && (c.key === 'Backspace' || c.key === 'Delete'))
}

/** The text a caret or select command looks for, or null for the other commands. */
function findOf(c: BrowserCommand): string | null {
  if (c.kind === 'caret' && typeof c.to === 'object') return c.to.find
  if (c.kind === 'select' && typeof c.what === 'object') return c.what.find
  return null
}

/** True when the box holds the spoken words, or (one word, a case ending) a word they extend by one or two letters. */
function textHas(box: BoxState, spoken: string): boolean {
  if (!box.present) return false
  const text = box.text.toLocaleLowerCase()
  const needle = spoken.toLocaleLowerCase().trim()
  if (needle === '' || text.includes(needle)) return true
  if (/\s/u.test(needle)) return false
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].some((m) => {
    const word = m[0]
    const extra = needle.length - word.length
    return word.length >= 3 && extra >= 1 && extra <= 2 && needle.startsWith(word)
  })
}

/** Words that continue the sentence before; those in COMMA_BEFORE take a comma (21.1). */
const CONTINUES = new Set(['ja', 'ning', 'ega', 'või', 'aga', 'kuid', 'vaid', 'sest', 'et', 'kui', 'and', 'or', 'but', 'because', 'so', 'that'])
const COMMA_BEFORE = new Set(['aga', 'kuid', 'vaid', 'sest', 'et', 'but', 'because'])

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

function lowerInitial(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Spoken words as a whole-word pattern: any run of spaces between words. */
function wholeWords(words: string, flags: string): RegExp {
  const body = words.split(/\s+/).map(escapeRegExp).join('\\s+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, flags)
}

/** The comitative: the last word loses "-ga" (Mariga, Mari; Jaaniga, Jaani), then the name rule. */
function nameFromComitative(spoken: string): string {
  const words = spoken.split(' ')
  const last = words.at(-1)
  if (last !== undefined && last.length > 3 && last.endsWith('ga')) words[words.length - 1] = last.slice(0, -2)
  return nameFromSpoken(words.join(' '), 'en')
}

function conversation(utterance: string, clean: string): Action | null {
  const message = messageCommand(utterance)
  if (message?.kind === 'start') {
    if (message.to === null) return message.text === null ? { kind: 'sayWho' } : null
    if (PRONOUNS.has(message.to)) return null
    return message.text === null
      ? { kind: 'open', name: message.to }
      : { kind: 'oneBreath', name: message.to, text: message.text }
  }
  const withName = OPEN_ET_WITH.exec(clean)?.[1]
  if (withName !== undefined) return { kind: 'open', name: nameFromComitative(withName) }
  const ofName = (OPEN_ET_OF.exec(clean) ?? OPEN_EN.exec(clean))?.[1]
  if (ofName !== undefined) return { kind: 'open', name: nameFromSpoken(ofName, 'en') }
  return null
}

function stripQuotes(text: string): string {
  return text.replace(/^[\s„“”"'«»,]+|[\s„“”"'«»,.!?…]+$/gu, '')
}

function replaceEdit(utterance: string): Edit | null {
  const t = utterance.trim().replace(/[.!?…]+$/u, '')
  for (const [pattern, loose] of REPLACE) {
    const m = pattern.exec(t)
    if (m?.[1] && m[2]) {
      const from = stripQuotes(m[1])
      const to = stripQuotes(m[2])
      if (from !== '' && to !== '') return { kind: 'replace', from, to, loose }
    }
  }
  return null
}

/** What an utterance means, and what it was taken to be when an ending or a letter was corrected (21.3). */
interface Classified {
  action: Action
  understood: string | null
}

function classify(session: InpageSession, utterance: string): Classified {
  const exact = classifyExact(session, utterance)
  if (exact.action.kind !== 'dictate') return exact
  return misheard(session, utterance) ?? exact
}

function hintPick(clean: string): number | null {
  const rest = HINT_PICK.exec(clean)?.[1]
  return rest === undefined ? null : spokenNumber(rest)
}

// ---- Round 5 (BRAIN lane): the global voice escape. Only this block is the cancel rule. ----
/** "katkesta" and its kin: every job, chain and verification in flight is dropped, asleep or not. */
const CANCEL_ALL = new Set(['katkesta', 'tühista kõik', 'lõpeta kõik', 'stopp kõik', 'cancel', 'cancel everything'])
/** True for an utterance that is the global cancel, before anything else is tried. */
function isCancelAll(utterance: string): boolean {
  return CANCEL_ALL.has(normalise(utterance))
}
// ---- end of the cancel rule ----

function classifyExact(session: InpageSession, utterance: string): Classified {
  const plain = (action: Action): Classified => ({ action, understood: null })
  const quick = quickReply(utterance)
  if (isCancelAll(utterance)) return plain({ kind: 'cancel' })
  if (session.asleep) return plain(quick?.kind === 'wake' ? { kind: 'wake' } : { kind: 'ignored' })

  const clean = normalise(utterance)
  if (clean === '') return plain({ kind: 'empty' })
  if (quick?.kind === 'sleep') return plain({ kind: 'sleep' })
  if (quick?.kind === 'wake') return plain({ kind: 'wake' })
  if (session.hints) {
    const number = quick?.kind === 'number' ? quick.n : hintPick(clean)
    if (number !== null) return plain({ kind: 'browser', command: { kind: 'clickHint', number } })
    if (STOP.has(clean)) return plain({ kind: 'browser', command: { kind: 'hideHints' } })
  }

  if (messageCommand(utterance)?.kind === 'send') return plain({ kind: 'send' })
  if (quick?.kind === 'undo') return plain({ kind: 'undo' })
  if (BACK.has(clean)) return plain({ kind: 'back' })

  const fixed = EDITS[clean]
  if (fixed) return plain({ kind: 'edit', edit: fixed })
  const replace = replaceEdit(utterance)
  if (replace) return plain({ kind: 'edit', edit: replace })
  const typing = typeTextPattern(utterance)
  if (typing) return plain(typing)

  const talk = conversation(utterance, clean)
  if (talk) return plain(talk)

  const bare = BARE_BROWSER[clean]
  if (bare) return plain({ kind: 'browser', command: bare })
  const browser = browserUnderstood(utterance)
  if (browser) return { action: { kind: 'browser', command: browser.command }, understood: browser.understood }
  const editing = editingPattern(clean)
  if (editing) return plain(editing)

  return plain({ kind: 'dictate', text: utterance.trim().replace(/\s+/g, ' ') })
}

// ---------------------------------------------------------------------------------------------
// Round 3 (the edit lane): editing inside the box by patterns. The fixed phrases ("mine algusesse",
// "vali kõik", "kustuta täht") are in browserIntent.ts; these take a word, a number or free text.

/** "kirjuta siia vahele X", "lisa siia X", "sisesta X" / "insert X", "type here X": X typed at the caret. */
const TYPE_AT_CARET = /^(?:kirjuta siia vahele|kirjuta vahele|lisa siia vahele|lisa siia|sisesta siia|sisesta|insert here|insert|type here|add here)\s+(.+)$/iu

function typeTextPattern(utterance: string): Action | null {
  const m = TYPE_AT_CARET.exec(utterance.trim())
  const text = m?.[1]?.replace(/\s+/g, ' ').replace(/\.$/u, '').trim() ?? ''
  if (text === '') return null
  return { kind: 'browser', command: { kind: 'typeText', text } }
}

/** [pattern over normalised text, what the match means]. The first group is the word or the count. */
type Editing = (m: RegExpExecArray) => Action | null
const EDITING: ReadonlyArray<readonly [RegExp, Editing]> = [
  // The caret by a word.
  [/^(?:mine )?sõna (.+?) (ette|juurde|taha|järele)$/u, (m) => caretFind(m[1], m[2] === 'taha' || m[2] === 'järele' ? 'after' : 'before')],
  [/^enne sõna (.+)$/u, (m) => caretFind(m[1], 'before')],
  [/^pärast sõna (.+)$/u, (m) => caretFind(m[1], 'after')],
  [/^mine (\S+(?: \S+)?) (?:juurde|ette)$/u, (m) => caretFind(m[1], 'before')],
  [/^mine (\S+(?: \S+)?) taha$/u, (m) => caretFind(m[1], 'after')],
  [/^go (?:to )?before (?:the word )?(.+)$/u, (m) => caretFind(m[1], 'before')],
  [/^go (?:to )?after (?:the word )?(.+)$/u, (m) => caretFind(m[1], 'after')],
  // A selection by a word.
  [/^vali sõna (.+)$/u, (m) => selectFind(m[1])],
  [/^vali (\S+(?: \S+)?)$/u, (m) => selectFind(m[1])],
  [/^select (?:the word )?(.+)$/u, (m) => selectFind(m[1])],
  // "kustuta sõna X" / "delete the word X": select it, then Backspace.
  [/^(?:kustuta sõna|delete (?:the )?word) (.+)$/u, (m) => deleteWordNamed(m[1])],
  // Counts: letters, steps, lines, words.
  [/^kustuta (.+?) tähte$/u, (m) => key('Backspace', m[1])],
  [/^delete (.+?) letters$/u, (m) => key('Backspace', m[1])],
  [/^(vasakule|paremale) (.+?) korda$/u, (m) => key(m[1] === 'vasakule' ? 'ArrowLeft' : 'ArrowRight', m[2])],
  [/^(.+?) (?:korda |tähte )?(vasakule|paremale)$/u, (m) => key(m[2] === 'vasakule' ? 'ArrowLeft' : 'ArrowRight', m[1])],
  [/^(.+?) times (?:to the )?(left|right)$/u, (m) => key(m[2] === 'left' ? 'ArrowLeft' : 'ArrowRight', m[1])],
  [/^(?:go |arrow )?(left|right) (.+?) times$/u, (m) => key(m[1] === 'left' ? 'ArrowLeft' : 'ArrowRight', m[2])],
  [/^(.+?) rida (üles|alla)$/u, (m) => key(m[2] === 'üles' ? 'ArrowUp' : 'ArrowDown', m[1])],
  [/^(.+?) lines? (up|down)$/u, (m) => key(m[2] === 'up' ? 'ArrowUp' : 'ArrowDown', m[1])],
  [/^(.+?) sõna (tagasi|edasi)$/u, (m) => caretTimes(m[2] === 'tagasi' ? 'wordBack' : 'wordForward', m[1])],
  [/^(.+?) words? (back|forward)$/u, (m) => caretTimes(m[2] === 'back' ? 'wordBack' : 'wordForward', m[1])],
]

function caretFind(word: string | undefined, where: 'before' | 'after'): Action | null {
  const find = word?.trim() ?? ''
  return find === '' ? null : { kind: 'browser', command: { kind: 'caret', to: { find, where } } }
}

function selectFind(word: string | undefined): Action | null {
  const find = word?.trim() ?? ''
  return find === '' ? null : { kind: 'browser', command: { kind: 'select', what: { find } } }
}

function deleteWordNamed(word: string | undefined): Action | null {
  const find = word?.trim() ?? ''
  return find === '' ? null : { kind: 'deleteNamed', find }
}

function key(name: PressableKey, count: string | undefined): Action | null {
  const times = spokenNumber(count ?? '')
  return times === null ? null : { kind: 'browser', command: times === 1 ? { kind: 'pressKey', key: name } : { kind: 'pressKey', key: name, times } }
}

function caretTimes(to: 'wordBack' | 'wordForward', count: string | undefined): Action | null {
  const times = spokenNumber(count ?? '')
  return times === null ? null : { kind: 'browser', command: { kind: 'caret', to }, repeat: times }
}

function editingPattern(clean: string): Action | null {
  for (const [pattern, meaning] of EDITING) {
    const m = pattern.exec(clean)
    if (m) {
      const action = meaning(m)
      if (action) return action
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// The one-letter rule (section 21.3): a short utterance one letter away from a command is that command.

/** Never reached by a correction: a send, a sleep or a wake, an undo cannot be taken back (21.3); "back" may be an undo. */
const NEVER_CORRECTED = new Set<Action['kind']>(['send', 'sleep', 'wake', 'undo', 'back', 'dictate', 'oneBreath', 'empty', 'ignored', 'deleteNamed', 'cancel'])

/** Words left out of the vocabulary: those of NEVER_CORRECTED, and the keywords of free-text patterns. */
const LEFT_OUT = new Set([
  'saada', 'send', 'puhka', 'maga', 'kuula', 'ärka', 'sleep', 'wake', 'listening', 'stop', 'võta', 'undo',
  'otsi', 'search', 'mitte', 'vaid', 'asemel', 'asenda', 'sõnaga', 'not', 'but', 'replace', 'with', 'change',
  // Round 3: the keywords of the free-text editing patterns.
  'vahele', 'lisa', 'insert', 'juurde', 'ette', 'taha', 'järele', 'pärast', 'enne', 'before', 'after',
])

/** Verb endings: "otsin" is "I search", a sentence, not a misheard "otsi" (21.3). */
const VERB_ENDINGS = new Set(['n', 'd', 'b', 's', 'me', 'te', 'vad', 'ma', 'sin', 'sid', 'nud'])

/** Allative pronouns as spoken: "kirjuta mulle" is dictation. */
const PRONOUN_WORDS = new Set(['mulle', 'sulle', 'talle', 'meile', 'teile', 'neile', 'endale'])

/** Fixed command phrases as word lists: for the vocabulary and for "a partial may still be a command". */
const PHRASES: readonly (readonly string[])[] = [
  ...BROWSER_PHRASES,
  ...Object.keys(EDITS),
  ...Object.keys(BARE_BROWSER),
  ...BACK,
  'saada ära', 'saada sõnum', 'saada see', 'send it', 'send the message', 'send message',
  'stop listening', 'go to sleep', 'ära kuula', 'wake up', 'start listening', 'ärka üles', 'võta tagasi', 'undo that',
  'uus sõnum', 'kirjuta sõnum', 'new message', 'write a message to', 'write message to', 'send a message to',
  'open chat with', 'open the chat with', 'open conversation with', 'open the conversation with', 'chat with', 'write to',
].map((phrase) => phrase.split(' '))

const VOCABULARY: readonly string[] = [
  ...new Set([
    ...PHRASES.flat(),
    ...Object.keys(SITES).flatMap((site) => site.split(' ')),
    'kirjuta', 'sõnum', 'vestlus', 'koos', 'ava', 'mine', 'lehele', 'leht', 'lehekülg', 'vajuta', 'klõpsa', 'kliki',
    'number', 'vaheleht', 'vahelehele', 'click', 'press', 'open', 'chat', 'conversation', 'write', 'message', 'tell', 'tab',
  ]),
].filter((word) => !LEFT_OUT.has(word))

/** Optimal string alignment distance (substitution, insertion, deletion, swap of neighbours), capped. */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min((rows[i - 1]?.[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (rows[i - 1]?.[j - 1] ?? 0) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, (rows[i - 2]?.[j - 2] ?? 0) + 1)
      row.push(d)
    }
    rows.push(row)
  }
  return rows[a.length]?.[b.length] ?? cap + 1
}

/**
 * Round 3 (23.2): true when heard sounds like target (phonetic.ts) and is not target itself, nor
 * target plus a verb ending ("sulgen" is a sentence about closing, not a misheard "sulge").
 */
function soundsNear(heard: string, target: string): boolean {
  if (heard.length < 3 || heard === target) return false
  if (heard.startsWith(target) && VERB_ENDINGS.has(heard.slice(target.length))) return false
  return soundsLike(heard, target)
}

/** True when heard is one letter (two from eight letters) away from target and not target plus a verb ending. */
function nearWord(heard: string, target: string): boolean {
  if (heard.length < 4 || heard === target) return false
  if (heard.startsWith(target) && VERB_ENDINGS.has(heard.slice(target.length))) return false
  const cap = heard.length >= 8 ? 2 : 1
  return distance(heard, target, cap) <= cap
}

/**
 * The one-letter rule: two to four words, not a command as they stand. Each word of four letters
 * or more is tried as each vocabulary word near it, and each pair of neighbours joined into one
 * ("vahe leht"); when the corrected utterances that are commands all mean one command, it is that one.
 */
function misheard(session: InpageSession, utterance: string): Classified | null {
  if (session.asleep) return null
  const words = normalise(utterance).split(' ')
  if (words.length < 2 || words.length > 4) return null

  // One entry per distinct command; of the corrections reaching it, the closest is the one named.
  const found = new Map<string, { classified: Classified; cost: number }>()
  const attempt = (candidate: readonly string[], cost: number): void => {
    const text = candidate.join(' ')
    const { action } = classifyExact(session, text)
    if (NEVER_CORRECTED.has(action.kind)) return
    // "kirjuta siis" is not "kirjuta siia", "pane kinn" is not Escape: arming and keys are never reached by a correction.
    if (action.kind === 'browser' && (action.command.kind === 'arm' || action.command.kind === 'pressKey')) return
    // Nor is free text: "vali X", "mine X juurde", "kirjuta siia vahele X" (round 3).
    if (action.kind === 'deleteNamed' || (action.kind === 'browser' && (action.command.kind === 'typeText' || findOf(action.command) !== null))) return
    const key = JSON.stringify(action)
    const before = found.get(key)
    if (before === undefined || cost < before.cost) found.set(key, { classified: { action, understood: text }, cost })
  }
  words.forEach((word, i) => {
    for (const target of VOCABULARY) {
      if (nearWord(word, target)) attempt([...words.slice(0, i), target, ...words.slice(i + 1)], distance(word, target, 2))
    }
  })
  for (let i = 0; i + 1 < words.length; i++) {
    // A word split in two ("vaik semaks"), not a command word with a two-letter word beside it: the
    // two edits allowed from eight letters would make "ei lõpeta" and "lõpeta ja" into "lõpeta".
    if ((words[i]?.length ?? 0) < 3 || (words[i + 1]?.length ?? 0) < 3) continue
    const joined = `${words[i] ?? ''}${words[i + 1] ?? ''}`
    for (const target of VOCABULARY) {
      if (target === joined || nearWord(joined, target)) {
        attempt([...words.slice(0, i), target, ...words.slice(i + 2)], distance(joined, target, 2))
      }
    }
  }
  // Round 3 (23.2): when no letter-level correction fires, each word of three letters or more is
  // tried as each vocabulary word that sounds like it ("aga" is "ava", "ala" is "alla"), one word
  // at a time, under the same rule: the corrections that are commands must all mean one command.
  if (found.size === 0) {
    words.forEach((word, i) => {
      for (const target of VOCABULARY) {
        if (soundsNear(word, target)) attempt([...words.slice(0, i), target, ...words.slice(i + 1)], 1)
      }
    })
  }
  const [only] = found.values()
  return found.size === 1 && only !== undefined ? only.classified : null
}

/** The session after commands ran on the page in front: labels and undo kept only where still true. */
function afterCommands(session: InpageSession, commands: readonly BrowserCommand[]): InpageSession {
  const hints = commands.some((c) => c.kind === 'showHints')
    ? true
    : commands.every(keepsHints) && session.hints
  const undo = commands.every(keepsBox) ? session.undo : []
  return { ...session, hints, undo }
}

function pushUndo(session: InpageSession, old: string): InpageSession {
  return { ...session, undo: [...session.undo, old].slice(-UNDO_LIMIT) }
}

function act(session: InpageSession, action: Action, box: BoxState): InpageStep {
  const s = STRINGS[session.lang]
  const none = (line: string): InpageStep => ({ session, commands: [], line })
  const run = (command: BrowserCommand, repeat = 1): InpageStep => {
    const commands: BrowserCommand[] = Array.from({ length: Math.max(1, repeat) }, () => command)
    return { session: afterCommands(session, commands), commands, line: s.browserDoing(command) }
  }
  /** The step that refuses to touch the box, or null when words may go there (M7: present and armed). */
  const armed = (): InpageStep | null => (!box.present ? none(s.inpage.pickField) : !box.armed ? none(s.inpage.noPlaceToWrite) : null)
  const undo = (): InpageStep => {
    const previous = session.undo.at(-1)
    if (previous === undefined) return none(s.nothingToUndo)
    // The entry leaves undo in inpageResult, once the setText succeeded.
    return { session, commands: [{ kind: 'setText', text: previous }], line: s.inpage.undoing }
  }
  switch (action.kind) {
    case 'empty':
      return none('')
    case 'ignored':
      return none(s.inpage.resting)
    case 'cancel':
      // Round 5: nothing for the page; the engine does the dropping.
      return { session, commands: [], line: s.inpage.cancelled, cancel: true }
    case 'sleep':
      return { session: { ...session, asleep: true }, commands: [], line: s.inpage.sleeping }
    case 'wake':
      return session.asleep
        ? { session: { ...session, asleep: false }, commands: [], line: s.listeningAgain }
        : none(s.alreadyListening)
    case 'browser': {
      if (!isEditing(action.command)) return run(action.command)
      // Round 3: editing happens in the box in front; without one there is nothing to edit.
      if (!box.present) return none(s.inpage.pickField)
      const step = run(action.command, action.repeat)
      return pushesUndo(action.command) ? { ...step, session: pushUndo(step.session, box.text) } : step
    }
    case 'open':
      return run({ kind: 'openConversation', name: action.name })
    case 'oneBreath': {
      const open: BrowserCommand = { kind: 'openConversation', name: action.name }
      const commands: BrowserCommand[] = [open, { kind: 'setText', text: action.text }]
      return { session: pushUndo(afterCommands(session, commands), ''), commands, line: s.browserDoing(open) }
    }
    case 'sayWho':
      return none(s.inpage.sayWho)
    case 'deleteNamed': {
      if (!box.present) return none(s.inpage.pickField)
      const commands: BrowserCommand[] = [{ kind: 'select', what: { find: action.find } }, { kind: 'pressKey', key: 'Backspace' }]
      return { session: pushUndo(afterCommands(session, commands), box.text), commands, line: s.inpage.deletingNamed(action.find) }
    }
    case 'send':
      if (!box.present) return none(s.inpage.nothingToSend)
      if (!box.armed) return none(s.inpage.noPlaceToWrite)
      if (box.text.trim() === '') return none(s.inpage.nothingToSend)
      return run({ kind: 'pressSend' })
    case 'undo':
      return armed() ?? undo()
    case 'back':
      // M7: an armed box with words in it, or words just taken out of it (undo has an entry): undo, which
      // says so when there is nothing to take back. The page history only when he is not writing.
      return box.present && box.armed && (box.text.trim() !== '' || session.undo.length > 0) ? undo() : run({ kind: 'history', direction: 'back' })
    case 'edit': {
      const refused = armed()
      if (refused) return refused
      const done = applyEdit(s, box.text, action.edit)
      if ('fail' in done) return none(done.fail)
      if (done.text === box.text) return none(done.line)
      return { session: pushUndo(session, box.text), commands: [{ kind: 'setText', text: done.text }], line: done.line }
    }
    case 'dictate': {
      const refused = armed()
      if (refused) return refused
      const command: BrowserCommand = { kind: 'setText', text: joinDictation(box.text, action.text) }
      return { session: pushUndo(session, box.text), commands: [command], line: s.browserDoing(command) }
    }
  }
}

type Applied = { text: string; line: string } | { fail: string }

function applyEdit(s: Strings, text: string, edit: Edit): Applied {
  if (edit.kind === 'newLine') return { text: `${text}\n`, line: s.inpage.newLine }
  if (text.trim() === '') return { fail: s.inpage.boxEmpty }
  switch (edit.kind) {
    case 'replace':
      return replaceLast(s, text, edit)
    case 'deleteWord':
      return { text: text.replace(/\s*\S+\s*$/u, ''), line: s.inpage.deletingWord }
    case 'deleteSentence': {
      const body = text.replace(/[\s.!?…]+$/u, '')
      const end = Math.max(...['.', '!', '?', '…', '\n'].map((mark) => body.lastIndexOf(mark)))
      return { text: end < 0 ? '' : text.slice(0, end + 1), line: s.inpage.deletingSentence }
    }
    case 'clear':
      return { text: '', line: s.inpage.clearing }
    case 'mark':
      return { text: text.trimEnd().replace(/[.,!?]$/u, '') + edit.mark, line: s.inpage.mark(edit.mark) }
  }
}

/** True when index starts a sentence: the start of the text, or after . ! ? … or a line break. */
function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/[ \t]+$/u, '')
  return before === '' || /[.!?…\n]$/u.test(before)
}

function replaceLast(s: Strings, text: string, edit: Extract<Edit, { kind: 'replace' }>): Applied {
  let found: { index: number; length: number } | null = null
  for (const m of text.matchAll(wholeWords(edit.from, 'giu'))) found = { index: m.index, length: m[0].length }

  if (found === null && edit.loose && !/\s/u.test(edit.from)) {
    // "kolme asemel neli": the genitive is the word plus one or two letters.
    const spoken = edit.from.toLocaleLowerCase()
    for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
      const word = m[0].toLocaleLowerCase()
      const extra = spoken.length - word.length
      if (word.length >= 3 && extra >= 1 && extra <= 2 && spoken.startsWith(word)) {
        found = { index: m.index, length: m[0].length }
      }
    }
  }
  if (found === null) return { fail: s.inpage.notInText(edit.from) }

  const replaced = text.slice(found.index, found.index + found.length)
  const capital = replaced.charAt(0) !== replaced.charAt(0).toLocaleLowerCase() && atSentenceStart(text, found.index)
  const to = capital ? capitalise(edit.to) : edit.to
  return {
    text: text.slice(0, found.index) + to + text.slice(found.index + found.length),
    line: s.inpage.replacing(edit.from, edit.to),
  }
}

/**
 * A capital the recogniser did not invent: a capital after the first letter (ERR), English "I",
 * or the same capitalised word already in the box in the middle of a sentence (a name he used).
 */
function keepsCapital(word: string, box: string): boolean {
  const bare = word.replace(/[^\p{L}\p{N}'’]/gu, '')
  if (bare === '' || bare.charAt(0) === bare.charAt(0).toLocaleLowerCase()) return false
  if (/\p{Lu}/u.test(bare.slice(1))) return true
  if (/^I(?:['’]|$)/u.test(bare)) return true
  return new RegExp(`(?<=[\\p{L}\\p{N},;:] )${escapeRegExp(bare)}(?![\\p{L}\\p{N}])`, 'u').test(box)
}

/**
 * The box text with one dictated utterance appended (the join rules of section 21.1). stop false
 * leaves out the closing full stop, for a sentence still being spoken (21.3).
 */
function joinDictation(old: string, utterance: string, stop = true): string {
  let base = old.replace(/[ \t]+$/u, '')
  const [head = '', ...rest] = utterance.split(' ')
  const headWord = head.toLocaleLowerCase().replace(/[^\p{L}]/gu, '')
  let comma = false
  if (CONTINUES.has(headWord) && /[^.]\.$/u.test(base)) {
    base = base.slice(0, -1)
    comma = COMMA_BEFORE.has(headWord)
  }
  const sentenceStart = base === '' || /[.!?…\n]$/u.test(base)
  const first = sentenceStart ? capitalise(head) : keepsCapital(head, base) ? head : lowerInitial(head)
  let text = [first, ...rest].join(' ')
  if (stop && rest.length >= 2 && !/[.!?…,:;]$/u.test(text)) text += '.'
  const separator = base === '' || base.endsWith('\n') ? '' : comma ? ', ' : ' '
  return base + separator + text
}


/**
 * Live dictation (section 21.3): the whole text the message box should show while an utterance is
 * still being spoken, so words appear as he says them. partial is what the recogniser has so far;
 * box is the message box as it was BEFORE this utterance began. Null while the words may still turn
 * out to be a command, while asleep, or when there is no armed box: then nothing is typed and the strip
 * alone shows the words. The final utterance still goes through inpageStep with that same earlier box.
 */
export function inpagePreview(session: InpageSession, partial: string, box: BoxState): string | null {
  if (session.asleep || !box.present || !box.armed) return null
  const clean = normalise(partial)
  if (clean === '' || mayBeCommand(session, partial, clean)) return null
  return joinDictation(box.text, partial.trim().replace(/\s+/g, ' '), false)
}

/** Starts of pattern commands that are not complete yet (section 21.3), over normalised text. */
const PENDING: readonly RegExp[] = [
  /^(?:mitte|not|asenda|replace|change)(?: \S+){0,4}(?: (?:vaid|but|sõnaga|with|to))?$/u,
  /^\S+(?: \S+)? asemel$/u,
  /^(?:ava|mine|open|go|go to|mine lehele|ava leht|ava lehekülg|ava vestlus|ava vestlus koos|chat with|write to|tell|message|switch to)(?: \S+){0,2}$/u,
  /^(?:tell|write to|message) \S+(?: \S+)? that$/u,
  /^(?:vajuta|klõpsa|kliki|click|press) number$/u,
  /^(?:mine )?(?:vaheleht|vahelehele)(?: number)?$/u,
  // Round 3 (editing): a word, a count or text still to come.
  /^(?:mine |enne |pärast )?sõna(?: \S+){0,3}$/u,
  /^mine(?: \S+){1,2}$/u,
  /^vali(?: sõna)?(?: \S+){0,2}$/u,
  /^(?:kustuta|delete)(?: \S+)?$/u,
  /^(?:kustuta sõna|delete the word|delete word)(?: \S+){0,2}$/u,
  /^(?:kirjuta siia(?: vahele)?|kirjuta vahele|lisa siia(?: vahele)?|sisesta siia|insert(?: here)?|type here|add here)(?: .*)?$/u,
  /^(?:go|go to|select|select the word|go before|go after|go to before|go to after)(?: \S+){0,2}$/u,
  /^(?:vasakule|paremale|left|right|arrow left|arrow right|go left|go right)(?: \S+){0,2}$/u,
  /^\S+(?: \S+)? (?:korda|rida|sõna|tähte|times|lines?|words?|letters?)$/u,
]

/** The words are the first words of a fixed command phrase, each maybe a letter off, the last maybe half said. */
function startsPhrase(words: readonly string[]): boolean {
  return PHRASES.some(
    (phrase) =>
      words.length <= phrase.length &&
      words.every((heard, i) => {
        const target = phrase[i] ?? ''
        const last = i === words.length - 1
        return heard === target || (last && target.startsWith(heard)) || nearWord(heard, target)
      }),
  )
}

/** "kirjuta", "saada", "sõnum", "uus sõnum": still waiting for a name, or a name and "et" (21.3). */
function pendingMessage(words: readonly string[]): boolean {
  let rest: readonly string[]
  if (words[0] === 'uus' && words[1] === 'sõnum') rest = words.slice(2)
  else if (words[0] === 'kirjuta' || words[0] === 'saada' || words[0] === 'sõnum') rest = words.slice(1)
  else return false
  if (rest[0] === 'sõnum') rest = rest.slice(1)
  const first = rest[0]
  if (first === undefined) return true
  if (PRONOUN_WORDS.has(first)) return false
  if (rest.length <= 2) return true
  const nameEnd = rest.slice(0, 2).findIndex((word) => word.endsWith('le')) + 1
  if (nameEnd === 0) return false
  let after = rest.slice(nameEnd)
  if (after[0] === 'sõnum') after = after.slice(1)
  return after[0] === 'et'
}

/** Section 21.3: a command now, one word, or a start that more words could still make a command. */
function mayBeCommand(session: InpageSession, partial: string, clean: string): boolean {
  const words = clean.split(' ')
  if (words.length === 1) return true
  if (classify(session, partial).action.kind !== 'dictate') return true
  return startsPhrase(words) || PENDING.some((pattern) => pattern.test(clean)) || pendingMessage(words)
}
