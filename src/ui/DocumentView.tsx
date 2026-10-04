import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { markCandidates } from '../core/candidates.ts'
import type { Block, BlockType } from '../core/document.ts'
import { buildPreview } from '../core/preview.ts'
import type { PreviewRow } from '../core/preview.ts'
import type { Session } from '../core/session.ts'

type Tone = 'plain' | 'changed' | 'removed' | 'added' | 'ask' | 'focus'

const TONE: Record<Tone, string> = {
  plain: 'border-transparent',
  changed: 'border-accent bg-accent-soft',
  removed: 'border-transparent opacity-45 line-through',
  added: 'border-accent bg-accent-soft outline-dashed outline-1 -outline-offset-1 outline-accent',
  ask: 'border-warn bg-warn-soft',
  focus: 'border-accent bg-accent-soft',
}

const TYPE: Record<BlockType, string> = {
  h1: 'font-display text-2xl font-bold leading-tight',
  h2: 'font-display text-lg font-medium pt-2',
  p: '',
  li: '',
}

function Row(props: { number: number | null; type: BlockType; tone: Tone; marked: boolean; children: ReactNode }) {
  return (
    <div
      data-marked={props.marked ? 'true' : undefined}
      className={`grid grid-cols-[2.1rem_minmax(0,1fr)] items-baseline gap-1.5 border-l-[3px] py-0.5 pr-1.5 ${TONE[props.tone]}`}
    >
      <span className="text-right font-mono text-xs tabular-nums text-muted">{props.number ?? ''}</span>
      <div className={TYPE[props.type]}>
        {props.type === 'li' && <span className="mr-2 text-muted">•</span>}
        {props.children}
      </div>
    </div>
  )
}

function Badge({ n }: { n: number }) {
  return (
    <b className="mr-1 inline-block min-w-5 bg-warn px-1 text-center font-mono text-xs font-semibold text-surface">
      {n}
    </b>
  )
}

function previewRow(row: PreviewRow, key: string): ReactNode {
  switch (row.status) {
    case 'same':
      return (
        <Row key={key} number={row.number} type={row.block.type} tone="plain" marked={false}>
          {row.block.text}
        </Row>
      )
    case 'changed':
      return (
        <Row key={key} number={row.number} type={row.block.type} tone="changed" marked>
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
        <Row key={key} number={row.number} type={row.block.type} tone="removed" marked={false}>
          {row.block.text}
        </Row>
      )
    case 'added':
      return (
        <Row key={key} number={null} type={row.block.type} tone="added" marked>
          <ins>{row.block.text}</ins>
        </Row>
      )
  }
}

/** The document with paragraph numbers. Shows the proposal, the "which one" badges or the focus. */
export function DocumentView({ session }: { session: Session }) {
  const container = useRef<HTMLDivElement>(null)
  const { doc, mode, pending, choice, focusId } = session

  // Keep whatever the user has to look at in view: the proposal, the candidates, or the focused block.
  useEffect(() => {
    const target = container.current?.querySelector('[data-marked="true"]')
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [mode, pending, choice, focusId])

  let rows: ReactNode
  if (mode === 'confirming' && pending) {
    rows = buildPreview(doc, pending.ops).map((row, i) => previewRow(row, `${row.status}-${row.block.id}-${i}`))
  } else {
    rows = doc.map((block: Block, index) => {
      const parts = mode === 'choosing' && choice ? markCandidates(block, choice.candidates) : null
      const asked = parts?.some((part) => part.badges.length > 0) ?? false
      const focused = block.id === focusId
      return (
        <Row
          key={block.id}
          number={index + 1}
          type={block.type}
          tone={asked ? 'ask' : focused ? 'focus' : 'plain'}
          marked={asked || focused}
        >
          {parts
            ? parts.map((part, i) => (
                <span key={i}>
                  {part.badges.map((n) => (
                    <Badge key={n} n={n} />
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
    <div ref={container} aria-label="Document" className="flex min-h-[26rem] flex-col gap-1.5 py-4 pr-4 pl-1.5">
      {rows}
    </div>
  )
}
