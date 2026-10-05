// A stand-in for src/core/inpage.ts with the same signatures, for the extension's end-to-end
// test before the core lane's implementation is merged. Dictation appends to the box; a few fixed
// phrases are commands; while numbers show, a number clicks it.
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
  'näita numbreid': { command: { kind: 'showHints' }, line: 'Näitan numbreid.' },
}

const NUMBERS: Record<string, number> = { üks: 1, kaks: 2, kolm: 3, neli: 4, viis: 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 }

/** A number while the labels show: "üks", "1", "number üks". */
function hint(session: InpageSession, utterance: string): number | null {
  if (!session.hints) return null
  return NUMBERS[words(utterance).replace(/^number /, '')] ?? null
}

export function initialInpage(lang: Lang): InpageSession {
  return { lang, asleep: false, hints: false, undo: [] }
}

export function inpageStep(session: InpageSession, utterance: string, box: BoxState): InpageStep {
  const number = hint(session, utterance)
  if (number !== null) return { session: { ...session, hints: false }, commands: [{ kind: 'clickHint', number }], line: `Vajutan ${number}.` }
  const known = COMMANDS[words(utterance)]
  if (known) return { session: { ...session, hints: known.command.kind === 'showHints' }, commands: [known.command], line: known.line }
  const text = box.text.trim() === '' ? utterance.trim() : `${box.text} ${utterance.trim()}`
  return { session: { ...session, undo: [...session.undo, box.text] }, commands: [{ kind: 'setText', text }], line: 'Kirjutan.' }
}

export function inpageResult(session: InpageSession, commands: readonly BrowserCommand[], result: BrowserResult): { session: InpageSession; line: string } {
  if (!result.ok) return { session, line: `Ei õnnestunud: ${result.message}` }
  const kind = commands[commands.length - 1]?.kind
  return { session, line: kind === 'setText' ? 'Kirjutasin sõnumikasti.' : kind === 'pressSend' ? 'Saadetud.' : 'Tehtud.' }
}

export function inpageInstant(session: InpageSession, utterance: string): boolean {
  return words(utterance) in COMMANDS || hint(session, utterance) !== null
}

/**
 * Null when the partial is a word-prefix of a command ("saa" and "keri" may still become one), while
 * asleep, or with no box; otherwise the earlier box text, a space if it is not empty, and the partial.
 */
export function inpagePreview(session: InpageSession, partial: string, box: BoxState): string | null {
  if (session.asleep || !box.present) return null
  const heard = words(partial)
  if (heard === '' || hint(session, partial) !== null) return null
  if (Object.keys(COMMANDS).some((phrase) => phrase.startsWith(heard))) return null
  return box.text === '' ? partial.trim() : `${box.text} ${partial.trim()}`
}
