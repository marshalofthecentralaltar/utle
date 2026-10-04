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

function Count({ value, label }: { value: number; label: string }) {
  return (
    <p className="m-0">
      <b className="text-xl font-semibold tabular-nums">{value}</b> {label}
    </p>
  )
}

/** Beside the sheet: the accepted changes as margin notes, the three measurements, and help when asked. */
export function Margin({ session, reset }: { session: Session; reset(): void }) {
  return (
    <aside className="flex flex-col gap-7">
      {session.help && (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-base font-extrabold">You can say</h2>
          <dl className="m-0 flex flex-col gap-2">
            {SAY.map(([what, example]) => (
              <div key={what}>
                <dt className="text-soft">{what}</dt>
                <dd className="m-0 font-semibold">{example}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-base font-extrabold">Changes</h2>
        {session.log.length === 0 ? (
          <p className="m-0 text-soft">None yet. Every accepted edit is listed here.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {session.log.map((line, i) => (
              <li key={i} className="border-l-[3px] border-link pl-2.5">
                {line}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-0.5">
        <Count value={session.history.length} label="edits finished" />
        <Count value={session.words} label="words spoken" />
        <Count value={session.hands} label="times a hand was used" />
      </section>

      <button type="button" onClick={reset} className="cursor-pointer self-start border-0 bg-transparent p-0 text-link underline">
        Start again with the sample document
      </button>
    </aside>
  )
}
