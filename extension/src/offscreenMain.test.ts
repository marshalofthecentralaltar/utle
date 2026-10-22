import type { IntentRequest } from '../../src/core/pageIntent.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STRINGS } from '../../src/core/strings.ts'
import { DEFAULT_ASR_URL, authHeaders, connectionFrom, serverCheck, serverStatus, socketAddress } from './connection.ts'
import { ENOUGH_PHRASES, asrAddress, askIntent, enrolledLine, foreignNotice, serverUrl } from './offscreenMain.ts'
// ---------- reading aloud (29.5) ----------
import { beforeEach } from 'vitest'
import type { BrowserResult } from '../../src/browser/protocol.ts'
import { createLocalRecognizer } from '../../src/speech/local.ts'
import type { AudioSource, SocketEvents, SocketLike } from '../../src/speech/local.ts'
import { BAR_LINE_MAX, BAR_REPEAT_MS, createReadAloud, mutedSource } from './offscreenMain.ts'
import type { ReadCommand } from './offscreenMain.ts'
import { RESUME_MS, VOICE_POLL_MS, VOICE_WAIT_MS, estonianVoice, sentenceTimeoutMs } from './reader.ts'
import type { SpeechEvents, SpeechPort, SpeechVoiceInfo } from './reader.ts'
import type { StripState } from './messages.ts'
import { DEFAULT_SETTINGS, SETTING_KEYS, settingsFrom } from './strip.ts'

describe('the server address (27.3)', () => {
  it('derives the http base from a ws address and https from wss', () => {
    expect(serverUrl('ws://localhost:5173/api/asr', '/api/status')).toBe('http://localhost:5173/api/status')
    expect(serverUrl('wss://utle.up.railway.app/api/asr', '/api/intent')).toBe('https://utle.up.railway.app/api/intent')
    expect(serverUrl('wss://utle.example:8443/api/asr', '/api/status')).toBe('https://utle.example:8443/api/status')
  })

  it('never carries the socket query (the token, the engine) into an http address', () => {
    const socket = socketAddress(asrAddress('wss://h.example/api/asr', 'soniox'), 's3cret')
    expect(socket).toBe('wss://h.example/api/asr?engine=soniox&token=s3cret')
    expect(serverUrl(socket, '/api/status')).toBe('https://h.example/api/status')
  })

  it('puts the token on the socket only when there is one, escaped', () => {
    expect(socketAddress('ws://localhost:5173/api/asr', '')).toBe('ws://localhost:5173/api/asr')
    expect(socketAddress('wss://h.example/api/asr', 'a+b/c')).toBe('wss://h.example/api/asr?token=a%2Bb%2Fc')
  })

  it('sends the token as a bearer header, and no header without one', () => {
    expect(authHeaders('t1')).toEqual({ Authorization: 'Bearer t1' })
    expect(authHeaders('')).toEqual({})
  })
})

describe('the server settings (27.3)', () => {
  it('reads the address and the token with defaults', () => {
    expect(connectionFrom({})).toEqual({ asrUrl: DEFAULT_ASR_URL, token: '' })
    expect(connectionFrom({ asrUrl: '', serverToken: '' })).toEqual({ asrUrl: DEFAULT_ASR_URL, token: '' })
    expect(connectionFrom({ asrUrl: ' wss://h.example/api/asr ', serverToken: ' t1 ' })).toEqual({ asrUrl: 'wss://h.example/api/asr', token: 't1' })
    expect(connectionFrom({ asrUrl: 42, serverToken: null })).toEqual({ asrUrl: DEFAULT_ASR_URL, token: '' })
  })

  it('falls back to the default for an address that is not a websocket address', () => {
    expect(connectionFrom({ asrUrl: 'not an address' }).asrUrl).toBe(DEFAULT_ASR_URL)
    expect(connectionFrom({ asrUrl: 'https://h.example/api/asr' }).asrUrl).toBe(DEFAULT_ASR_URL)
  })
})

