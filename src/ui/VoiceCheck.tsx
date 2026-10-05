import { useCallback, useEffect, useRef, useState } from 'react'
import { wordErrorRate } from '../core/wer.ts'
import { CHECK_DEMO, CHECK_LINES } from '../speech/lines.ts'
import { LANGUAGES } from '../speech/recognizer.ts'
import type { Recognizer } from '../speech/recognizer.ts'
import { createScriptedRecognizer } from '../speech/scripted.ts'
import { createWebSpeechRecognizer } from '../speech/webSpeech.ts'

const never = (): boolean => false

/**
 * Measures the recogniser, not the editor: read each line aloud and see what was written down.
 * Needs no server and no key. The score is word error rate, the standard measure.
 */
export function VoiceCheck({ lang, demo }: { lang: string; demo: boolean }) {
  const lines = CHECK_LINES[lang] ?? []
  const label = LANGUAGES.find((l) => l.tag === lang)?.label ?? lang
  const [heard, setHeard] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const recognizer = useRef<Recognizer | null>(null)
  const count = useRef(0)

  const stop = useCallback((): void => {
    recognizer.current?.stop()
    recognizer.current = null
    setRunning(false)
    setInterim('')
  }, [])

  const start = useCallback((): void => {
    if (recognizer.current) return
    setError('')
    const handlers = {
      onUtterance: (text: string) => {
        count.current += 1
        setHeard((previous) => [...previous, text])
        if (count.current >= lines.length) stop()
      },
      onInterim: setInterim,
      onError: (message: string) => {
        setError(message)
        stop()
      },
    }
    const created = demo
      ? createScriptedRecognizer(handlers, CHECK_DEMO, { startMs: 500, wordMs: 110, gapMs: 350, pauseMs: 0, holdMs: 500, isInstant: never })
      : createWebSpeechRecognizer(handlers, lang, never)
    if (!created.supported) {
      setError('This browser has no speech recognition. Use Chrome.')
      return
    }
    recognizer.current = created
    created.start()
    setRunning(true)
  }, [demo, lang, lines.length, stop])

  const restart = useCallback((): void => {
    stop()
    count.current = 0
    setHeard([])
    setCopied(false)
  }, [stop])

  // A new language is a new test: the parent remounts this component, so only cleanup is needed.
  useEffect(() => stop, [stop])

  // The scripted run needs no person to press start.
  useEffect(() => {
    if (demo) start()
  }, [demo, start])

  const scores = heard.map((text, i) => wordErrorRate(lines[i] ?? '', text))
  const words = scores.reduce((sum, score) => sum + score.words, 0)
  const errors = scores.reduce((sum, score) => sum + score.errors, 0)
  const percent = words === 0 ? 0 : Math.round((errors / words) * 1000) / 10
  const finished = heard.length >= lines.length && lines.length > 0

  const report = [
    `Ütle voice check, ${label}: ${errors} of ${words} words wrong (${percent} percent).`,
    ...heard.map((text, i) => `${i + 1}. expected "${lines[i] ?? ''}" heard "${text}" errors ${scores[i]?.errors ?? 0}`),
  ].join('\n')

  const copy = (): void => {
    navigator.clipboard.writeText(report).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <section className="flex max-w-[52rem] flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[1.75rem] leading-tight font-extrabold tracking-tight">Voice check, {label}</h1>
        <p className="m-0 max-w-[62ch] text-lg">
          Read each line aloud. The next line lights up when one has been heard. The score is the share of words the
          recogniser got wrong.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" onClick={stop} className="cursor-pointer border border-ink bg-ink px-4 py-2 font-semibold text-desk">
            Stop
          </button>
        ) : (
          !finished && (
            <button type="button" onClick={start} className="cursor-pointer border border-ink bg-ink px-4 py-2 font-semibold text-desk">
              {heard.length === 0 ? 'Start' : 'Continue'}
            </button>
          )
        )}
        {heard.length > 0 && (
          <button type="button" onClick={restart} className="cursor-pointer border border-ink px-4 py-2 font-semibold">
            Start over
          </button>
        )}
        {heard.length > 0 && (
          <button type="button" onClick={copy} className="cursor-pointer border border-ink px-4 py-2 font-semibold">
            {copied ? 'Copied' : 'Copy the result'}
          </button>
        )}
      </div>
      {error !== '' && <p className="m-0 text-pencil-red">{error}</p>}

      <ol className="m-0 flex list-none flex-col p-0 text-lg">
        {lines.map((line, i) => {
          const score = scores[i]
          const current = running && i === heard.length
          return (
            <li
              key={line}
              className={`grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-l-2 py-2 ${current ? 'border-ink' : 'border-transparent'}`}
            >
              <span className={`text-right text-[0.8rem] tabular-nums ${current ? 'font-extrabold text-ink' : 'text-soft'}`}>{i + 1}</span>
              <span className="flex flex-col">
                <span className={current ? 'font-semibold' : ''}>{line}</span>
                {score ? (
                  <span className={score.errors === 0 ? 'text-soft' : 'text-pencil-red'}>{heard[i]}</span>
                ) : (
                  current && <span className="text-soft">{interim === '' ? 'Listening.' : interim}</span>
                )}
              </span>
              <span className="text-[0.95rem] text-soft tabular-nums">
                {score ? (score.errors === 0 ? 'right' : `${score.errors} wrong`) : ''}
              </span>
            </li>
          )
        })}
      </ol>

      {heard.length > 0 && (
        <p className="m-0 text-lg">
          <b className="text-2xl font-extrabold tabular-nums">{percent}</b> percent of words wrong: {errors} of {words}
          {finished ? '.' : ' so far.'}
        </p>
      )}
    </section>
  )
}
