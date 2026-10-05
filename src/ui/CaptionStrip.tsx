import { useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import type { Event, Session } from '../core/session.ts'
import { Wordmark } from './Wordmark.tsx'
import type { VoiceState } from './Wordmark.tsx'

/**
 * Ütle itself: one bar fixed to the bottom. The wordmark is the listening light; beside it
 * are your words while you speak, then what Ütle made of them. The typed box is the fallback
 * for speech.
 */
export function CaptionStrip(props: {
  session: Session
  interim: string
  voice: VoiceState
  level: RefObject<number>
  dispatch(event: Event): void
}) {
  const { session, interim, voice, level, dispatch } = props
  const [typed, setTyped] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (typed.trim() === '') return
    dispatch({ type: 'utterance', text: typed, source: 'typed' })
    setTyped('')
  }

  const hearing = interim !== ''
  const asleep = voice === 'asleep'

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-edge-strong bg-glass backdrop-blur-md">
      <div className="mx-auto grid max-w-[80rem] grid-cols-[var(--gutter)_minmax(0,1fr)] items-baseline gap-y-0.5 pt-5 pr-5 pb-6 min-[1000px]:grid-cols-[var(--gutter)_minmax(0,1fr)_auto] min-[1000px]:pr-[7.5rem]">
        <p aria-live="polite" className="col-start-2 row-start-1 m-0 min-h-6 text-base text-soft">
          {hearing ? '' : session.heard}
        </p>
        <div className="col-start-1 row-start-2 mr-3.5 justify-self-end">
          <Wordmark voice={voice} level={level} />
        </div>
        <p aria-live="polite" className="col-start-2 row-start-2 m-0 text-[clamp(1.15rem,1.7vw,1.375rem)] leading-[1.35] min-[1000px]:pr-8">
          {hearing ? (
            <span className="text-soft">{interim}</span>
          ) : (
            <>
              <span className={asleep ? 'text-soft' : 'font-semibold'}>{session.understood}</span> <span className="text-soft">{session.prompt}</span>
            </>
          )}
        </p>

        <div className="col-start-2 row-start-3 mt-3 flex flex-wrap items-center gap-2.5 min-[1000px]:col-start-3 min-[1000px]:row-span-2 min-[1000px]:row-start-1 min-[1000px]:mt-0 min-[1000px]:self-end">
          {session.mode === 'confirming' && (
            <>
              <button
                type="button"
                onClick={() => dispatch({ type: 'key', key: 'confirm' })}
                className="h-11 min-w-19 cursor-pointer border border-ink bg-ink px-4 font-semibold text-desk"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'key', key: 'reject' })}
                className="h-11 min-w-19 cursor-pointer border border-edge-strong bg-transparent px-4 font-semibold"
              >
                No
              </button>
            </>
          )}
          <form onSubmit={submit} className="flex">
            <label htmlFor="typed" className="sr-only">
              Type instead of speaking
            </label>
            <input
              id="typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              placeholder="Type instead of speaking"
              className="h-11 w-48 rounded-none border-0 border-b border-edge-strong bg-transparent px-0 text-sm placeholder:text-soft focus:border-ink focus:outline-none"
            />
            <button type="submit" className="sr-only">
              Say
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