describe('the status with a token (27.3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const answer = (status: number, body: unknown) => vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(body), { status })))

  it('sends the token and reads what the server has', async () => {
    const fetchMock = answer(200, { intent: 'live', speech: { local: true, soniox: false }, auth: 'on' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await serverCheck('https://h.example/api/status', 't1')).toEqual({ state: 'live', speech: { local: true, soniox: false } })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer t1')
  })

  it('reads which profile the token is (round 7, 27.6), and leaves it out when the server does not say', async () => {
    vi.stubGlobal('fetch', answer(200, { intent: 'live', speech: { local: true, soniox: false }, auth: 'on', profile: { name: 'ralf', enrolled: true, seconds: 8 } }))
    expect(await serverCheck('https://h.example/api/status', 't1')).toEqual({ state: 'live', speech: { local: true, soniox: false }, profile: { name: 'ralf', enrolled: true } })
    vi.stubGlobal('fetch', answer(200, { intent: 'live', profile: { name: 7 } }))
    expect((await serverCheck('https://h.example/api/status', 't1')).profile).toBeUndefined()
    expect(STRINGS.et.strip.serverProfile({ name: 'ralf', enrolled: true })).toBe('Profiil: ralf, hääl õpetatud.')
    expect(STRINGS.et.strip.serverProfile({ name: 'mari', enrolled: false })).toBe('Profiil: mari, hääl õpetamata.')
  })

  it('says bad_token for a 401, no_key and unreachable as before', async () => {
    vi.stubGlobal('fetch', answer(401, { error: { code: 'unauthorized' } }))
    expect(await serverStatus('https://h.example/api/status', 'wrong')).toBe('bad_token')
    vi.stubGlobal('fetch', answer(200, { intent: 'no_key' }))
    expect(await serverStatus('https://h.example/api/status', '')).toBe('no_key')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))))
    expect(await serverStatus('https://h.example/api/status', '')).toBe('unreachable')
    vi.stubGlobal('fetch', answer(500, {}))
    expect(await serverStatus('https://h.example/api/status', '')).toBe('unreachable')
  })

  it('sends the token on /api/intent and treats a 401 as no model', async () => {
    const request: IntentRequest = { lang: 'et', utterance: 'ava', page: { url: '', title: '', box: { present: false, text: '', armed: false }, items: [], media: null, hints: false }, tabs: [], recent: [] }
    const fetchMock = answer(401, { error: { code: 'unauthorized' } })
    vi.stubGlobal('fetch', fetchMock)
    const result = await askIntent('https://h.example/api/intent', request, undefined, 't1')
    expect(result).toEqual({ error: 'no_model' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer t1')
  })
})

describe('strict mode lines on the strip (round 7)', () => {
  const text = { foreign: 'Keegi teine rääkis, jätsin vahele.', foreignRetrain: 'Kui see olid sina, õpeta hääl uuesti seadetes.' }
  it('strict mode: says who spoke at every drop, and the third drop message once', () => {
    expect([1, 2, 3, 4, 5].map((streak) => foreignNotice(streak, text))).toEqual([
      { foreign: text.foreign },
      { foreign: text.foreign },
      { foreign: text.foreign, line: text.foreignRetrain },
      { foreign: text.foreign },
      { foreign: text.foreign },
    ])
  })

  it('says how many phrases taught the voice, and when they were too few', () => {
    const lines = { enrolDone: 'done', enrolFailed: 'failed', enrolPhrasesDone: (n: number) => `done ${n}`, enrolFew: (n: number, enough: number) => `few ${n}/${enough}` }
    expect(enrolledLine(false, 12, lines)).toBe('failed')
    expect(enrolledLine(true, undefined, lines)).toBe('done')
    expect(enrolledLine(true, 12, lines)).toBe('done 12')
    expect(enrolledLine(true, ENOUGH_PHRASES, lines)).toBe(`done ${ENOUGH_PHRASES}`)
    expect(enrolledLine(true, ENOUGH_PHRASES - 1, lines)).toBe(`few ${ENOUGH_PHRASES - 1}/${ENOUGH_PHRASES}`)
  })
})

