import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchStatus, requestIntent } from '../api/interpretClient.ts'
import type { ServerStatus } from '../api/interpretClient.ts'
import { SAMPLE_DOC } from '../core/document.ts'
import { initialSession, step } from '../core/session.ts'
import type { Effect, Event, Session } from '../core/session.ts'
import type { Recognizer } from '../speech/recognizer.ts'
import { createWebSpeechRecognizer } from '../speech/webSpeech.ts'

export interface Microphone {
  supported: boolean
  on: boolean
  /** What is being heard right now. */
  interim: string
  error: string
  lang: string
  toggle(): void
  setLang(lang: string): void
}

export interface SessionApi {
  session: Session
  dispatch(event: Event): void
  reset(): void
  mic: Microphone
  status: ServerStatus | null
}

/**
 * Holds the session and runs the effects the reducer asks for.
 * All conversation logic lives in core/session.ts; this hook only connects it to the
 * network, the microphone and React.
 */
export function useSession(): SessionApi {
  const [session, setSession] = useState<Session>(() => initialSession(SAMPLE_DOC))
  const current = useRef(session)
  const dispatchRef = useRef<(event: Event) => void>(() => {})

  const run = useCallback((effect: Effect): void => {
    requestIntent(effect.request).then(
      (intent) => dispatchRef.current({ type: 'intent', seq: effect.seq, intent }),
      (error: unknown) =>
        dispatchRef.current({
          type: 'interpretFailed',
          seq: effect.seq,
          message: error instanceof Error ? error.message : 'The assistant failed.',
        }),
    )
  }, [])

  const dispatch = useCallback(
    (event: Event): void => {
      const { state, effects } = step(current.current, event)
      current.current = state
      setSession(state)
      effects.forEach(run)
    },
    [run],
  )

  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

  const reset = useCallback((): void => {
    const fresh = initialSession(SAMPLE_DOC)
    // A bumped seq makes any answer still in flight stale.
    const next = { ...fresh, seq: current.current.seq + 1 }
    current.current = next
    setSession(next)
  }, [])

  const [status, setStatus] = useState<ServerStatus | null>(null)
  useEffect(() => {
    let alive = true
    void fetchStatus().then((value) => {
      if (alive) setStatus(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const recognizer = useRef<Recognizer | null>(null)
  const [supported, setSupported] = useState(true)
  const [on, setOn] = useState(false)
  const onRef = useRef(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [lang, setLangState] = useState('en-US')

  useEffect(() => {
    const created = createWebSpeechRecognizer(
      {
        onUtterance: (text) => dispatchRef.current({ type: 'utterance', text, source: 'voice' }),
        onInterim: setInterim,
        onError: (message) => {
          setError(message)
          onRef.current = false
          setOn(false)
        },
      },
      'en-US',
    )
    recognizer.current = created
    setSupported(created.supported)
    return () => {
      created.stop()
      recognizer.current = null
    }
  }, [])

  const toggle = useCallback((): void => {
    const r = recognizer.current
    if (!r?.supported) return
    setError('')
    if (onRef.current) r.stop()
    else r.start()
    onRef.current = !onRef.current
    setOn(onRef.current)
  }, [])

  const setLang = useCallback((next: string): void => {
    setLangState(next)
    recognizer.current?.setLang(next)
  }, [])

  return { session, dispatch, reset, mic: { supported, on, interim, error, lang, toggle, setLang }, status }
}
