import { createAssembler } from './assembler.ts'
import type { Recognizer, RecognizerHandlers } from './recognizer.ts'

/** The parts of the browser's SpeechRecognition this adapter uses. */
interface RecognitionResult extends ArrayLike<{ transcript: string }> {
  isFinal: boolean
}

interface RecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}

interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  lang: string
  onresult: ((event: RecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start(): void
  stop(): void
}

type RecognitionConstructor = new () => RecognitionLike

export const HOLD_MS = 1200
const RESTART_MS = 250

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked for this page. Allow it in the address bar, or type instead.',
  'service-not-allowed': 'Speech recognition is not allowed in this browser. Type instead.',
  'audio-capture': 'No microphone was found. Plug one in, or type instead.',
  network: 'This browser could not reach its speech service. Open the page in Google Chrome and check the connection, or type instead.',
  'language-not-supported': 'This browser cannot recognise that language. Switch language, or type instead.',
}

/** Errors after which restarting would only fail again. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'])

/**
 * Chrome's built-in speech recognition behind the Recognizer interface.
 * Keeps listening until stopped: Chrome ends a session after a silence, so it is restarted.
 */
export function createWebSpeechRecognizer(
  handlers: RecognizerHandlers,
  initialLang: string,
  isInstant: (text: string) => boolean,
): Recognizer {
  const Recognition = recognitionConstructor()
  const assembler = createAssembler({ holdMs: HOLD_MS, onUtterance: handlers.onUtterance, isInstant })
  let lang = initialLang
  let running = false
  let current: RecognitionLike | null = null
  let restart: ReturnType<typeof setTimeout> | null = null

  const begin = (): void => {
    if (!Recognition || !running) return
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 3
    recognition.lang = lang

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result) continue
        const readings = Array.from({ length: result.length }, (_, k) => result[k]?.transcript ?? '')
        const [first = '', ...alternatives] = readings
        if (result.isFinal) {
          assembler.final(first, alternatives)
        } else {
          interim += first
        }
      }
      if (interim.trim() !== '') assembler.activity()
      handlers.onInterim(interim.trim())
    }

    recognition.onerror = (event) => {
      const message = ERRORS[event.error]
      if (FATAL.has(event.error)) running = false
      if (message) handlers.onError(message)
    }

    recognition.onend = () => {
      current = null
      handlers.onInterim('')
      if (running) restart = setTimeout(begin, RESTART_MS)
    }

    current = recognition
    try {
      recognition.start()
    } catch {
      current = null
      running = false
      handlers.onError('Speech recognition could not start. Type instead.')
    }
  }

  return {
    supported: Recognition !== null,
    start() {
      if (running || !Recognition) return
      running = true
      begin()
    },
    stop() {
      running = false
      if (restart !== null) clearTimeout(restart)
      restart = null
      assembler.dispose()
      current?.stop()
    },
    setLang(next) {
      lang = next
      // Ending the session makes onend start a new one in the new language.
      if (running) current?.stop()
    },
  }
}