// ---------- reading aloud (29.5) ----------

/** Stands in for speechSynthesis: records what is spoken and cancelled; the test ends or fails the sentence in hand. */
class FakeSpeech implements SpeechPort {
  list: SpeechVoiceInfo[] = [{ name: 'Microsoft Anu Online (Natural) - Estonian (Estonia)', lang: 'et-EE' }]
  spoken: string[] = []
  cancels = 0
  current: SpeechEvents | null = null
  voices(): readonly SpeechVoiceInfo[] {
    return this.list
  }
  speak(text: string, _voice: SpeechVoiceInfo, events: SpeechEvents): void {
    this.spoken.push(text)
    this.current = events
  }
  cancel(): void {
    this.cancels += 1
    this.current = null
  }
  end(): void {
    const c = this.current
    this.current = null
    c?.end()
  }
  fail(code = 'synthesis-failed'): void {
    const c = this.current
    this.current = null
    c?.error(code)
  }
}

const SENTENCES = ['Suur uudis.', 'Esimene lause.', 'Teine lause.']
const fetched = (sentences: string[] = SENTENCES): BrowserResult => ({ ok: true, reading: { text: sentences.join(' '), sentences } })
const PAGE: ReadCommand = { kind: 'read', what: 'page' }

function readAloudWith(speech: FakeSpeech | null) {
  const patches: Array<Partial<StripState>> = []
  const fetches: ReadCommand[] = []
  const ra = createReadAloud({
    lang: 'et',
    port: () => speech,
    fetch: (command) => {
      fetches.push(command)
      return Promise.resolve(fetched())
    },
    publish: (patch) => patches.push(patch),
  })
  const lines = (): string[] => patches.flatMap((p) => (p.line === undefined ? [] : [p.line]))
  return { ra, patches, fetches, lines }
}

