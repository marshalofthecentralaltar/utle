/**
 * Sound-alike words for Estonian-ish speech (docs/ARCHITECTURE.md 23.2). The recogniser writes
 * what it hears: "juutuba" for YouTube, "aga" for "ava", "keri ala" for "keri alla". Two words
 * sound alike when their phonetic keys are equal, their stems are equal, or the keys are one edit
 * apart. Pure: strings in, strings out.
 */

/** Letter pairs and clusters read the Estonian way, longest first. */
const CLUSTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sch/g, 's'],
  [/sh/g, 's'],
  [/wh/g, 'v'],
  [/ck/g, 'k'],
  [/x/g, 'ks'],
]

/** Foreign letters as an Estonian ear hears them, then voiced stops as their unvoiced pair (b/p, d/t, g/k sound the same). */
const LETTERS: Record<string, string> = {
  w: 'v', y: 'i', c: 'k', q: 'k', z: 's', š: 's', ž: 's',
  b: 'p', d: 't', g: 'k',
}

/** Case endings and suffixes taken off before the key, longest first ("youtubei", "googlesse", "delfist", "avage"). */
const ENDINGS = ['sse', 'ke', 'ge', 'gu', 'ga', 'le', 'st', 'i']

/** At least this many letters must remain when an ending comes off. */
const STEM_MIN = 3

/**
 * The phonetic key of one word: lowercase, apostrophes gone, w→v, y→i, c→k (ck→k), q→k, x→ks,
 * z→s, sh/š/ž→s, b→p, d→t, g→k, and every run of one letter collapsed to one (so long and short
 * vowels, and single and double consonants, are the same: "keeri" is "keri", "saada" is "sada").
 */
export function phoneticKey(word: string): string {
  let s = word.toLowerCase().replace(/['’`´]/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
  for (const [pattern, to] of CLUSTERS) s = s.replace(pattern, to)
  s = [...s].map((ch) => LETTERS[ch] ?? ch).join('')
  return s.replace(/(.)\1+/gu, '$1')
}

/** The key of the word with one case ending or suffix taken off (-sse, -ke, -ge, -gu, -ga, -le, -st, -i), when enough is left. */
export function phoneticStem(word: string): string {
  const bare = word.toLowerCase().replace(/['’`´]/gu, '')
  for (const ending of ENDINGS) {
    if (bare.endsWith(ending) && bare.length - ending.length >= STEM_MIN) return phoneticKey(bare.slice(0, -ending.length))
  }
  return phoneticKey(bare)
}

/** Optimal string alignment distance (a letter changed, added, dropped, or two neighbours swapped), capped. */
export function keyDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min((rows[i - 1]?.[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (rows[i - 1]?.[j - 1] ?? 0) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, (rows[i - 2]?.[j - 2] ?? 0) + 1)
      row.push(d)
    }
    rows.push(row)
  }
  return rows[a.length]?.[b.length] ?? cap + 1
}

/**
 * True when heard sounds like target: the keys are equal, the stem of either is the key or the stem
 * of the other ("delfist" is "delfi"), or the keys are one edit apart and at least four letters long. A three-letter key may differ in its middle letter
 * only ("aga" for "ava": the consonant between two vowels is what the recogniser loses).
 */
export function soundsLike(heard: string, target: string): boolean {
  const a = phoneticKey(heard)
  const b = phoneticKey(target)
  if (a === '' || b === '') return false
  if (a === b) return true
  const stemA = phoneticStem(heard)
  const stemB = phoneticStem(target)
  if (stemA.length >= STEM_MIN && (stemA === stemB || stemA === b || a === stemB)) return true
  if (a.length >= 4 && b.length >= 4) return keyDistance(a, b, 1) <= 1
  // Three-letter words only, not longer words whose keys collapse to three letters: "teeb" is not "tab".
  return a.length === 3 && b.length === 3 && heard.length <= 3 && target.length <= 3 && a[0] === b[0] && a[2] === b[2]
}
