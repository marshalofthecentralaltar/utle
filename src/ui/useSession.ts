import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { fetchStatus, requestIntent } from '../api/interpretClient.ts'
import type { ServerStatus } from '../api/interpretClient.ts'
import { sendCommand } from '../browser/bridge.ts'
import { installFakeBridge } from '../browser/fakeBridge.ts'
import { browserIntent } from '../core/browserIntent.ts'
import { sampleDoc } from '../core/document.ts'
import { messageCommand } from '../core/message.ts'
import { localIntent } from '../core/localIntent.ts'
import { quickReply } from '../core/quickReply.ts'
import { initialSession, step } from '../core/session.ts'
import { LANG_TAG, langOfTag } from '../core/strings.ts'
import type { Effect, Event, Session } from '../core/session.ts'
import { createLevelMeter } from '../speech/level.ts'
import { DEMO_SCRIPT } from '../speech/lines.ts'
import type { Recognizer } from '../speech/recognizer.ts'
import { createScriptedRecognizer } from '../speech/scripted.ts'
import { hush, speak } from '../speech/synth.ts'
import { createRecognizer } from '../speech/pick.ts'
import { HOLD_MS } from '../speech/webSpeech.ts'

export interface Microphone {
  supported: boolean
  on: boolean
  /** What is being heard right now. */
  interim: string
  error: string
  lang: string
  /** True when the page is playing the scripted demo instead of listening to a person. */
  demo: boolean
  /** Loudness from 0 to 1, read by the wordmark without re-rendering the page. */
  level: RefObject<number>
  toggle(): void
  setLang(lang: string): void
}

export interface SessionApi {
  session: Session
  dispatch(event: Event): void
  reset(): void
  mic: Microphone
  status: ServerStatus | null | undefined
  /** True when the page answers browser commands itself (?bridge=fake). */
  fakeBridge: boolean
}

const DEMO_TIMING = { startMs: 1400, wordMs: 190, gapMs: 1500, pauseMs: 700, holdMs: HOLD_MS }

function remembered(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage is a convenience; the page works without it.
  }
}

/** True when the page was opened with ?bridge=fake. */
export function isFakeBridge(): boolean {
  return new URLSearchParams(window.location.search).get('bridge') === 'fake'
}

/** True when the page was opened with ?voice=demo. */
export function isDemo(): boolean {
  return new URLSearchParams(window.location.search).get('voice') === 'demo'
}

/**
 * Holds the session and runs the effects the reducer asks for.
 * All conversation logic lives in core/session.ts; this hook only connects it to the
 * network, the microphone, the loudspeaker and React.
 */
export function useSession(paused: boolean): SessionApi {
  // Estonian first: a fresh profile listens, shows and answers in Estonian.
  const [lang, setLangState] = useState(() => remembered('utle.lang') ?? LANG_TAG.et)
  const [session, setSession] = useState<Session>(() => initialSession(sampleDoc(langOfTag(lang)), langOfTag(lang)))
  const current = useRef(session)
  const dispatchRef = useRef<(event: Event) => void>(() => {})
  const langRef = useRef(lang)
  const [demo] = useState(isDemo)
  const [fakeBridge] = useState(isFakeBridge)

  useEffect(() => (fakeBridge ? installFakeBridge(window) : undefined), [fakeBridge])

  const run = useCallback((effect: Effect): void => {
    switch (effect.type) {
      case 'interpret':
        requestIntent(effect.request).then(
          (intent) => dispatchRef.current({ type: 'intent', seq: effect.seq, intent }),
          (error: unknown) =>
            dispatchRef.current({
              type: 'interpretFailed',
              seq: effect.seq,
              message: error instanceof Error ? error.message : 'The assistant failed.',
            }),
        )
        break
      case 'speak':
        speak(effect.text, langRef.current, () => dispatchRef.current({ type: 'speechEnded' }))
        break
      case 'hush':
        hush()
        break
      case 'browser':
        void sendCommand(effect.command).then((result) =>
          dispatchRef.current({ type: 'browserResult', seq: effect.seq, command: effect.command, result }),
        )
        break
    }
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
    hush()
    // A bumped seq makes any answer still in flight stale.
    const language = current.current.lang
    const next = { ...initialSession(sampleDoc(language), language), seq: current.current.seq + 1, bridgeSeq: current.current.bridgeSeq + 1 }
    current.current = next
    setSession(next)
  }, [])

  const [status, setStatus] = useState<ServerStatus | null | undefined>(undefined)
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
  const level = useRef(0)
  const onRef = useRef(false)
  const [supported, setSupported] = useState(true)
  const [on, setOn] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  const setMic = useCallback((next: boolean): void => {
    const r = recognizer.current
    if (!r?.supported || onRef.current === next) return
    if (next) r.start()
    else r.stop()
    onRef.current = next
    setOn(next)
  }, [])

  useEffect(() => {
    /** Text that must not wait for the pause-joining hold. */
    const isInstant = (text: string): boolean => {
      const now = current.current
      if (quickReply(text, { expectNumber: now.mode === 'choosing' }) !== null) return true
      if (localIntent(text, now.doc, now.focusId, now.lang) !== null || browserIntent(text) !== null) return true
      // A one-breath message is a sentence and may be split by a pause; the rest are short commands.
      const message = messageCommand(text)
      return message !== null && !(message.kind === 'start' && message.text !== null)
    }
    const handlers = {
      onUtterance: (text: string) => dispatchRef.current({ type: 'utterance', text, source: 'voice' }),
      onInterim: (text: string) => {
        setInterim(text)
        if (demo) level.current = text === '' ? 0 : 0.35 + Math.random() * 0.55
      },
      onError: (message: string) => {
        setError(message)
        onRef.current = false
        setOn(false)
      },
    }
    const created = demo
      ? createScriptedRecognizer(handlers, DEMO_SCRIPT, { ...DEMO_TIMING, isInstant })
      : createRecognizer(handlers, langRef.current, isInstant)
    recognizer.current = created
    setSupported(created.supported)

    return () => {
      created.stop()
      recognizer.current = null
      onRef.current = false
    }
  }, [demo])

  // The level meter follows the microphone.
  useEffect(() => {
    if (demo || !on) return
    const meter = createLevelMeter((value) => (level.current = value))
    void meter.start()
    return () => meter.stop()
  }, [demo, on])

  // Hands-free start: the scripted demo always starts; a real microphone starts by itself
  // only when the browser already holds permission and it was on last time.
  useEffect(() => {
    if (paused) return
    if (demo) {
      setMic(true)
      return
    }
    if (remembered('utle.mic') !== 'on' || !('permissions' in navigator)) return
    let alive = true
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((permission) => {
        if (alive && permission.state === 'granted') setMic(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [demo, paused, setMic])

  // Another screen owns the microphone while this one is paused.
  useEffect(() => {
    if (paused) setMic(false)
  }, [paused, setMic])

  const toggle = useCallback((): void => {
    setError('')
    const next = !onRef.current
    setMic(next)
    remember('utle.mic', next ? 'on' : 'off')
  }, [setMic])

  const setLang = useCallback((next: string): void => {
    langRef.current = next
    setLangState(next)
    remember('utle.lang', next)
    recognizer.current?.setLang(next)
    dispatchRef.current({ type: 'language', lang: langOfTag(next) })
  }, [])

  return { session, dispatch, reset, mic: { supported, on, interim, error, lang, demo, level, toggle, setLang }, status, fakeBridge }
}
