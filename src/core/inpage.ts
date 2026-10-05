import type { BoxState, BrowserCommand, BrowserResult } from '../browser/protocol.ts'
import type { Lang } from './strings.ts'

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
  void utterance
  void box
  return { session, commands: [], line: '' }
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
  void commands
  void result
  return { session, line: '' }
}

/** True for an utterance that should not wait to be joined with more speech: a command, not dictation. */
export function inpageInstant(session: InpageSession, utterance: string): boolean {
  void session
  void utterance
  return false
}
