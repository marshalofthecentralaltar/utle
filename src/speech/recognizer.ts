/** A source of spoken utterances. Chrome's built-in recognition today; a paid recogniser can replace it. */
export interface Recognizer {
  start(): void
  stop(): void
  /** BCP 47 tag, for example 'en-US' or 'et-EE'. Takes effect at once when running. */
  setLang(lang: string): void
  /** False when the browser has no speech recognition. The typed box still works. */
  readonly supported: boolean
}

export interface RecognizerHandlers {
  /** One complete utterance, already joined across pauses. */
  onUtterance(text: string): void
  /** What is being heard right now, for display only. Empty when nothing is in progress. */
  onInterim(text: string): void
  /** A problem the user should see. */
  onError(message: string): void
}

export const LANGUAGES = [
  { tag: 'en-US', label: 'English' },
  { tag: 'et-EE', label: 'Eesti' },
] as const
