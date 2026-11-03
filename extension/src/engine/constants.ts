// The engine's limits and timings (docs/ARCHITECTURE.md 21.2). createEngine's module re-exports the public ones.

import type { BoxState } from '../../../src/browser/protocol.ts'
import type { Care } from './types.ts'

/** Round 8 (29.4.3): how long "lisa koht" waits for the word. */
export const PLACE_ASK_MS = 20_000

export const NO_BOX: BoxState = { present: false, text: '', armed: false }
/**
 * Round 3: the box the rules are shown to tell a plain send ("saada") from everything else before
 * the utterance's turn comes. Exported so a test's logic can recognise the probe.
 */
export const SEND_PROBE_BOX: BoxState = { present: true, text: 'x', armed: true }

/** The model is not asked about an utterance this long when the box is armed: a sentence is dictation. */
/** Round 4: a chain of commands can be long, so almost every dictation is verified (type first, verify after). */
export const LONG_UTTERANCE_WORDS = 60
/** The model must answer within this time, or the rules' step stands. */
/** Longer than the server's own 7 s, so a slow model answers 504 and the engine sees it rather than giving up first. */
export const ASK_TIMEOUT_MS = 9000
/** Round 5: a careful ask (server timeout 12 s) may take this long before the engine gives it up. */
export const ASK_TIMEOUT_CAREFUL_MS = 14_000
/** Round 5: how long the engine waits for one ask, by its care. */
export const askTimeoutMs = (care: Care | undefined): number => (care === 'careful' ? ASK_TIMEOUT_CAREFUL_MS : ASK_TIMEOUT_MS)
/**
 * Round 5: an utterance of this many words or more is asked with care (the model reads the whole
 * of it and plans before it acts); so is one with a connective in it, and every ask in a chain.
 * Shorter ones are asked quickly, so a short command keeps its speed.
 */
export const CAREFUL_WORDS = 8
/**
 * Round 5: a job (one utterance's turn, or one goal of its chain) that is still working this long
 * after it began is given up as a barge-in would give it up, and the strip says so. Nothing can
 * sit silent for minutes.
 */
export const JOB_WATCHDOG_MS = 25_000
/** Round 5: one page command gets this long to answer, else it failed with 'timed_out' (the bridge's own cap is 20 s too). */
export const COMMAND_TIMEOUT_MS = 20_000
/** Round 5: the strip shows how long a job has been working from this many seconds on. */
export const BUSY_FROM_S = 3
/**
 * Round 5 (review of round 4, M7): a dictation of this many words or more, typed first, is never
 * taken back for a verdict that is one plain command with nothing after it: a 14-word single
 * command is implausible, and a wrong verdict would erase a sentence. Chains carry a plan or
 * done:false, so they still run.
 */
export const LONG_COMMAND_WORDS = 14
/** M7.2: a multi-step utterance gets no further step once this long has passed since it arrived. */
export const INTENT_LOOP_BUDGET_MS = 15_000
/**
 * Round 3: an utterance that waited longer than this in the queue is handled by the rules alone,
 * with no question to the model: an answer minutes late would act on a page that has changed.
 */
export const STALE_MS = 3000
/**
 * Round 3: the recogniser's lag is shown on the strip from this much on, and cleared below it. Below
 * the server's MAX_BACKLOG_MS (1500): the server reports the backlog at the moment it drops, which is
 * never much above that, so a higher threshold would hide every drop.
 */
export const LAG_SHOWN_MS = 1000
/** M7.2: the loop stops after this many failed steps (one failure is reported back so the model may recover). */
export const MAX_STEP_FAILURES = 2
/** M7.2: how long the page gets to render after a step before it is read again (a goTo already waited for the load). */
export const SETTLE_MS = 300
/** Round 4: the model may plan this many goals after the one it acts on (IntentAnswerSchema: 12). */
export const MAX_PLAN_GOALS = 12
export const GOAL_CHARS = 200
/** IntentRequestSchema's utterance limit: a longer one would be a 400, and the words never judged. */
export const UTTERANCE_CHARS = 500
/** Round 4 (review): an enrolment with no answer from the server ends after this many times its seconds. */
export const ENROL_TIMEOUT_FACTOR = 5
/** The request's limits in IntentRequestSchema: a page beyond them would be a 400, and the model never asked. */
export const URL_CHARS = 2000
export const TITLE_CHARS = 300
export const BOX_CHARS = 4000
