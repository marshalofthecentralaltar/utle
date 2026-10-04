import { useEffect } from 'react'
import { DocumentView } from './DocumentView.tsx'
import { SidePanel } from './SidePanel.tsx'
import { VoiceBar } from './VoiceBar.tsx'
import { useSession } from './useSession.ts'

/** Elements that use space, enter and escape themselves. */
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable]') !== null
}

export function App() {
  const { session, dispatch, reset, mic, status } = useSession()

  // Any single switch can stand in for yes: space or enter confirms, escape rejects.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isInteractive(event.target)) return
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        dispatch({ type: 'key', key: 'confirm' })
      } else if (event.key === 'Escape') {
        dispatch({ type: 'key', key: 'reject' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  return (
    <main className="mx-auto flex max-w-[68rem] flex-col gap-6 px-5 pt-7 pb-16">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-5xl leading-none font-bold">Ütle</h1>
        <p className="max-w-[60ch] text-lg">
          Say what to change. See what was understood. Fix it in one word.
        </p>
        {status?.mode === 'rehearsal' && (
          <p className="self-start bg-warn-soft px-2 py-1 text-[0.94rem] text-warn">
            Rehearsal mode. Answers come from the demo script, not from a model.
          </p>
        )}
        {status === null && (
          <p className="self-start bg-warn-soft px-2 py-1 text-[0.94rem] text-warn">
            The server is not answering. Start it with npm run dev.
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 items-start gap-5 min-[820px]:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="flex flex-col border border-rule bg-surface">
          <div className="flex flex-wrap justify-between gap-3 border-b border-rule px-3.5 py-2 font-mono text-xs text-muted">
            <span>minutes-5-october.docx</span>
            <span>Changes are tracked</span>
          </div>
          <DocumentView session={session} />
          <VoiceBar session={session} interim={mic.interim} micOn={mic.on} dispatch={dispatch} />
        </section>
        <SidePanel session={session} mic={mic} dispatch={dispatch} reset={reset} />
      </div>
    </main>
  )
}
