import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Event, Session } from '../core/session.ts'

function Line({ who, children }: { who: string; children: ReactNode }) {
  return (
    <p className="m-0 grid grid-cols-[3.2rem_minmax(0,1fr)] items-baseline gap-x-3">
      <span className="text-[0.95rem] text-strip-soft">{who}</span>
      <span>{children}</span>
    </p>
  )
}

/**
 * The conversation as captions, fixed to the bottom and set large enough to read from a metre
 * away: what you said, and what Ütle made of it. The typed box is the fallback for speech.
 */
export function CaptionStrip(props: { session: Session; interim: string; dispatch(event: Event): void }) {
  const { session, interim, dispatch } = props
  const [typed, setTyped] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (typed.trim() === '') return
    dispatch({ type: 'utterance', text: typed, source: 'typed' })
    setTyped('')
  }

  const you = interim !== '' ? interim : session.heard

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-strip-edge bg-strip text-strip-ink">
      <div className="mx-auto flex max-w-[76rem] flex-wrap items-end justify-between gap-x-8 gap-y-3 px-5 py-4">
        <div aria-live="polite" className="flex min-w-0 flex-1 basis-[28rem] flex-col gap-1 text-[clamp(1.1rem,1.6vw,1.4rem)] leading-snug">
          <Line who="You">
            {you === '' ? <span className="text-strip-soft">Nothing yet.</span> : <span className={interim !== '' ? 'text-strip-soft' : ''}>{you}</span>}
          </Line>
          <Line who="Ütle">
            <span className="font-semibold">{session.understood}</span> <span className="text-strip-soft">{session.prompt}</span>
          </Line>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {session.mode === 'confirming' && (
            <>
              <button
                type="button"
                onClick={() => dispatch({ type: 'key', key: 'confirm' })}
                className="cursor-pointer border border-strip-ink bg-strip-ink px-4 py-1.5 font-semibold text-strip"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'key', key: 'reject' })}
                className="cursor-pointer border border-strip-soft px-4 py-1.5 font-semibold text-strip-ink"
              >
                No
              </button>
            </>
          )}
          <form onSubmit={submit} className="flex gap-2">
            <label htmlFor="typed" className="sr-only">
              Type instead of speaking
            </label>
            <input
              id="typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              placeholder="Type instead of speaking"
              className="w-60 border border-strip-edge bg-transparent px-2.5 py-1.5 text-strip-ink placeholder:text-strip-soft"
            />
            <button type="submit" className="cursor-pointer border border-strip-soft px-3 py-1.5 font-semibold text-strip-ink">
              Say
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
