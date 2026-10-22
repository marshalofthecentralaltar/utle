import { describe, expect, it } from 'vitest'
import { DEFAULT_WAKE_WORD, WAKE_WINDOW_MS, createWake, wakeClose, wakeGate, wakeHeard, wakeOpen, wakeOpenWindow, wakeStarts, wakeWordFrom } from './wake.ts'

/** Twenty finals without the word: room talk, dictation, commands said to someone else. */
const WITHOUT_WORD = [
  'keri alla',
  'saada',
  'tere Mari',
  'ma tahtsin ütelda et tulen homme',
  'ütlesin talle juba',
  'ütles et tuleb',
  'ütleb ta',
  'mine whatsappi',
  'kas sa kuuled mind',
  'vaata uudiseid',
  'kell on viis',
  'jah',
  'ei',
  'aitäh',
  'pane raadio käima',
  'mis ilm on',
  'ava youtube',
  'see on hea',
  'ma ütlen sulle',
  'okei',
] as const

/** Ten finals with the word, and what the engine gets. */
const WITH_WORD: ReadonlyArray<readonly [string, string]> = [
  ['Ütle, keri alla', 'keri alla'],
  ['ütle keri alla', 'keri alla'],
  ['ütel keri alla', 'keri alla'],
  ['Üтле, saada', 'saada'],
  ['ütle mine whatsappi', 'mine whatsappi'],
  ['Ütle: vaata uudiseid.', 'vaata uudiseid.'],
  ['ütle, pane raadio käima', 'pane raadio käima'],
  ['ÜTLE ava youtube', 'ava youtube'],
  ['ütle... mis ilm on', 'mis ilm on'],
  ['ütle näita numbreid', 'näita numbreid'],
]

describe('the wake word gate (29.4)', () => {
  it('wake: drops 20 finals without the word and acts on 10 with it, the word stripped', () => {
    let state = createWake(DEFAULT_WAKE_WORD)
    let now = 1_000_000
    const passed: string[] = []
    for (const final of WITHOUT_WORD) {
      now += 1000
      const r = wakeGate(state, final, now)
      state = r.state
      if (r.utterance !== null) passed.push(final)
    }
    expect(passed).toEqual([])
    const got: string[] = []
    for (const [final] of WITH_WORD) {
      now += 1000
      const r = wakeGate(state, final, now)
      state = r.state
      got.push(r.utterance ?? '(dropped)')
    }
    expect(got).toEqual(WITH_WORD.map(([, want]) => want))
    // A woken command does not open the window by itself (only an armed box or the bare word does).
    expect(wakeOpen(state, now)).toBe(false)
  })

  it('phonetic: "ma tahtsin ütelda" and "ütlesin talle" are not a wake; "Ütle, keri alla", "ütle keri alla", "ütel keri alla" are', () => {
    const state = createWake('Ütle')
    expect(wakeGate(state, 'ma tahtsin ütelda', 0).utterance).toBeNull()
    expect(wakeGate(state, 'ütlesin talle', 0).utterance).toBeNull()
    expect(wakeGate(state, 'Ütle, keri alla', 0).utterance).toBe('keri alla')
    expect(wakeGate(state, 'ütle keri alla', 0).utterance).toBe('keri alla')
    expect(wakeGate(state, 'ütel keri alla', 0).utterance).toBe('keri alla')
  })

  it('phonetic: a letter added is another word (ütles, ütleb, ütlen), Cyrillic look-alikes are read as Latin', () => {
    expect(wakeStarts(createWake('Ütle'), 'ütles et')).toBeNull()
    expect(wakeStarts(createWake('Ütle'), 'ütleb')).toBeNull()
    expect(wakeStarts(createWake('Ütle'), 'ütlen')).toBeNull()
    expect(wakeStarts(createWake('Ütle'), 'Üтле тере')).toBe('тере')
    expect(wakeStarts(createWake('Ütle'), 'ütle')).toBe('')
  })

  it('phonetic: a two-word wake word needs both words first', () => {
    const state = createWake('Hei arvuti')
    expect(wakeGate(state, 'hei arvuti keri alla', 0).utterance).toBe('keri alla')
    expect(wakeGate(state, 'hei, arvuti, keri alla', 0).utterance).toBe('keri alla')
    expect(wakeGate(state, 'hei keri alla', 0).utterance).toBeNull()
    expect(wakeGate(state, 'arvuti keri alla', 0).utterance).toBeNull()
  })

  it('reads the setting: one or two words of letters, else the default', () => {
    expect(wakeWordFrom(undefined)).toBe('Ütle')
    expect(wakeWordFrom('')).toBe('Ütle')
    expect(wakeWordFrom('  Kuule  ')).toBe('Kuule')
    expect(wakeWordFrom('hei   arvuti')).toBe('hei arvuti')
    expect(wakeWordFrom('üks kaks kolm')).toBe('Ütle')
    expect(wakeWordFrom('r2d2')).toBe('Ütle')
    expect(wakeWordFrom(42)).toBe('Ütle')
    expect(wakeWordFrom('Õunapuu')).toBe('Õunapuu')
  })
})

describe('the dictation window (29.4)', () => {
  it('window: open, every final passes without the word and moves the end; 20 s of silence closes it', () => {
    let state = wakeOpenWindow(createWake('Ütle'), 0)
    expect(wakeOpen(state, 0)).toBe(true)
    let r = wakeGate(state, 'tere Mari', 5000)
    expect(r.utterance).toBe('tere Mari')
    state = r.state
    expect(state.openUntil).toBe(5000 + WAKE_WINDOW_MS)
    // A partial is speech too.
    state = wakeHeard(state, 20_000)
    expect(state.openUntil).toBe(20_000 + WAKE_WINDOW_MS)
    // The word is still stripped when he says it while the window is open.
    r = wakeGate(state, 'ütle, tulen homme', 21_000)
    expect(r.utterance).toBe('tulen homme')
    state = r.state
    expect(wakeOpen(state, 21_000 + WAKE_WINDOW_MS - 1)).toBe(true)
    expect(wakeOpen(state, 21_000 + WAKE_WINDOW_MS)).toBe(false)
    r = wakeGate(state, 'tere', 21_000 + WAKE_WINDOW_MS + 1)
    expect(r.utterance).toBeNull()
    // A partial after the window closed does not open it again.
    expect(wakeOpen(wakeHeard(r.state, 50_000), 50_000)).toBe(false)
  })

  it('window: "aitab", "see on kõik", "that\'s all" close it and type nothing, with or without the word', () => {
    for (const stop of ['aitab', 'Aitab.', 'see on kõik', "that's all", 'ütle, aitab']) {
      const r = wakeGate(wakeOpenWindow(createWake('Ütle'), 0), stop, 1000)
      expect(r.utterance).toBeNull()
      expect(wakeOpen(r.state, 1000)).toBe(false)
    }
    // Closed, a woken "aitab" types nothing either.
    expect(wakeGate(createWake('Ütle'), 'ütle aitab', 0).utterance).toBeNull()
  })

  it('window: the bare word opens it; wakeClose shuts it', () => {
    const r = wakeGate(createWake('Ütle'), 'Ütle.', 100)
    expect(r.utterance).toBeNull()
    expect(wakeOpen(r.state, 100)).toBe(true)
    expect(wakeOpen(wakeClose(r.state), 100)).toBe(false)
  })
})
