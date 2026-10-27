import type { SpeakerDecision, SpeakerReason } from './asrProtocol.ts'

/** A source of spoken utterances. Chrome's built-in recognition today; a paid recogniser can replace it. */
export interface Recognizer {
  start(): void
  stop(): void
  /** BCP 47 tag, for example 'en-US' or 'et-EE'. Takes effect at once when running. */
  setLang(lang: string): void
  /** False when the browser has no speech recognition. The typed box still works. */
  readonly supported: boolean
  /** Ends the utterance being spoken now and delivers its words at once (push-to-talk released). Optional. */
  flush?(): void
  /** Round 4: learns the owner's voice from the next `seconds` of speech; answered through onEnrolled. Optional. */
  enrol?(seconds: number): void
  /** Round 7: scripted enrolment: each utterance is one read phrase, `phrases` of them; onEnrolPhrase after each, onEnrolled at the end. Optional. */
  enrolScript?(phrases: number): void
  /** Round 7: ends scripted enrolment now with the phrases read so far. Optional. */
  enrolFinish?(): void
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
  /** Round 4: the server has learnt the owner's voice, or could not. Round 7: phrases, after scripted enrolment. */
  onEnrolled?(ok: boolean, seconds: number, phrases?: number): void
  /** Round 7: scripted enrolment has heard this many phrases. */
  onEnrolPhrase?(count: number): void
  /** Round 9 (30.1): the socket to the server changed: connecting (a start), connected (ready), down (refused or lost). Once per change. */
  onConnection?(state: 'connecting' | 'connected' | 'down'): void
}

export const LANGUAGES = [
  { tag: 'en-US', label: 'English' },
  { tag: 'et-EE', label: 'Eesti' },
] as const