describe('reading aloud (29.5): the reader in the offscreen document', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('read: reads the page sentence by sentence; the strip shows reading and "Loen ette…"; after the last it says it ended', async () => {
    const speech = new FakeSpeech()
    const { ra, patches, fetches, lines } = readAloudWith(speech)
    const result = await ra.run(PAGE)
    expect(fetches).toEqual([PAGE])
    expect(result.ok).toBe(true)
    expect(ra.reading).toBe(true)
    expect(patches).toContainEqual({ reading: true, line: 'Loen ette…' })
    speech.end()
    speech.end()
    expect(speech.spoken).toEqual(SENTENCES)
    speech.end()
    expect(ra.reading).toBe(false)
    expect(patches).toContainEqual({ reading: false })
    expect(lines().at(-1)).toBe('Lugemine on lõppenud.')
  })

  it('read: listening is paused from the first sentence and resumed 150 ms after the last ends (within 300 ms)', async () => {
    const speech = new FakeSpeech()
    const { ra, patches } = readAloudWith(speech)
    await ra.run(PAGE, fetched(['Üks.']))
    expect(ra.muted).toBe(true)
    expect(patches).toContainEqual({ micMuted: true })
    speech.end()
    expect(ra.muted).toBe(true)
    vi.advanceTimersByTime(RESUME_MS - 1)
    expect(ra.muted).toBe(true)
    vi.advanceTimersByTime(1)
    expect(ra.muted).toBe(false)
    expect(RESUME_MS).toBeLessThanOrEqual(300)
    expect(patches.at(-1)).toEqual({ micMuted: false })
  })

  it('read: stop cancels at once and listening is back within 300 ms (fake timers)', async () => {
    const speech = new FakeSpeech()
    const { ra, lines } = readAloudWith(speech)
    await ra.run(PAGE)
    const start = Date.now()
    const result = await ra.run({ kind: 'read', what: 'stop' })
    expect(result.ok).toBe(true)
    expect(speech.cancels).toBeGreaterThanOrEqual(1)
    expect(Date.now() - start).toBe(0)
    expect(ra.reading).toBe(false)
    vi.advanceTimersByTime(300)
    expect(ra.muted).toBe(false)
    expect(lines().at(-1)).toBe('Lugemine seis.')
    // Events of the cancelled sentence change nothing.
    speech.end()
    expect(speech.spoken).toEqual(['Suur uudis.'])
  })

  it('read: "loe edasi" after a stop goes on from the next sentence of the same text; with nothing after it the line says it ended', async () => {
    const speech = new FakeSpeech()
    const { ra, lines } = readAloudWith(speech)
    await ra.run(PAGE)
    await ra.run({ kind: 'read', what: 'stop' })
    expect((await ra.run({ kind: 'read', what: 'continue' })).ok).toBe(true)
    expect(speech.spoken).toEqual(['Suur uudis.', 'Esimene lause.'])
    expect(ra.muted).toBe(true)
    await ra.run({ kind: 'read', what: 'stop' })
    await ra.run({ kind: 'read', what: 'continue' })
    await ra.run({ kind: 'read', what: 'stop' })
    const last = await ra.run({ kind: 'read', what: 'continue' })
    expect(last).toEqual({ ok: false, code: 'not_found', message: 'Nothing more to read.' })
    expect(lines().at(-1)).toBe('Lugemine on lõppenud.')
  })

  it('read: the microphone pressed while reading stops the reading (stop() is true), and not otherwise', async () => {
    const speech = new FakeSpeech()
    const { ra } = readAloudWith(speech)
    expect(ra.stop()).toBe(false)
    await ra.run(PAGE)
    expect(ra.stop()).toBe(true)
    expect(ra.reading).toBe(false)
  })

  it('read: a page with nothing to read says so and speaks nothing', async () => {
    const speech = new FakeSpeech()
    const { ra, lines } = readAloudWith(speech)
    const result = await ra.run(PAGE, fetched([]))
    expect(result).toEqual({ ok: false, code: 'not_found', message: 'Nothing to read here.' })
    expect(lines()).toEqual(['Siin pole midagi ette lugeda.'])
    expect(speech.spoken).toEqual([])
  })
})

describe('reading aloud (29.5): the voice rule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('voice: the first voice whose lang is et, et-EE or et_EE, whatever the case', () => {
    expect(estonianVoice([{ name: 'George', lang: 'en-GB' }, { name: 'Kert', lang: 'et-EE' }, { name: 'Anu', lang: 'et-EE' }])?.name).toBe('Kert')
    expect(estonianVoice([{ name: 'x', lang: 'ET_ee' }])?.name).toBe('x')
    expect(estonianVoice([{ name: 'x', lang: 'et' }])?.name).toBe('x')
    expect(estonianVoice([{ name: 'Ethiopic', lang: 'eth' }, { name: 'Irina', lang: 'ru-RU' }])).toBeNull()
  })

  it('voice: no Estonian voice: nothing is spoken, the microphone is never muted, and the bar says so', async () => {
    const speech = new FakeSpeech()
    speech.list = [{ name: 'George', lang: 'en-GB' }, { name: 'Irina', lang: 'ru-RU' }]
    const { ra, lines, patches } = readAloudWith(speech)
    const result = await ra.run(PAGE)
    expect(result).toEqual({ ok: false, code: 'not_allowed', message: 'This browser has no Estonian voice.' })
    expect(speech.spoken).toEqual([])
    expect(ra.muted).toBe(false)
    expect(patches.some((p) => p.micMuted === true || p.reading === true)).toBe(false)
    expect(lines()).toEqual(["Selles brauseris pole eesti häält. Edge'is on."])
    expect(STRINGS.en.read.noVoice).toBe('This browser has no Estonian voice; Edge has one.')
  })

  it('voice: no speech synthesis at all is the same as no voice', async () => {
    const { ra, lines } = readAloudWith(null)
    expect((await ra.run(PAGE)).ok).toBe(false)
    expect(lines()).toEqual(["Selles brauseris pole eesti häält. Edge'is on."])
  })

  it(`voice: an empty voice list is looked at again until the voices arrive (at most ${VOICE_WAIT_MS} ms)`, async () => {
    const speech = new FakeSpeech()
    const voices = speech.list
    speech.list = []
    const { ra } = readAloudWith(speech)
    const running = ra.run(PAGE)
    await vi.advanceTimersByTimeAsync(300)
    speech.list = voices
    await vi.advanceTimersByTimeAsync(VOICE_POLL_MS)
    expect((await running).ok).toBe(true)
    expect(speech.spoken).toEqual(['Suur uudis.'])
    const empty = new FakeSpeech()
    empty.list = []
    const never = readAloudWith(empty).ra.run(PAGE)
    await vi.advanceTimersByTimeAsync(VOICE_WAIT_MS + VOICE_POLL_MS)
    expect((await never).ok).toBe(false)
  })
})

