import type { Recognizer, RecognizerHandlers } from './recognizer.ts'
import { createWebSpeechRecognizer } from './webSpeech.ts'

/**
 * The recogniser the app listens with. The one place that chooses between engines, so the
 * interface and the voice check always hear through the same one.
 */
export function createRecognizer(
  handlers: RecognizerHandlers,
  lang: string,
  isInstant: (text: string) => boolean,
): Recognizer {
  return createWebSpeechRecognizer(handlers, lang, isInstant)
}
