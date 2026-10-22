// Messages between the extension's parts (docs/ARCHITECTURE.md 21.2) and the strip's state.

import type { BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import type { TabSummary } from '../../src/core/pageIntent.ts'
import type { SavedItem } from '../../src/core/saved.ts'
import type { PlaceRow } from '../../src/core/places.ts'
import type { PageCommand } from './page.ts'

/** Everything the strip shows. Kept by the service worker in chrome.storage.session under STATE_KEY. */
export interface StripState {
  listening: boolean
  /** The session is asleep ("puhka"): the microphone is on but nothing is typed. */
  resting: boolean
  /** The words heard right now, or the last utterance. */
  heard: string
  /** What was understood or done. */
  line: string
  /** A plain line about something that stops him (the speech model, the microphone), or ''. */
  problem: string
  /** The strip is folded to a small microphone pill ("peida riba"). */
  hidden: boolean
  /** The model is being asked what the last utterance meant (M7). */
  thinking: boolean
  /** The free-form understanding is off: no key, or the server has no model. '' when it works. */
  modelProblem: string
  /** How far behind the speech server is, in ms (round 3). 0 when caught up. */
  lag: number
  /** Round 5: seconds the current job has been working, shown while it is above a few; 0 when idle. */
  busySeconds: number
  /** Round 4: progress through a chain of goals, e.g. "2/4 · otsin kassivideod", or ''. */
  chain: string
  /** Round 4: a line when speech was dropped as someone else's voice, or ''. Cleared after FOREIGN_SHOWN_MS. */
  foreign: string
  /** Round 7: scripted enrolment: phrases heard so far (0 at its start), or -1 when none is running. The settings page follows it. */
  enrolPhrases: number
  /** Round 8 (29.4.1): the wake mode's dictation window is open: the strip shows an amber disc. */
  wakeOpen: boolean
  /** Counters for the tests and for debugging. */
  connects: number
  micOpens: number
  /** Date.now() when the microphone last opened, for the tests' timings. */
  micOpenedAt: number
}

export const STATE_KEY = 'stripState'
export const OFFSCREEN_CREATED_KEY = 'offscreenCreated'

export const INITIAL_STATE: StripState = { listening: false, resting: false, heard: '', line: '', problem: '', hidden: false, thinking: false, modelProblem: '', lag: 0, busySeconds: 0, chain: '', foreign: '', enrolPhrases: -1, wakeOpen: false, connects: 0, micOpens: 0, micOpenedAt: 0 }

/** To the service worker. */
export type ToBackground =
  /** From the strip or the toolbar: turn listening on or off. */
  | { type: 'utle-toggle' }
  /** From the offscreen engine: part of the strip's state changed. */
  | { type: 'utle-state'; patch: Partial<StripState> }
  /** From the offscreen engine: run one command on the page in front. */
  | { type: 'utle-run'; command: BrowserCommand }
  /** From the offscreen engine: the microphone was refused; open the permission page. */
  | { type: 'utle-mic-blocked' }
  /** From the offscreen engine (M7): the tabs of the window being driven, for the model. Answered with a TabsAnswer. */
  | { type: 'utle-tabs' }
  /** From the permission page: the microphone is allowed now. */
  | { type: 'utle-mic-granted' }
  /** From the localhost harness through relay.js (section 20.2). */
  | { type: 'utle-command'; command: BrowserCommand }
  /** From the strip's "Seaded" control: open the options page (a content script cannot). */
  | { type: 'utle-open-options' }
  /** From the strip's "Peida" and "Näita" controls: fold the bar to the pill, or unfold it. */
  | { type: 'utle-bar'; show: boolean }
  /**
   * From the strip in gaze mode (round 3): listen while the pointer rests on the target. on:false
   * with flush delivers the words said so far before the microphone closes.
   */
  | { type: 'utle-listen'; on: boolean; flush?: boolean }
  /** From the options page (round 4): learn the owner's voice from the next `seconds` of speech. Listening starts if it was off. */
  | { type: 'utle-enrol'; seconds: number }
  /** Round 7: from the options page: scripted enrolment of `phrases` read phrases starts, or ends now with what was read. */
  | { type: 'utle-enrol-script'; phrases: number }
  | { type: 'utle-enrol-finish' }
  /** Round 6 (26.1): from the offscreen engine at start: his saved values and whether the entry flow runs. Answered with a SavedAnswer. */
  | { type: 'utle-saved' }
  /** Round 6 (26.5): from the options page: the voice entry flow started (on) or ended. */
  | { type: 'utle-entry'; on: boolean }
  // ---------- wake word and places (29.4) ----------
  /** Round 8 (29.4.2): from the offscreen engine at start: his places. Answered with a PlacesAnswer. */
  | { type: 'utle-places' }
  // ---------- end of wake word and places ----------

/** To the offscreen document. stop with flush: deliver the words said so far, then stop. */
export type ToOffscreen =
  | { target: 'offscreen'; type: 'toggle' }
  | { target: 'offscreen'; type: 'start' }
  | { target: 'offscreen'; type: 'stop'; flush?: boolean }
  | { target: 'offscreen'; type: 'flush' }
  /** Round 4: learn the owner's voice (the strip tells him to speak). */
  | { target: 'offscreen'; type: 'enrol'; seconds: number }
  /** Round 7: scripted enrolment starts, or ends now. */
  | { target: 'offscreen'; type: 'enrolScript'; phrases: number }
  | { target: 'offscreen'; type: 'enrolFinish' }
  /** Round 6 (26.1): his saved values changed. They stay on this machine. */
  | { target: 'offscreen'; type: 'saved'; items: SavedItem[] }
  /** Round 6 (26.5): the options page's entry flow started or ended. */
  | { target: 'offscreen'; type: 'entry'; on: boolean }
  // ---------- wake word and places (29.4) ----------
  /** Round 8 (29.4.2): his own place rows changed (the engine merges them over the defaults). */
  | { target: 'offscreen'; type: 'places'; rows: PlaceRow[] }
  // ---------- end of wake word and places ----------

/**
 * To the extension's new-tab page, from the service worker: run one page command there (21.3). The
 * worker cannot inject into an extension page, so the page runs it with its own copy of page.ts.
 * Only the page whose tab id is tabId answers.
 */
export type ToPage = { type: 'utle-page-run'; tabId: number; command: PageCommand }

/** To the strip (content script), from the service worker. Used by the tests. */
export type ToStrip = { type: 'utle-strip-measure' }

export interface StripMeasure {
  strip: { left: number; top: number; width: number; height: number }
  mic: { left: number; top: number; width: number; height: number }
  micState: string
  heard: string
  /** The computed font size of the heard words, in px. */
  heardPx: number
  line: string
  /** The bar is folded to the pill. */
  hidden: boolean
  /** Gaze mode (round 3): the target's phase ('arming', 'on', 'leaving'), or '' when off or not in gaze mode. */
  gaze: string
  /** The lag line's text, or '' when hidden. */
  lag: string
}

export type RunAnswer = { result: BrowserResult }

export type TabsAnswer = { tabs: TabSummary[] }

/** Round 6: the answer to utle-saved. */
export type SavedAnswer = { items: SavedItem[]; entry: boolean }

/** Round 8 (29.4.2): the answer to utle-places: his own rows, not yet merged over the defaults. */
export type PlacesAnswer = { rows: PlaceRow[] }

/** Round 6: chrome.storage.session key: the options page's entry flow runs (kept for a new offscreen document). */
export const ENTRY_KEY = 'savedEntryOn'