describe('reading aloud (29.5): a failed sentence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fail: synthesis-failed is retried once, then the sentence is skipped and the bar says so once', async () => {
    const speech = new FakeSpeech()
    const { ra, lines } = readAloudWith(speech)
    await ra.run(PAGE)
    speech.fail()
    expect(speech.spoken).toEqual(['Suur uudis.', 'Suur uudis.'])
    speech.fail()
    expect(speech.spoken.at(-1)).toBe('Esimene lause.')
    expect(lines().filter((l) => l === 'Jätsin ühe lause vahele.')).toHaveLength(1)
    speech.fail()
    speech.fail()
    expect(speech.spoken.at(-1)).toBe('Teine lause.')
    expect(lines().filter((l) => l === 'Jätsin ühe lause vahele.')).toHaveLength(1)
    speech.end()
    expect(ra.reading).toBe(false)
  })

  it('fail: a sentence that never ends counts as failed after its timeout, so the microphone is not held shut', async () => {
    const speech = new FakeSpeech()
    const { ra } = readAloudWith(speech)
    await ra.run(PAGE, fetched(['Üks.']))
    vi.advanceTimersByTime(sentenceTimeoutMs('Üks.'))
    expect(speech.spoken).toEqual(['Üks.', 'Üks.'])
    vi.advanceTimersByTime(sentenceTimeoutMs('Üks.'))
    expect(ra.reading).toBe(false)
    vi.advanceTimersByTime(RESUME_MS)
    expect(ra.muted).toBe(false)
  })
})

describe('reading aloud (29.5): no final is delivered while reading', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('read: the recogniser hears silence while reading (the synthesised voice in the microphone makes no final), and hears again after', async () => {
    /** The speech server: any frame with a sound in it is heard as words and finalised at once. */
    const sockets: Array<{ events: SocketEvents; sent: number; silent: number }> = []
    const connect = (events: SocketEvents): SocketLike => {
      const record = { events, sent: 0, silent: 0 }
      sockets.push(record)
      return {
        readyState: 1,
        bufferedAmount: 0,
        send(data: ArrayBuffer | string) {
          if (typeof data === 'string') return
          record.sent += 1
          if (new Float32Array(data).every((x) => x === 0)) record.silent += 1
          else events.message(JSON.stringify({ type: 'final', text: 'loen teile seda lehte ette' }))
        },
        close: () => events.close(),
      }
    }
    let onFrame: ((samples: Float32Array<ArrayBuffer>) => void) | null = null
    const microphone: AudioSource = {
      start: (f) => {
        onFrame = f
        return Promise.resolve()
      },
      stop: () => undefined,
    }
    const speech = new FakeSpeech()
    const { ra } = readAloudWith(speech)
    const finals: string[] = []
    const recogniser = createLocalRecognizer({ onUtterance: (t) => finals.push(t), onInterim: () => undefined, onError: () => undefined }, () => false, {
      onUnavailable: () => undefined,
      connect,
      holdMs: 0,
      audio: () => mutedSource(microphone, () => ra.muted),
    })
    recogniser.start()
    sockets[0]?.events.message(JSON.stringify({ type: 'ready' }))
    await Promise.resolve()
    const voice = (): void => onFrame?.(new Float32Array([0.2, -0.3, 0.25, -0.1]))

    await ra.run(PAGE)
    expect(ra.reading).toBe(true)
    for (let i = 0; i < 20; i++) voice()
    vi.advanceTimersByTime(2000)
    expect(finals).toEqual([])
    expect(sockets[0]?.sent).toBe(20)
    expect(sockets[0]?.silent).toBe(20)

    speech.end()
    speech.end()
    for (let i = 0; i < 5; i++) voice()
    vi.advanceTimersByTime(1000)
    expect(finals).toEqual([])
    speech.end()
    vi.advanceTimersByTime(RESUME_MS)
    expect(ra.muted).toBe(false)
    voice()
    vi.advanceTimersByTime(1000)
    expect(finals).toEqual(['loen teile seda lehte ette'])
    recogniser.stop()
  })
})

