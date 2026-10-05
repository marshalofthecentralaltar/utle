import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { markCandidates } from '../core/candidates.ts'
import type { BlockType } from '../core/document.ts'
import { buildPreview } from '../core/preview.ts'
import type { PreviewRow } from '../core/preview.ts'
import type { Session } from '../core/session.ts'
import { STRINGS } from '../core/strings.ts'

/** How a row is marked in the margin. A bar appears only where it carries a state. */
type Tone = 'plain' | 'changed' | 'removed' | 'added' | 'ask' | 'focus'

const BAR: Record<Tone, string> = {
  plain: 'border-transparent',
  changed: 'border-pencil-blue',
  added: 'border-pencil-blue',
  removed: 'border-pencil-red',
  ask: 'border-mark',
  focus: 'border-ink',
}

const TYPE: Record<BlockType, string> = {
  h1: 'text-[1.875rem] leading-[1.2] font-extrabold tracking-[-0.015em]',
  h2: 'text-[1.1875rem] font-semibold',
  p: '',
  li: '',
}

function Row(props: { number: number | null; type: BlockType; tone: Tone; children: ReactNode }) {
  const marked = props.tone !== 'plain' && props.tone !== 'removed'
  const strong = props.tone === 'focus' || props.tone === 'changed' || props.tone === 'added'
  return (
    <div
      data-marked={marked ? 'true' : undefined}
      className={`grid scroll-mt-8 scroll-mb-48 grid-cols-[1.75rem_minmax(0,40rem)] items-baseline gap-x-6 pr-5 pl-[calc(var(--gutter)-3.25rem)] ${props.type === 'h2' ? 'mt-[1.125rem]' : ''}`}
    >
      <span
        className={`text-right text-[0.8125rem] tabular-nums ${strong ? 'font-extrabold text-ink' : 'text-soft'} ${props.tone === 'removed' ? 'line-through' : ''}`}
      >
        {props.number ?? ''}
      </span>
      {/* The change bar hangs in the gutter, so marked text does not move. */}
      <div className={`-ml-3.5 border-l-2 pl-3 ${BAR[props.tone]} ${TYPE[props.type]}`}>
        {props.type === 'li' ? (
          <span className="block pl-[1.375rem] -indent-[1.375rem]">
            <span className="inline-block w-[1.375rem] indent-0 text-soft">•</span>
            {props.children}
          </span>
        ) : (
          props.children
        )}
      </div>
    </div>
  )
}

function previewRow(row: PreviewRow, key: string): ReactNode {
  switch (row.status) {
    case 'same':
      return (
        <Row key={key} number={row.number} type={row.block.type} tone="plain">
          {row.block.text}
        </Row>
      )
    case 'changed':
      return (
        <Row key={key} number={row.number} type={row.block.type} tone="changed">
          {row.segments.map((segment, i) =>
            segment.kind === 'same' ? (
              <span key={i}>{segment.text}</span>
            ) : segment.kind === 'del' ? (
              <del key={i}>{segment.text}</del>
            ) : (
              <ins key={i}>{segment.text}</ins>
            ),
          )}
        </Row>
      )
    case 'removed':
      return (
        <Row key={key} number={row.number} type={row.block.type} tone="removed">
          <del>{row.block.text}</del>
        </Row>
      )
    case 'added':
      return (
        <Row key={key} number={null} type={row.block.type} tone="added">
          <ins>{row.block.text}</ins>
        </Row>
      )
  }
}

/** The document, straight on the ground, with a numbered gutter: showing a proposal, the candidates or the focus. */
export function DocumentView({ session }: { session: Session }) {
  const sheet = useRef<HTMLDivElement>(null)
  const { doc, mode, pending, choice, focusId, draft } = session
  const t = STRINGS[session.lang].ui

  // Keep whatever the user has to look at in view: the proposal, the candidates, or the focused block.
  useEffect(() => {
    const target = sheet.current?.querySelector('[data-marked="true"]')
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [mode, pending, choice, focusId])

  let rows: ReactNode
  if (mode === 'confirming' && pending) {
    rows = buildPreview(doc, pending.ops).map((row, i) => previewRow(row, `${row.status}-${row.block.id}-${i}`))
  } else {
    rows = doc.map((block, index) => {
      const parts = mode === 'choosing' && choice ? markCandidates(block, choice.candidates) : null
      const asked = parts?.some((part) => part.badges.length > 0) ?? false
      return (
        <Row key={block.id} number={index + 1} type={block.type} tone={asked ? 'ask' : block.id === focusId ? 'focus' : 'plain'}>
          {parts
            ? parts.map((part, i) => (
                <span key={i} className={part.highlight ? 'highlight' : undefined}>
                  {part.badges.map((n) => (
                    <b key={n} className="mr-[0.3em] inline-block min-w-[1.4em] bg-mark-ink px-[0.25em] text-center text-[0.8em] font-extrabold text-mark">
                      {n}
                    </b>
                  ))}
                  {part.text}
                </span>
              ))
            : block.text}
        </Row>
      )
    })
  }

  return (
    <div
      ref={sheet}
      aria-label={draft ? t.message : t.document}
      data-draft={draft ? 'true' : undefined}
      className="flex min-w-0 flex-col gap-3 text-lg leading-[1.65]"
    >
      {draft && (
        <p className="m-0 pr-5 pb-2 pl-[calc(var(--gutter)-3.25rem+1.75rem+1.5rem)] text-soft">
          {t.recipient}: <b className="font-semibold text-ink">{draft.to ?? t.noRecipient}</b>
        </p>
      )}
      {rows}
      {draft && doc.length === 0 && mode !== 'confirming' && (
        <p className="m-0 pr-5 pl-[calc(var(--gutter)-3.25rem+1.75rem+1.5rem)] text-soft">{t.emptyDraft}</p>
      )}
    </div>
  )
}
