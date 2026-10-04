/** Lowercase words with punctuation removed. Letters of any alphabet are kept. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
}

export interface WordErrorRate {
  /** Words in the expected line. */
  words: number
  /** Substitutions, deletions and insertions needed to turn what was heard into the line. */
  errors: number
  /** errors divided by words. Above 1 when far more was heard than expected. */
  rate: number
}

/** Word error rate, the standard measure of speech recognition accuracy. */
export function wordErrorRate(expected: string, heard: string): WordErrorRate {
  const a = words(expected)
  const b = words(heard)

  // Edit distance over words, one row at a time.
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      row[j] = Math.min(substitution, (previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1)
    }
    previous = row
  }
  const errors = previous[b.length] ?? 0
  const rate = a.length === 0 ? (errors === 0 ? 0 : 1) : errors / a.length
  return { words: a.length, errors, rate }
}
