/**
 * Round 10 prompt 6 (QUICK, review 1): voice.ts section 1's reading of the box samples, pure so it is
 * tested. The sentence "lands" when the box first holds the text it ends with; every distinct
 * non-empty box value before that is a preview (ARCHITECTURE 32.3: the box gets the whole sentence
 * with its verdict, never his live words).
 */

export interface BoxSample {
  /** Epoch ms of the sample. */
  t: number
  /** The box's text at that moment. */
  box: string
}

export interface BoxLanding {
  /** The text that landed: what was sent, or when nothing was, the box's last non-empty value. */
  text: string
  /** Epoch ms of the first sample holding that text; NaN when the box never held it. */
  at: number
  /** Distinct non-empty box values before the landing, in order. */
  previews: string[]
}

export function boxLanding(samples: ReadonlyArray<BoxSample>, sent: string): BoxLanding {
  // When nothing was sent (a lost send word), the sentence may still have landed: it is the box's last
  // non-empty value. Until review 1, final stayed '' and at NaN, so every box value counted as a preview.
  const final = sent !== '' ? sent : ([...samples].reverse().find((x) => x.box.trim() !== '')?.box.trim() ?? '')
  const at = samples.find((x) => x.box.trim() === final && final !== '')?.t ?? NaN
  const previews: string[] = []
  for (const x of samples) {
    if (x.t >= at) break
    if (x.box.trim() !== '' && previews[previews.length - 1] !== x.box) previews.push(x.box)
  }
  return { text: final, at, previews }
}
