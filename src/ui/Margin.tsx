import type { Session } from '../core/session.ts'

const SAY: ReadonlyArray<[string, string]> = [
  ['What to change', 'Change the budget deadline to Friday'],
  ['Yes, no, or only the corrected word', 'Not Wednesday. Tuesday.'],
  ['A paragraph number', 'Six'],
  ['Where to go', 'Go to budget. Next. Top.'],
  ['What to read aloud', 'Read paragraph four. Stop.'],
  ['To take the last edit back', 'Undo'],
  ['To be left alone', 'Stop listening. Wake up.'],
]

/** Beside the text: the accepted changes as margin notes, and help when asked. Empty until there is something to say. */
export function Margin({ session, reset }: { session: Session; reset(): void }) {
  const changed = session.log.length > 0
  if (!changed && !session.help) return null

  return (
    <aside className="flex flex-col gap-7 pr-5 pl-[var(--gutter)] text-sm text-soft min-[1000px]:w-64 min-[1000px]:shrink-0 min-[1000px]:p-0 min-[1000px]:pt-1.5">
      {session.help && (
        <section>
          <h2 className="m-0 mb-2 text-sm font-semibold text-ink">You can say</h2>
          <dl className="m-0">
            {SAY.map(([what, example]) => (
              <div key={what} className="border-t border-edge py-2">
                <dt>{what}</dt>
                <dd className="m-0 text-ink">{example}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {changed && (
        <section>
          <h2 className="m-0 mb-2 text-sm font-semibold text-ink">Changes</h2>
          <ol className="m-0 list-none p-0">
            {session.log.map((line, i) => (
              <li key={i} className="border-t border-edge py-2 text-ink">
                {line}
              </li>
            ))}
          </ol>
          <p className="m-0 border-t border-edge pt-2">Say undo to take the last one back.</p>
        </section>
      )}

      {changed && (
        <button type="button" onClick={reset} className="cursor-pointer self-start border-0 bg-transparent p-0 text-soft underline underline-offset-[0.2em] hover:text-ink">
          Start again with the sample document
        </button>
      )}
    </aside>
  )
}
