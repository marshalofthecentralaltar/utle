import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Event, Session } from '../core/session.ts'
import { LANGUAGES } from '../speech/recognizer.ts'
import type { Microphone } from './useSession.ts'

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <b className="block font-display text-2xl leading-tight tabular-nums">{value}</b>
      <span className="text-[0.8rem] text-muted">{label}</span>
    </div>
  )
}

/** Microphone, the typed fallback, the counters and the list of finished edits. */
export function SidePanel(props: { session: Session; mic: Microphone; dispatch(event: Event): void; reset(): void }) {
  const { session, mic, dispatch, reset } = props
  const [typed, setTyped] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (typed.trim() === '') return
    dispatch({ type: 'utterance', text: typed, source: 'typed' })
    setTyped('')
  }

  return (
    <aside className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={mic.toggle}
          disabled={!mic.supported}
          className="cursor-pointer border border-accent bg-accent px-4 py-2.5 font-semibold text-surface disabled:cursor-default disabled:opacity-50"
        >
          {mic.on ? 'Turn microphone off' : 'Turn microphone on'}
        </button>
        <label className="flex items-center gap-2 text-[0.94rem] text-muted">
          Language
          <select
            id="lang"
            value={mic.lang}
            onChange={(event) => mic.setLang(event.target.value)}
            className="border border-rule bg-surface px-2 py-1.5 text-ink"
          >
            {LANGUAGES.map((language) => (
              <option key={language.tag} value={language.tag}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!mic.supported && (
        <p className="text-[0.94rem] text-warn">This browser has no speech recognition. Use Chrome, or type below.</p>
      )}
      {mic.error !== '' && <p className="text-[0.94rem] text-warn">{mic.error}</p>}

      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <label htmlFor="typed" className="text-[0.94rem] text-muted">
          Or type what you would say
        </label>
        <div className="flex gap-2">
          <input
            id="typed"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            placeholder="Change the budget deadline to Friday"
            className="min-w-0 flex-1 border border-rule bg-surface px-2.5 py-2 text-ink"
          />
          <button type="submit" className="cursor-pointer border border-accent px-3 py-2 font-semibold text-accent">
            Say
          </button>
        </div>
      </form>

      <div className="grid grid-cols-3 gap-2.5 border-y border-rule py-2.5">
        <Stat value={session.history.length} label="edits finished" />
        <Stat value={session.words} label="words spoken" />
        <Stat value={session.hands} label="times a hand was used" />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-lg font-medium">Tracked changes</h2>
        {session.log.length === 0 ? (
          <p className="text-[0.94rem] text-muted">None yet.</p>
        ) : (
          <ul className="flex list-none flex-col gap-1.5 p-0 text-[0.94rem]">
            {session.log.map((line, i) => (
              <li key={i} className="border-l-[3px] border-accent pl-2">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" onClick={reset} className="cursor-pointer self-start text-[0.94rem] text-accent underline">
        Start again with the sample document
      </button>
    </aside>
  )
}
