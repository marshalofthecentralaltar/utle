import { useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import type { Event, Session } from '../core/session.ts'
import { STRINGS } from '../core/strings.ts'
import { DwellButton } from './DwellButton.tsx'
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
  mic: { on: boolean; supported: boolean; toggle(): void }
}) {
  const { session, interim, voice, level, dispatch, mic } = props
  const t = STRINGS[session.lang].ui
  const answering = session.mode === 'confirming' || session.mode === 'confirmingSend'
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
          {/* The gaze target: big enough for an eye tracker, toggled by a click or by resting on it. */}
          <DwellButton
            onActivate={mic.toggle}
            disabled={!mic.supported}
            pressed={mic.on}
            label={t.microphone}
            data={{ listening: mic.on ? 'true' : 'false', control: 'microphone' }}
            fill={mic.on ? 'bg-ink/25' : 'bg-signal/30'}
            className={`flex flex-col items-center justify-center gap-1.5 border-2 px-2 font-semibold disabled:cursor-default disabled:opacity-50 ${
              mic.on ? 'border-signal bg-signal text-desk' : 'border-edge-strong bg-transparent text-ink'
            }`}
          >
            <span aria-hidden="true" className={`block size-4 rounded-full border-2 ${mic.on ? 'border-desk bg-desk' : 'border-signal bg-transparent'}`} />
            <span className="text-[0.8125rem] leading-tight">{mic.on ? t.micListening : t.micNotListening}</span>
          </DwellButton>
          {answering && (
            <>
              <DwellButton
                onActivate={() => dispatch({ type: 'key', key: 'confirm' })}
                data={{ control: 'yes' }}
                fill="bg-pencil-blue/40"
                className="border border-ink bg-ink px-4 font-semibold text-desk"
              >
                {t.yes}
              </DwellButton>
              <DwellButton
                onActivate={() => dispatch({ type: 'key', key: 'reject' })}
                data={{ control: 'no' }}
                fill="bg-pencil-red/25"
                className="border border-edge-strong bg-transparent px-4 font-semibold"
              >
                {t.no}
              </DwellButton>
            </>
          )}
          <form onSubmit={submit} className="flex">
            <label htmlFor="typed" className="sr-only">
              {t.typeInstead}
            </label>
            <input
              id="typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              placeholder={t.typeInstead}
              className="h-11 w-48 rounded-none border-0 border-b border-edge-strong bg-transparent px-0 text-sm placeholder:text-soft focus:border-ink focus:outline-none"
            />
            <button type="submit" className="sr-only">
              {t.say}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
