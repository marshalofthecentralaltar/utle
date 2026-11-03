import type { EndpointMode, EnrolFailure, HeldOutResult, PhraseProblem, SpeakerDecision, SpeakerReadiness, SpeakerReason, SpeakerTestResult } from './asrProtocol.ts'

/** Round 10 (31.7): why an enrolment replaced nothing, and the candidate's held-out scores. */
export interface EnrolDetail {
  reason?: EnrolFailure
  heldOut?: HeldOutResult
}

/** A source of spoken utterances. Chrome's built-in recognition today; a paid recogniser can replace it. */
export interface Recognizer {
  start(): void
  stop(): void
  /** BCP 47 tag, for example 'en-US' or 'et-EE'. Takes effect at once when running. */
  setLang(lang: string): void
  /** False when the browser has no speech recognition. The typed box still works. */
  readonly supported: boolean
  /**
   * Round 10 (#7, 33.2): how long a silence ends an utterance: command 0.6 s, dictation 1.0 s. Told to
   * the server now and after every reconnect. Optional: Chrome's recogniser has its own.
   */
  setEndpointMode?(mode: EndpointMode): void
  /** Ends the utterance being spoken now and delivers its words at once (push-to-talk released). Optional. */
  flush?(): void
  /** Round 4: learns the owner's voice from the next `seconds` of speech; answered through onEnrolled. Optional. */
  enrol?(seconds: number): void
  /** Round 7: scripted enrolment: each utterance is one read phrase, `phrases` of them; onEnrolPhrase after each, onEnrolled at the end. Optional. */
  enrolScript?(phrases: number): void
  /** Round 7: ends scripted enrolment now with the phrases read so far. Optional. */
  enrolFinish?(): void
  /** Round 10 (31.7): asks whether the voice check can protect; answered through onSpeakerStatus. Optional. */
  speakerStatus?(): void
  /** Round 10 (31.7): the next utterance is a voice test; answered through onSpeakerTested, never delivered. Optional. */
  speakerTest?(): void
  /** Round 10 (31.7): deletes the voice profile; answered through onProfileDeleted. Optional. */
  deleteProfile?(): void
}

export interface RecognizerHandlers {
  /**
   * One complete utterance, already joined across pauses. Round 10 (31.3): with only the owner
   * obeyed, decision is the verified owner decision of its newest final; absent otherwise.
   */
  onUtterance(text: string, decision?: SpeakerDecision): void
  /**
   * Round 4: a final that began with a connective ("siis ava Karin") soon after the last utterance
   * continues it: text is the whole joined utterance, added the new words. Optional; without it
   * the words come through onUtterance as an utterance of their own.
   */
  onUtteranceContinued?(text: string, added: string, decision?: SpeakerDecision): void
  /** What is being heard right now, for display only. Empty when nothing is in progress. */
  onInterim(text: string): void
  /**
   * Round 10 prompt 6 (QUICK, ARCHITECTURE 32.3): these words are done (a final arrived, before the
   * assembler's hold; never at the server's pause, review 2). Nothing may act on them: only an ask may
   * start early. With only the owner obeyed, only for an authorized final, with its decision.
   */
  onStable?(text: string, decision?: SpeakerDecision): void
  /** A problem the user should see. The microphone has stopped. */
  onError(message: string): void
  /** A line the user should see that needs no action: the microphone stays on. */
  onNotice?(message: string): void
  /** The recogniser is this many ms behind the speech (it drops audio to catch up); 0 once caught up. */
  onLag?(ms: number): void
  /**
   * Round 4: an utterance was someone else's voice and was dropped (only-owner mode). Round 7:
   * streak is how many finals in a row have been dropped (1 for the first; an obeyed final resets it).
   * Round 10 (31.5): reason is why it was not verified, when the server said.
   */
  onForeign?(streak: number, reason?: SpeakerReason): void
  /** Round 4: the server has learnt the owner's voice, or could not. Round 7: phrases, after scripted enrolment. Round 10: detail, when the server said why or how it verified. */
  onEnrolled?(ok: boolean, seconds: number, phrases?: number, detail?: EnrolDetail): void
  /** Round 7: scripted enrolment has heard this many phrases. Round 10 (31.7): problem: the last phrase was not counted. */
  onEnrolPhrase?(count: number, problem?: PhraseProblem): void
  /** Round 10 (31.7): whether only-owner can protect right now. */
  onSpeakerStatus?(readiness: SpeakerReadiness): void
  /** Round 10 (31.7): the answer of a voice test. */
  onSpeakerTested?(result: SpeakerTestResult, score?: number): void
  /** Round 10 (31.7): the profile was deleted (or not). */
  onProfileDeleted?(ok: boolean): void
  /** Round 9 (30.1): the socket to the server changed: connecting (a start), connected (ready), down (refused or lost). Once per change. */
  onConnection?(state: 'connecting' | 'connected' | 'down'): void
}
