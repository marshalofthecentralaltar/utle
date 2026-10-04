import type { Event, Mode, Session } from '../core/session.ts'

const LABEL: Record<Mode, string> = {
  listening: 'Listening',
  thinking: 'Working',
  confirming: 'Waiting for yes or no',
  choosing: 'Waiting for a number',
  asleep: 'Asleep',
}

const DOT: Record<Mode, string> = {
  listening: 'bg-live',
  thinking: 'bg-wait animate-pulse',
  confirming: 'bg-wait',
  choosing: 'bg-wait',
  asleep: 'bg-sleep',
}

function Line({ name, children }: { name: string; children: string }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2">
      <span className="font-mono text-xs tracking-wider text-bar-muted uppercase">{name}</span>
      <span>{children}</span>
    </div>
  )
}

/** What the editor heard, what it made of it, and what can be said next. */
export function VoiceBar(props: { session: Session; interim: string; micOn: boolean; dispatch(event: Event): void }) {
  const { session, interim, micOn, dispatch } = props
  const label = !micOn && session.mode === 'listening' ? 'Microphone off' : LABEL[session.mode]
  const dot = !micOn && session.mode === 'listening' ? 'bg-sleep' : DOT[session.mode]

  return (
    <div aria-live="polite" className="flex flex-col gap-2 bg-bar px-4 py-3.5 text-bar-ink">
      <div className="flex items-center gap-2 font-mono text-xs tracking-wider text-bar-muted uppercase">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span>{label}</span>
      </div>
      <Line name="Heard">{interim !== '' ? `${interim} …` : session.heard || 'Nothing yet.'}</Line>
      <Line name="Understood">{session.understood}</Line>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[0.94rem] text-bar-muted">{session.prompt}</span>
        {session.mode === 'confirming' && (
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => dispatch({ type: 'key', key: 'confirm' })}
              className="cursor-pointer border border-live px-3 py-1 font-semibold text-live"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'key', key: 'reject' })}
              className="cursor-pointer border border-bar-muted px-3 py-1 font-semibold text-bar-ink"
            >
              No
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
