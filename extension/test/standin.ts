// A stand-in for src/core/inpage.ts with the same signatures, for the extension's end-to-end
// test before the core lane's implementation is merged. Dictation appends to the box; three
// fixed phrases are commands.
import type { BoxState, BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import type { InpageSession, InpageStep } from '../../src/core/inpage.ts'
import type { Lang } from '../../src/core/strings.ts'

const words = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const COMMANDS: Record<string, { command: BrowserCommand; line: string }> = {
  saada: { command: { kind: 'pressSend' }, line: 'Saadan.' },
  'keri alla': { command: { kind: 'scroll', direction: 'down' }, line: 'Kerin alla.' },
  'järgmine vaheleht': { command: { kind: 'switchTab', to: 'next' }, line: 'Järgmine vaheleht.' },
}

export function initialInpage(lang: Lang): InpageSession {
  return { lang, asleep: false, hints: false, undo: [] }
}

export function inpageStep(session: InpageSession, utterance: string, box: BoxState): InpageStep {
  const known = COMMANDS[words(utterance)]
  if (known) return { session, commands: [known.command], line: known.line }
  const text = box.text.trim() === '' ? utterance.trim() : `${box.text} ${utterance.trim()}`
  return { session: { ...session, undo: [...session.undo, box.text] }, commands: [{ kind: 'setText', text }], line: 'Kirjutan.' }
}

export function inpageResult(session: InpageSession, commands: readonly BrowserCommand[], result: BrowserResult): { session: InpageSession; line: string } {
  if (!result.ok) return { session, line: `Ei õnnestunud: ${result.message}` }
  const kind = commands[commands.length - 1]?.kind
  return { session, line: kind === 'setText' ? 'Kirjutasin sõnumikasti.' : kind === 'pressSend' ? 'Saadetud.' : 'Tehtud.' }
}

export function inpageInstant(session: InpageSession, utterance: string): boolean {
  void session
  return words(utterance) in COMMANDS
}
