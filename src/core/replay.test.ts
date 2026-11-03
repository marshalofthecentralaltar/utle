import { describe, expect, it } from 'vitest'
import { DEMO_2026_11_03, replayBox } from './fixtures/demo-2026-11-03.ts'
import { initialInpage, inpageStep } from './inpage.ts'
import type { InpageStep } from './inpage.ts'

/**
 * Round 11 (lane WORDS, F4; docs/plans/2026-11-03-round-11-demo-brief.md): the owner's verified
 * utterances of his 2026-11-03 demo, in session order, through the rules the engine runs
 * (inpageStep with the box in front). "ask" is a sentence the rules leave to the model: in always-on
 * mode it pays the addressee check and then the intent ask, 4 to 6 s before anything moves.
 *
 * BEFORE (origin/main 242547a, artifacts/words/replay-before.log): 42 of 45 went to the model, 3 to a
 * rule ("Uus vaheleht", and "Mille Töötukassasse" twice by the one-letter rule).
 * AFTER (round 11, lane WORDS): 37 of 45. Now rules: "Youtube", "Töötukassa" (a site's name alone,
 * nothing armed), "Mina/Mine tagasi eelmisele lehele" (history back), "Mine uuele vahelehele"
 * (newTab). Still asked, rightly: talk to himself or to people in the room (English and Estonian),
 * his corrections of the address in the armed "To" field, clicks on the page ("Mobiil-ID-ga
 * sisselogimine"), "sinna kus ma olin enne töötukassat" (34.2: the model knows the tab he came from),
 * "kirjuta enda sõbrale e-maili" (a careful plan), and words the recogniser broke ("Avamuslehti oma seaded").
 */

/** The verdict for one row: the first command's kind (a rule ran), "ask", or "none" (a rule that runs nothing). */
function verdict(step: InpageStep): string {
  if (step.ask === true) return 'ask'
  const first = step.commands[0]
  if (first === undefined) return 'none'
  return first.kind === 'goTo' ? `goTo ${first.url}` : first.kind === 'history' ? `history ${first.direction}` : first.kind
}

const ROWS = DEMO_2026_11_03.map((row, i) => ({ n: i + 1, row, got: verdict(inpageStep(initialInpage('et'), row.said, replayBox(row))) }))
const MODEL_BOUND = ROWS.filter((r) => r.got === 'ask').length

describe('round 11 (F4): the demo of 2026-11-03 replayed through the rules', () => {
  it('prints every utterance with its verdict and the totals', () => {
    const lines = ROWS.map((r) => `${String(r.n).padStart(2)} ${r.got.padEnd(36)} ${r.row.said}`)
    console.log(`${lines.join('\n')}\n${MODEL_BOUND} of ${ROWS.length} went to the model, ${ROWS.length - MODEL_BOUND} to a rule`)
    expect(ROWS).toHaveLength(45)
  })

  it('his core commands are rules, and no more than 37 of the 45 go to the model', () => {
    const at = (n: number): string => ROWS[n - 1]?.got ?? ''
    expect([at(5), at(6), at(7), at(9), at(10), at(19)]).toEqual(['newTab', 'goTo https://www.youtube.com/', 'goTo https://www.tootukassa.ee/', 'history back', 'history back', 'newTab'])
    expect(MODEL_BOUND).toBeLessThanOrEqual(37)
  })
})
