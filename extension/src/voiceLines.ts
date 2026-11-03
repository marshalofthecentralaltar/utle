// Round 10 (31.7): the voice lines of the strip, shared by the offscreen document and the welcome page.
import type { STRINGS } from '../../src/core/strings.ts'
import { PHRASE_PROBLEMS } from '../../src/speech/asrProtocol.ts'
import type { SpeakerTestResult } from '../../src/speech/asrProtocol.ts'

/** Round 10 (31.7): the voice lines of the strip's strings that the functions below use. */
export type VoiceText = Pick<typeof STRINGS.et.strip, 'phraseProblem' | 'enrolFailedWhy' | 'enrolVerified' | 'readiness' | 'voiceTest'>

/** Round 10 (31.7): why a read phrase was not counted, or '' for an unknown reason. Round 11 (F2): slow says to wait. */
export function phraseLine(problem: string | undefined, text: VoiceText): string {
  const known = PHRASE_PROBLEMS.find((p) => p === problem)
  return known === undefined ? '' : text.phraseProblem[known]
}

/** Round 10 (31.7): whether only-owner protects, in words; only `ready` says it does, an unknown state says nothing. */
export function readinessLine(state: string, text: VoiceText): string {
  return state === 'ready' || state === 'no_profile' || state === 'needs_retraining' || state === 'model_unavailable' || state === 'model_mismatch' ? text.readiness[state] : ''
}

/** Round 10 (31.7): the voice test's answer. */
export function voiceTestLine(result: SpeakerTestResult, text: VoiceText): string {
  return text.voiceTest[result]
}

