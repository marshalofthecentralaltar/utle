import { useEffect, useState } from 'react'
import { LANGUAGES } from '../speech/recognizer.ts'
import { CaptionStrip } from './CaptionStrip.tsx'
import { DocumentView } from './DocumentView.tsx'
import { Margin } from './Margin.tsx'
import { VoiceCheck } from './VoiceCheck.tsx'
import { Wordmark } from './Wordmark.tsx'
import type { VoiceState } from './Wordmark.tsx'
import { useSession } from './useSession.ts'

type View = 'editor' | 'check'

function viewFromHash(): View {
  return window.location.hash === '#check' ? 'check' : 'editor'
}

/** Elements that use space, enter and escape themselves. */
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable]') !== null
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash)
  const { session, dispatch, reset, mic, status } = useSession(view === 'check')

  useEffect(() => {
    const onHash = (): void => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Any single switch can stand in for yes: space or enter confirms, escape rejects.
  useEffect(() => {
    if (view !== 'editor') return
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
  }, [dispatch, view])

  const voice: VoiceState = !mic.on
    ? 'off'
    : session.mode === 'asleep'
      ? 'asleep'
      : session.mode === 'thinking'
        ? 'thinking'
        : session.reading
          ? 'reading'
          : 'listening'

  const notices: string[] = []
  if (mic.demo) notices.push('This is the scripted demo. Nobody is speaking; the lines play by themselves.')
  if (status?.mode === 'rehearsal') notices.push('Rehearsal: answers come from the demo script, not from a model.')
  if (status === null) notices.push('The server is not answering. Start it with npm run dev.')
  if (!mic.supported) notices.push('This browser has no speech recognition. Use Chrome, or type.')
  if (mic.error !== '') notices.push(mic.error)

  return (
    <div className="mx-auto flex min-h-screen max-w-[76rem] flex-col gap-6 px-5 pt-6 pb-48">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <Wordmark voice={view === 'editor' ? voice : 'off'} level={mic.level} />

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-3" aria-label="Controls">
          <div className="flex" role="group" aria-label="Language">
            {LANGUAGES.map((language) => (
              <button
                key={language.tag}
                type="button"
                aria-pressed={mic.lang === language.tag}
                onClick={() => mic.setLang(language.tag)}
                className={`-ml-px cursor-pointer border border-ink px-3 py-1.5 first:ml-0 ${mic.lang === language.tag ? 'bg-ink font-semibold text-desk' : 'bg-transparent'}`}
              >
                {language.label}
              </button>
            ))}
          </div>

          {view === 'editor' && !mic.demo && (
            <button
              type="button"
              onClick={mic.toggle}
              disabled={!mic.supported}
              className="cursor-pointer border border-ink px-3 py-1.5 font-semibold disabled:cursor-default disabled:opacity-50"
            >
              {mic.on ? 'Turn the microphone off' : 'Turn the microphone on'}
            </button>
          )}

          <a href={view === 'editor' ? '#check' : '#'} className="text-link underline">
            {view === 'editor' ? 'Voice check' : 'Back to the document'}
          </a>
        </nav>
      </header>

      {notices.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-soft">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      {view === 'check' ? (
        <VoiceCheck key={mic.lang} lang={mic.lang} demo={mic.demo} />
      ) : (
        <>
          <main className="grid grid-cols-1 items-start gap-x-10 gap-y-8 min-[1000px]:grid-cols-[minmax(0,48rem)_minmax(14rem,1fr)]">
            <div className="flex flex-col gap-2">
              <p className="m-0 flex justify-between gap-4 text-soft">
                <span>minutes-5-october.docx</span>
                <span>Every change is tracked</span>
              </p>
              <DocumentView session={session} />
            </div>
            <div className="min-[1000px]:pt-9">
              <Margin session={session} reset={reset} />
            </div>
          </main>
          <CaptionStrip session={session} interim={mic.interim} dispatch={dispatch} />
        </>
      )}
    </div>
  )
}
