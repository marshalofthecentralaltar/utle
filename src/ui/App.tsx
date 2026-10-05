import { useEffect, useState } from 'react'
import { LANGUAGES } from '../speech/recognizer.ts'
import { CaptionStrip } from './CaptionStrip.tsx'
import { DocumentView } from './DocumentView.tsx'
import { Margin } from './Margin.tsx'
import { VoiceCheck } from './VoiceCheck.tsx'
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

  const quiet = 'flex h-11 cursor-pointer items-center border-0 bg-transparent px-3 hover:text-ink'

  return (
    <div className="flex min-h-screen flex-col pb-48">
      <header className="grid min-h-11 grid-cols-[1fr_auto] items-center border-b border-edge px-2 text-[0.8125rem] text-soft min-[700px]:grid-cols-[1fr_auto_1fr]">
        <div className="flex" role="group" aria-label="Language">
          {LANGUAGES.map((language) => (
            <button
              key={language.tag}
              type="button"
              aria-pressed={mic.lang === language.tag}
              onClick={() => mic.setLang(language.tag)}
              className={`${quiet} ${mic.lang === language.tag ? 'font-semibold text-ink' : ''}`}
            >
              {language.label}
            </button>
          ))}
        </div>

        <span className="max-[699px]:hidden">minutes-5-october.docx</span>

        <nav className="flex justify-self-end" aria-label="Controls">
          {view === 'editor' && !mic.demo && (
            <button type="button" onClick={mic.toggle} disabled={!mic.supported} className={`${quiet} disabled:cursor-default disabled:opacity-50`}>
              {mic.on ? 'Turn the microphone off' : 'Turn the microphone on'}
            </button>
          )}
          <a href={view === 'editor' ? '#check' : '#'} className={`${quiet} no-underline`}>
            {view === 'editor' ? 'Voice check' : 'Back to the document'}
          </a>
        </nav>
      </header>

      {notices.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 pt-4 pr-5 pl-[var(--gutter)] text-sm text-soft">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      {view === 'check' ? (
        <div className="mx-auto w-full max-w-[80rem] pt-10 pr-5 pl-[calc(var(--gutter)-3.25rem)]">
          <VoiceCheck key={mic.lang} lang={mic.lang} demo={mic.demo} />
        </div>
      ) : (
        <>
          <main className="mx-auto flex w-full max-w-[80rem] flex-col gap-10 pt-12 min-[1000px]:flex-row min-[1000px]:gap-8">
            <DocumentView session={session} />
            <Margin session={session} reset={reset} />
          </main>
          <CaptionStrip session={session} interim={mic.interim} voice={voice} level={mic.level} dispatch={dispatch} />
        </>
      )}
    </div>
  )
}
