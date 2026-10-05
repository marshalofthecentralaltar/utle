import type { BoxState, BrowserCommand, BrowserFailure, BrowserResult } from '../browser/protocol.ts'
import { BRIDGE_TIMED_OUT, browserIntent } from './browserIntent.ts'
import { messageCommand, nameFromSpoken } from './message.ts'
import { normalise, quickReply } from './quickReply.ts'
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
}

export function initialInpage(lang: Lang): InpageSession {
  return { lang, asleep: false, hints: false, undo: [] }
}

/**
 * What one utterance does. box is the message box of the page in front as it was when the
 * utterance ended (present false when the page has no text field).
 */
export function inpageStep(session: InpageSession, utterance: string, box: BoxState): InpageStep {
  return act(session, classify(session, utterance), box)
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
  const undo = typed !== undefined && !wasUndo ? session.undo.slice(0, -1) : session.undo
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
  const kind = classify(session, utterance).kind
  return kind !== 'dictate' && kind !== 'oneBreath' && kind !== 'empty'
}

// ---------------------------------------------------------------------------------------------
// Private: what an utterance means (classify) and what it does to the box (act). Section 21.1.

type Action =
  | { kind: 'empty' }
  | { kind: 'ignored' }
  | { kind: 'sleep' }
  | { kind: 'wake' }
  | { kind: 'browser'; command: BrowserCommand }
  | { kind: 'open'; name: string }
  | { kind: 'oneBreath'; name: string; text: string }
  | { kind: 'sayWho' }
  | { kind: 'send' }
  | { kind: 'undo' }
  | { kind: 'edit'; edit: Edit }
  | { kind: 'dictate'; text: string }

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
  back: { kind: 'history', direction: 'back' },
  'go back': { kind: 'history', direction: 'back' },
}

const OPEN_ET_WITH = /^ava vestlus (?:koos )?(\p{L}+(?: \p{L}+)?)$/u
const OPEN_ET_OF = /^ava (\p{L}+(?: \p{L}+)?) vestlus$/u
const OPEN_EN = /^(?:open (?:the )?(?:chat|conversation) with|chat with|write to) (\p{L}+(?: \p{L}+)?)$/u

/** Allative pronouns after the name rule: "kirjuta mulle" is dictation, not a conversation. */
const PRONOUNS = new Set(['Mul', 'Sul', 'Tal', 'Mei', 'Tei', 'Nei', 'Enda'])

/** Commands that leave the numbered labels on the page (20.2). */
const KEEPS_HINTS = new Set<BrowserCommand['kind']>(['showHints', 'scroll', 'ping', 'readBox', 'setText', 'pressSend'])
/** Commands that leave the same message box in front, so the undo texts still belong to it. */
const KEEPS_BOX = new Set<BrowserCommand['kind']>([...KEEPS_HINTS, 'hideHints'])

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

function classify(session: InpageSession, utterance: string): Action {
  const quick = quickReply(utterance)
  if (session.asleep) return quick?.kind === 'wake' ? { kind: 'wake' } : { kind: 'ignored' }

  const clean = normalise(utterance)
  if (clean === '') return { kind: 'empty' }
  if (quick?.kind === 'sleep') return { kind: 'sleep' }
  if (quick?.kind === 'wake') return { kind: 'wake' }
  if (session.hints && quick?.kind === 'number') return { kind: 'browser', command: { kind: 'clickHint', number: quick.n } }

  if (messageCommand(utterance)?.kind === 'send') return { kind: 'send' }
  if (quick?.kind === 'undo') return { kind: 'undo' }

  const fixed = EDITS[clean]
  if (fixed) return { kind: 'edit', edit: fixed }
  const replace = replaceEdit(utterance)
  if (replace) return { kind: 'edit', edit: replace }

  const talk = conversation(utterance, clean)
  if (talk) return talk

  const command = BARE_BROWSER[clean] ?? browserIntent(utterance)
  if (command) return { kind: 'browser', command }

  return { kind: 'dictate', text: utterance.trim().replace(/\s+/g, ' ') }
}

/** The session after commands ran on the page in front: labels and undo kept only where still true. */
function afterCommands(session: InpageSession, commands: readonly BrowserCommand[]): InpageSession {
  const hints = commands.some((c) => c.kind === 'showHints')
    ? true
    : commands.every((c) => KEEPS_HINTS.has(c.kind)) && session.hints
  const undo = commands.every((c) => KEEPS_BOX.has(c.kind)) ? session.undo : []
  return { ...session, hints, undo }
}

function pushUndo(session: InpageSession, old: string): InpageSession {
  return { ...session, undo: [...session.undo, old].slice(-UNDO_LIMIT) }
}

function act(session: InpageSession, action: Action, box: BoxState): InpageStep {
  const s = STRINGS[session.lang]
  const none = (line: string): InpageStep => ({ session, commands: [], line })
  const run = (command: BrowserCommand): InpageStep => ({
    session: afterCommands(session, [command]),
    commands: [command],
    line: s.browserDoing(command),
  })
  switch (action.kind) {
    case 'empty':
      return none('')
    case 'ignored':
      return none(s.inpage.resting)
    case 'sleep':
      return { session: { ...session, asleep: true }, commands: [], line: s.inpage.sleeping }
    case 'wake':
      return session.asleep
        ? { session: { ...session, asleep: false }, commands: [], line: s.listeningAgain }
        : none(s.alreadyListening)
    case 'browser':
      return run(action.command)
    case 'open':
      return run({ kind: 'openConversation', name: action.name })
    case 'oneBreath': {
      const open: BrowserCommand = { kind: 'openConversation', name: action.name }
      const commands: BrowserCommand[] = [open, { kind: 'setText', text: action.text }]
      return { session: pushUndo(afterCommands(session, commands), ''), commands, line: s.browserDoing(open) }
    }
    case 'sayWho':
      return none(s.inpage.sayWho)
    case 'send':
      if (!box.present || box.text.trim() === '') return none(s.inpage.nothingToSend)
      return run({ kind: 'pressSend' })
    case 'undo': {
      if (!box.present) return none(s.inpage.pickField)
      const previous = session.undo.at(-1)
      if (previous === undefined) return none(s.nothingToUndo)
      // The entry leaves undo in inpageResult, once the setText succeeded.
      return { session, commands: [{ kind: 'setText', text: previous }], line: s.inpage.undoing }
    }
    case 'edit': {
      if (!box.present) return none(s.inpage.pickField)
      const done = applyEdit(s, box.text, action.edit)
      if ('fail' in done) return none(done.fail)
      if (done.text === box.text) return none(done.line)
      return { session: pushUndo(session, box.text), commands: [{ kind: 'setText', text: done.text }], line: done.line }
    }
    case 'dictate': {
      if (!box.present) return none(s.inpage.pickField)
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

/** The box text with one dictated utterance appended (the join rules of section 21.1). */
function joinDictation(old: string, utterance: string): string {
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
  if (rest.length >= 2 && !/[.!?…,:;]$/u.test(text)) text += '.'
  const separator = base === '' || base.endsWith('\n') ? '' : comma ? ', ' : ' '
  return base + separator + text
}

