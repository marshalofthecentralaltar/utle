// Round 10 (31.7): the voice lines of the strip, shared by the offscreen document and the welcome page.
import type { STRINGS } from '../../src/core/strings.ts'
import type { SpeakerTestResult } from '../../src/speech/asrProtocol.ts'

/** Round 10 (31.7): the voice lines of the strip's strings that the functions below use. */
export type VoiceText = Pick<typeof STRINGS.et.strip, 'phraseProblem' | 'enrolFailedWhy' | 'enrolVerified' | 'readiness' | 'voiceTest'>

/** Round 10 (31.7): why a read phrase was not counted, or '' for an unknown reason. */
export function phraseLine(problem: string | undefined, text: VoiceText): string {
  return problem === 'too_short' || problem === 'too_quiet' || problem === 'clipped' || problem === 'model_error' ? text.phraseProblem[problem] : ''
}

/** Round 10 (31.7): whether only-owner protects, in words; only `ready` says it does, an unknown state says nothing. */
export function readinessLine(state: string, text: VoiceText): string {
  return state === 'ready' || state === 'no_profile' || state === 'needs_retraining' || state === 'model_unavailable' || state === 'model_mismatch' ? text.readiness[state] : ''
}

/** Round 10 (31.7): the voice test's answer. */
export function voiceTestLine(result: SpeakerTestResult, text: VoiceText): string {
  return text.voiceTest[result]
}

