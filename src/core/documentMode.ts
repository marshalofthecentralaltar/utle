/**
 * Round 8, document mode (docs/ARCHITECTURE.md 29.2): the pure rules that differ when the armed
 * box is a document. Pure: the engine passes the times, inpage.ts the texts.
 */

/** A final this long after the previous one starts a new sentence; within it the sentence goes on. */
export const DOCUMENT_PAUSE_MS = 20_000

/** True when the pause since the previous final (null: there was none) was longer than the window. */
export function documentPaused(previousFinalAt: number | null, now: number): boolean {
  return previousFinalAt !== null && now - previousFinalAt > DOCUMENT_PAUSE_MS
}

/** The box text with its open sentence closed: a full stop after a last letter or digit (a mark, a line break or nothing stays). */
export function closeSentence(text: string): string {
  const body = text.replace(/[ \t]+$/u, '')
  return /[\p{L}\p{N}»”"')]$/u.test(body) ? `${body}.` : text
}

/** The last sentence of a text: after the last . ! ? … or line break before its final mark, trimmed. */
export function lastSentenceOf(text: string): string {
  const trimmed = text.replace(/\s+$/u, '')
  const body = trimmed.replace(/[.!?…]+$/u, '')
  const end = Math.max(...['.', '!', '?', '…', '\n'].map((mark) => body.lastIndexOf(mark)))
  return trimmed.slice(end + 1).trim()
}
