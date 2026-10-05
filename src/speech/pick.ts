import { FELL_BACK, NOTHING_LEFT } from './asrProtocol.ts'
import { createLocalRecognizer, localRecognizerPossible } from './local.ts'
import { createMicrophoneFrames } from './microphone.ts'
import type { Recognizer, RecognizerHandlers } from './recognizer.ts'
import { createWebSpeechRecognizer } from './webSpeech.ts'

/**
 * Listens with `primary` until it reports that it cannot run, then switches once to `fallback`
 * in the current language, carrying on if the microphone was on, and shows one line.
 */
export function withFallback(
  primary: (onUnavailable: () => void) => Recognizer,
  fallback: (lang: string) => Recognizer,
  initialLang: string,
  handlers: Pick<RecognizerHandlers, 'onError' | 'onNotice'>,
): Recognizer {
  let lang = initialLang
  let running = false
  let switched = false

  const switchOver = (): void => {
    if (switched) return
    switched = true
    engine = fallback(lang)
    if (!engine.supported) {
      running = false
      handlers.onError(NOTHING_LEFT)
      return
    }
    handlers.onNotice?.(FELL_BACK)
    if (running) engine.start()
  }

  let engine: Recognizer = primary(switchOver)

  return {
    get supported() {
      return engine.supported
    },
    start() {
      running = true
      engine.start()
    },
    stop() {
      running = false
      engine.stop()
    },
    setLang(next) {
      lang = next
      engine.setLang(next)
    },
  }
}

/**
 * The recogniser the app listens with. The one place that chooses between engines, so the
 * interface and the voice check always hear through the same one: the local model on the dev
 * server first (ARCHITECTURE 20.1), Chrome's recognition when that cannot run.
 */
export function createRecognizer(
  handlers: RecognizerHandlers,
  lang: string,
  isInstant: (text: string) => boolean,
): Recognizer {
  const chrome = (current: string): Recognizer => createWebSpeechRecognizer(handlers, current, isInstant)
  if (!localRecognizerPossible()) return chrome(lang)
  return withFallback(
    (onUnavailable) => createLocalRecognizer(handlers, isInstant, { onUnavailable, audio: createMicrophoneFrames }),
    chrome,
    lang,
    handlers,
  )
}
