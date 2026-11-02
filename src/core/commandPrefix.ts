import { PHRASE_GROUPS } from './phrases.ts'
import { normalise } from './quickReply.ts'

/**
 * Round 10 (#7, ARCHITECTURE 33.3): a command that a longer command starts with ("keri alla" before
 * "kaks minutit", "saada" before "meil Jaanile", "mine tagasi" before "sinna kus ma olin") is never
 * run from a partial: the speaker may be pausing in the middle of the longer one. It waits for its
 * final, which the 0.6 s command endpoint brings about when the old 650 ms settle did.
 */

/** Every Estonian form of the help page's phrases (src/core/phrases.ts), normalised. A phrase added there is covered. */
export const COMMAND_FORMS: readonly string[] = [...new Set(PHRASE_GROUPS.flatMap((group) => group.phrases.flatMap((phrase) => phrase.et)).map(normalise))].filter((form) => form !== '')

/** keri [aeglaselt | tasa] and a direction: a timed scroll (33.4) or a seek by an amount (29.1) may follow. */
const KERI_DIRECTION = /^keri (?:aeglaselt |tasa )?(?:alla|allapoole|üles|ülespoole|edasi|tagasi)$/u

/** True when the words of text are the first words of a longer known command (whole words, normalised). */
export function extendsCommand(text: string, longer: readonly string[] = COMMAND_FORMS): boolean {
  const clean = normalise(text)
  if (clean === '') return false
  if (KERI_DIRECTION.test(clean)) return true
  const words = clean.split(' ')
  return longer.some((form) => {
    const other = normalise(form).split(' ')
    return other.length > words.length && words.every((word, i) => other[i] === word)
  })
}