describe('reading aloud (29.5): "Loe riba ette" (riba)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('riba: off (the default): no line is spoken', () => {
    const speech = new FakeSpeech()
    const { ra, patches } = readAloudWith(speech)
    ra.publish({ line: 'Kirjutasin: tere.' })
    expect(speech.spoken).toEqual([])
    expect(patches).toEqual([{ line: 'Kirjutasin: tere.' }])
  })

  it('riba: on: each new amber line is spoken, with the microphone muted while it speaks; never the live words', () => {
    const speech = new FakeSpeech()
    const { ra } = readAloudWith(speech)
    ra.setReadBar(true)
    ra.publish({ heard: 'kirjuta tere' })
    expect(speech.spoken).toEqual([])
    ra.publish({ line: 'Kirjutasin: tere.' })
    expect(speech.spoken).toEqual(['Kirjutasin: tere.'])
    expect(ra.muted).toBe(true)
    speech.end()
    vi.advanceTimersByTime(RESUME_MS)
    expect(ra.muted).toBe(false)
    ra.publish({ line: 'Saadan.' })
    expect(speech.spoken).toEqual(['Kirjutasin: tere.', 'Saadan.'])
  })

  it(`riba: not a line of ${BAR_LINE_MAX} characters or more, not an empty one, not the same line again within ${BAR_REPEAT_MS} ms`, () => {
    const speech = new FakeSpeech()
    const { ra } = readAloudWith(speech)
    ra.setReadBar(true)
    ra.publish({ line: 'x'.repeat(BAR_LINE_MAX) })
    ra.publish({ line: '' })
    expect(speech.spoken).toEqual([])
    ra.publish({ line: 'Kerin alla.' })
    ra.publish({ line: 'Kerin alla.' })
    expect(speech.spoken).toEqual(['Kerin alla.'])
    vi.advanceTimersByTime(BAR_REPEAT_MS)
    ra.publish({ line: 'Kerin alla.' })
    expect(speech.spoken).toEqual(['Kerin alla.', 'Kerin alla.'])
  })

  it('riba: never while an article is being read, and the reading cuts off a bar line being spoken', async () => {
    const speech = new FakeSpeech()
    const { ra } = readAloudWith(speech)
    ra.setReadBar(true)
    ra.publish({ line: 'Vaatan lehte.' })
    const cancels = speech.cancels
    await ra.run(PAGE)
    expect(speech.cancels).toBeGreaterThan(cancels)
    ra.publish({ line: 'Kirjutasin: tere.' })
    expect(speech.spoken).toEqual(['Vaatan lehte.', 'Suur uudis.'])
  })

  it('riba: the setting is the last group of the settings page, off by default', () => {
    expect(SETTING_KEYS.at(-1)).toBe('readBar')
    expect(DEFAULT_SETTINGS.readBar).toBe(false)
    expect(settingsFrom({ readBar: true }).readBar).toBe(true)
    expect(settingsFrom({ readBar: 'yes' }).readBar).toBe(false)
  })
})
