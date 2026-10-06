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
}

export interface RecognizerHandlers {
  /** One complete utterance, already joined across pauses. */
  onUtterance(text: string): void
  /** What is being heard right now, for display only. Empty when nothing is in progress. */
  onInterim(text: string): void
  /** A problem the user should see. The microphone has stopped. */
  onError(message: string): void
  /** A line the user should see that needs no action: the microphone stays on. */
  onNotice?(message: string): void
  /** The recogniser is this many ms behind the speech (it drops audio to catch up); 0 once caught up. */
  onLag?(ms: number): void
  /** Round 4: an utterance was someone else's voice and was dropped (only-owner mode). */
  onForeign?(): void
  /** Round 4: the server has learnt the owner's voice, or could not. */
  onEnrolled?(ok: boolean, seconds: number): void
}

export const LANGUAGES = [
  { tag: 'en-US', label: 'English' },
  { tag: 'et-EE', label: 'Eesti' },
] as const
