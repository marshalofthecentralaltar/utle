import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { markCandidates } from '../core/candidates.ts'
import type { BlockType } from '../core/document.ts'
import { buildPreview } from '../core/preview.ts'
import type { PreviewRow } from '../core/preview.ts'
import type { Session } from '../core/session.ts'

/** How a row is marked in the margin. A bar appears only where it carries a state. */
type Tone = 'plain' | 'changed' | 'removed' | 'added' | 'ask' | 'focus'

const BAR: Record<Tone, string> = {
  plain: 'border-transparent',
  changed: 'border-pencil-blue',
  added: 'border-pencil-blue',
  removed: 'border-pencil-red',
  ask: 'border-mark',
  focus: 'border-paper-ink',
}

const TYPE: Record<BlockType, string> = {
  h1: 'text-[1.75rem] leading-tight font-extrabold tracking-tight',
  h2: 'mt-3 text-xl font-semibold',
  p: '',
  li: 'pl-5 -indent-5',
}

function Row(props: { number: number | null; type: BlockType; tone: Tone; children: ReactNode }) {
  const marked = props.tone !== 'plain' && props.tone !== 'removed'
  return (
    <div data-marked={marked ? 'true' : undefined} className="grid scroll-mt-8 scroll-mb-48 grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-3">
      <span
        className={`text-right text-[0.8rem] tabular-nums ${props.tone === 'focus' ? 'font-extrabold text-paper-ink' : 'text-paper-soft'} ${props.tone === 'removed' ? 'line-through' : ''}`}
      >
        {props.number ?? ''}
      </span>
      <div className={`border-l-[3px] pl-3 ${BAR[props.tone]} ${TYPE[props.type]}`}>
        {props.type === 'li' && <span className="mr-2 text-paper-soft">•</span>}
        {props.children}
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

/** The sheet: the document with a numbered margin, showing a proposal, the candidates or the focus. */
export function DocumentView({ session }: { session: Session }) {
  const sheet = useRef<HTMLDivElement>(null)
  const { doc, mode, pending, choice, focusId } = session

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
                    <b key={n} className="mr-1.5 inline-block min-w-[1.4em] bg-paper-ink px-1 text-center text-[0.82em] font-extrabold text-paper">
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
      aria-label="Document"
      className="flex flex-col gap-2.5 border border-paper-edge bg-paper text-paper-ink py-9 pr-6 pl-3 text-lg leading-[1.6] sm:py-12 sm:pr-12 sm:pl-5"
    >
      {rows}
    </div>
  )
}
