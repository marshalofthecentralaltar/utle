import { createAssembler } from './assembler.ts'
import type { Recognizer, RecognizerHandlers } from './recognizer.ts'

/** The parts of the browser's SpeechRecognition this adapter uses. */
interface RecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: RecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start(): void
  stop(): void
}

type RecognitionConstructor = new () => RecognitionLike

const HOLD_MS = 1200
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
  network: 'Speech recognition needs an internet connection. Type instead.',
  'language-not-supported': 'This browser cannot recognise that language. Switch language, or type instead.',
}

/** Errors after which restarting would only fail again. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'])

/**
 * Chrome's built-in speech recognition behind the Recognizer interface.
 * Keeps listening until stopped: Chrome ends a session after a silence, so it is restarted.
 */
export function createWebSpeechRecognizer(handlers: RecognizerHandlers, initialLang: string): Recognizer {
  const Recognition = recognitionConstructor()
  const assembler = createAssembler({ holdMs: HOLD_MS, onUtterance: handlers.onUtterance })
  let lang = initialLang
  let running = false
  let current: RecognitionLike | null = null
  let restart: ReturnType<typeof setTimeout> | null = null

  const begin = (): void => {
    if (!Recognition || !running) return
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result?.[0]?.transcript ?? ''
        if (result?.isFinal) {
          assembler.final(transcript)
        } else {
          interim += transcript
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
