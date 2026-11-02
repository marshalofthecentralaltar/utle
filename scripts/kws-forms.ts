/**
 * Round 10 (#2, ARCHITECTURE 35.6): the labels of the real-voice set (scripts/kws-real.ts). Which
 * words of a corpus transcript are a form of the verb "ütlema / öelda", and which label the clip
 * gets. Pure: no files, no network.
 */

/** wake: the bare form "ütle"; literal: that form quoted or named as a word; relative: another form of the ütl- / ütel- stem; kin: only the öel- stem; none: no form. */
export type RealLabel = 'wake' | 'literal' | 'relative' | 'kin' | 'none'

export const REAL_LABELS: readonly RealLabel[] = ['wake', 'literal', 'relative', 'kin', 'none']

/** A verb form at a word's start, after one of the particles it compounds with ("väljaütlemine"). */
const FORM = /^(?:välja|ära|ette|üles|vastu|järele|kaasa|edasi|tagasi|läbi|sisse|maha|eel|järel)?(?:ütl|ütel|öel|öeld)/u
const SAME_STEM = /^(?:välja|ära|ette|üles|vastu|järele|kaasa|edasi|tagasi|läbi|sisse|maha|eel|järel)?(?:ütl|ütel)/u
const WAKE_FORM = 'ütle'
/** The bare form between quotes, or after "sõna" (the word as text). */
const QUOTED = /[„“”"'«»‚‘’]\s*ütle\s*[„“”"'«»‚‘’]|(?<!\p{L})sõna\s+ütle(?!\p{L})/iu

/** Every form of the verb in the text, lower case, in order. */
export function formsOf(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) => FORM.test(word))
}

/** The clip's label from its transcript (the raw one: quotes matter). */
export function labelOf(text: string): RealLabel {
  const forms = formsOf(text)
  if (forms.includes(WAKE_FORM)) return QUOTED.test(text) ? 'literal' : 'wake'
  if (forms.some((form) => SAME_STEM.test(form))) return 'relative'
  return forms.length > 0 ? 'kin' : 'none'
}

/** P(X <= k) for a Poisson count with mean lambda. */
function poissonCdf(k: number, lambda: number): number {
  let term = Math.exp(-lambda)
  let sum = term
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i
    sum += term
  }
  return sum
}

/** The one-sided upper confidence bound (default 95 %) of a Poisson mean after observing k events. */
export function poissonUpper(k: number, confidence = 0.95): number {
  let low = 0
  let high = k + 50
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2
    if (poissonCdf(k, mid) > 1 - confidence) low = mid
    else high = mid
  }
  return (low + high) / 2
}
