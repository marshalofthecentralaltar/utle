import type { ScriptLine } from './scripted.ts'

/**
 * The demo, as it is spoken, in Estonian (docs/ARCHITECTURE.md section 20.3). The first line has
 * a pause in the middle, so the scripted run exercises the same pause-joining a real speaker
 * needs. It ends with a message to Mari written, repaired once and sent through the bridge.
 */
export const DEMO_SCRIPT: readonly ScriptLine[] = [
  { text: 'Muuda eelarve tähtaeg reedeks.', pauseAfterWord: 2 },
  { text: 'Jah.' },
  { text: 'Ava uus vaheleht.' },
  { text: 'Ava messenger.' },
  { text: 'Kirjuta Marile, et ma jõuan homme kell kolm.' },
  { text: 'Mitte kolm, vaid neli.' },
  { text: 'Jah.' },
  { text: 'Saada.' },
  { text: 'Jah.' },
  { text: 'Ära kuula.' },
]

/** The English demo of M3, kept for an English audience. */
export const DEMO_SCRIPT_EN: readonly ScriptLine[] = [
  { text: 'Change the budget deadline to Friday.', pauseAfterWord: 4 },
  { text: 'Yes.' },
  { text: 'Move risks above next steps.' },
  { text: 'Yes.' },
  { text: 'Shorten the sentence about the supplier.' },
  { text: 'Two.' },
  { text: 'Yes.' },
  { text: 'Add a next step: Martin sends the contract by Wednesday.' },
  { text: 'Not Wednesday. Tuesday.' },
  { text: 'Yes.' },
  { text: 'Read paragraph four.' },
  { text: 'Stop.' },
  { text: 'Go to budget.' },
  { text: 'Undo.' },
  { text: 'Stop listening.' },
]

/** Lines to read for the voice check, per recogniser language. */
export const CHECK_LINES: Record<string, readonly string[]> = {
  'en-US': [
    'Change the budget deadline to Friday.',
    'Yes.',
    'Move risks above next steps.',
    'Shorten the sentence about the supplier.',
    'Two.',
    'Add a next step: Marten sends the contract by Wednesday.',
    'Not Wednesday. Tuesday.',
    'Read paragraph four.',
    'Go to budget.',
    'Undo.',
    'Stop listening.',
  ],
  'et-EE': [
    'Muuda eelarve tähtaeg reedeks.',
    'Jah.',
    'Tõsta riskid järgmiste sammude ette.',
    'Lühenda lauset tarnija kohta.',
    'Kaks.',
    'Lisa järgmine samm: Marten saadab lepingu kolmapäevaks.',
    'Mitte kolmapäev. Teisipäev.',
    'Loe lõik neli.',
    'Mine eelarve juurde.',
    'Võta tagasi.',
    'Ära kuula.',
  ],
}

/** What a scripted recogniser "hears" for the voice check: mostly right, with two slips. */
export const CHECK_DEMO: readonly ScriptLine[] = [
  { text: 'Change the budget deadline to Friday.' },
  { text: 'Yes.' },
  { text: 'Move risk above next steps.' },
  { text: 'Shorten the sentence about the supplier.' },
  { text: 'To.' },
  { text: 'Add a next step: Martin sends the contract by Wednesday.' },
  { text: 'Not Wednesday. Tuesday.' },
  { text: 'Read paragraph four.' },
  { text: 'Go to budget.' },
  { text: 'Undo.' },
  { text: 'Stop listening.' },
]
