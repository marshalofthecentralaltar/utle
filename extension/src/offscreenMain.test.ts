import type { IntentRequest } from '../../src/core/pageIntent.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STRINGS } from '../../src/core/strings.ts'
import { DEFAULT_ASR_URL, authHeaders, connectionFrom, isHostedAddress, serverCheck, serverStatus, socketAddress } from './connection.ts'
import { ENOUGH_PHRASES, asrAddress, askIntent, enrolledLine, foreignNotice, serverUrl, wakeWordParam } from './offscreenMain.ts'
import { INITIAL_STATE } from './messages.ts'
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
import type { BrowserCommand } from '../../src/browser/protocol.ts'
import { applyIntent, initialInpage, inpageInstant, inpagePreview, inpageResult, inpageStep } from '../../src/core/inpage.ts'
import { pageIntentFrom } from '../../src/core/pageIntent.ts'
import { createEngine } from './engine.ts'

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

  it('round 10 (31.5): any reason but another voice says the voice could not be confirmed, with what to do', () => {
    const lines = { ...text, voiceUnverified: 'Häält ei õnnestunud kinnitada.', voiceTooShort: 'Proovi pikemat käsku.', voiceUnsupported: 'Häält ei saa praegu kontrollida.' }
    expect(foreignNotice(1, lines, 'rejected_other')).toEqual({ foreign: lines.foreign })
    expect(foreignNotice(1, lines, 'insufficient_audio')).toEqual({ foreign: lines.voiceUnverified, line: lines.voiceTooShort })
    expect(foreignNotice(1, lines, 'model_unavailable')).toEqual({ foreign: lines.voiceUnverified, line: lines.voiceUnsupported })
    for (const reason of ['profile_missing', 'model_mismatch', 'verification_error', 'mixed_speakers'] as const) expect(foreignNotice(1, lines, reason)).toEqual({ foreign: lines.voiceUnverified })
    expect(foreignNotice(3, lines, 'verification_error')).toEqual({ foreign: lines.voiceUnverified, line: lines.foreignRetrain })
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

// ---------- wake word and places (29.4) ----------
describe('wake mode in the offscreen document (29.4.1)', () => {
  it('the dictation window: wake mode and its word come from the address, else there is no gate', () => {
    expect(wakeWordParam(new URLSearchParams('asr=x&engine=local'))).toBeUndefined()
    expect(wakeWordParam(new URLSearchParams(`asr=x&wake=${encodeURIComponent('Ütle')}`))).toBe('Ütle')
    expect(wakeWordParam(new URLSearchParams(`wake=${encodeURIComponent('hei arvuti')}`))).toBe('hei arvuti')
    // A word the setting would refuse is the default.
    expect(wakeWordParam(new URLSearchParams('wake=r2d2'))).toBe('Ütle')
  })

  it('the dictation window starts closed in the strip state (wakeOpen false)', () => {
    expect(INITIAL_STATE.wakeOpen).toBe(false)
  })
})
// ---------- end of wake word and places ----------
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

  it('read: an article never mutes the microphone (micMuted stays false): the engine filters the finals instead', async () => {
    const speech = new FakeSpeech()
    const { ra, patches } = readAloudWith(speech)
    await ra.run(PAGE, fetched(['Üks.', 'Kaks.']))
    expect(ra.muted).toBe(false)
    speech.end()
    speech.end()
    vi.advanceTimersByTime(RESUME_MS)
    expect(ra.muted).toBe(false)
    expect(patches.some((p) => p.micMuted !== undefined)).toBe(false)
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
    expect(ra.muted).toBe(false)
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

describe('reading aloud (29.5): the microphone stays live while an article is read', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("read: the recogniser hears the room while an article is read; a final that is not a stop word is dropped and never shown; 'stopp' stops within 300 ms", async () => {
    /** The speech server: any frame with a sound in it is heard as `said` and finalised at once. */
    let said = 'tartu raamatukogu avab uue lugemissaali'
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
          else events.message(JSON.stringify({ type: 'final', text: said }))
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
    const sound = (): void => onFrame?.(new Float32Array([0.2, -0.3, 0.25, -0.1]))
    const speech = new FakeSpeech()
    const { ra, patches } = readAloudWith(speech)
    const ran: BrowserCommand[] = []
    const heard: string[] = []
    const stopsAt: number[] = []
    const engine = createEngine({
      logic: { initialInpage, inpageStep, inpageResult, inpageInstant, inpagePreview, applyIntent, pageIntentFrom },
      lang: 'et',
      run: (command) => {
        ran.push(command)
        if (command.kind === 'read') {
          if (command.what === 'stop') stopsAt.push(Date.now())
          return ra.run(command, fetched())
        }
        if (command.kind === 'readBox') return Promise.resolve({ ok: true, box: { present: false, text: '', armed: false } })
        return Promise.resolve({ ok: true })
      },
      publish: (patch) => {
        if (patch.heard !== undefined) heard.push(patch.heard)
        ra.publish(patch)
      },
      recognizer: (handlers, isInstant) => createLocalRecognizer(handlers, isInstant, { onUnavailable: () => undefined, connect, holdMs: 0, audio: () => mutedSource(microphone, () => ra.muted) }),
      micBlocked: () => undefined,
      ask: () => Promise.resolve({ error: 'unreachable' }),
      tabs: () => Promise.resolve([]),
      status: () => Promise.resolve('live'),
      reading: () => ra.reading,
    })
    engine.start()
    sockets[0]?.events.message(JSON.stringify({ type: 'ready' }))
    await Promise.resolve()

    await ra.run({ kind: 'read', what: 'page' }, fetched())
    expect(ra.reading).toBe(true)
    // The synthesised voice in the microphone: the server hears it (no silence sent), the engine drops it unseen.
    for (let i = 0; i < 10; i++) sound()
    await vi.advanceTimersByTimeAsync(1000)
    await engine.idle()
    expect(sockets[0]?.sent).toBe(10)
    expect(sockets[0]?.silent).toBe(0)
    expect(ra.muted).toBe(false)
    expect(patches.some((p) => p.micMuted === true)).toBe(false)
    expect(heard).toEqual([])
    expect(ran.filter((c) => c.kind !== 'readBox')).toEqual([])

    // He says "stopp" over the voice: it is heard and the reading stops at once.
    said = 'stopp'
    const cancels = speech.cancels
    const t0 = Date.now()
    sound()
    await vi.advanceTimersByTimeAsync(0)
    expect(stopsAt).toHaveLength(1)
    expect((stopsAt[0] ?? Number.POSITIVE_INFINITY) - t0).toBeLessThanOrEqual(300)
    expect(speech.cancels).toBeGreaterThan(cancels)
    expect(ra.reading).toBe(false)
    expect(heard).toEqual(['stopp'])

    // After the reading the same words are heard and run again.
    said = 'keri alla'
    sound()
    await vi.advanceTimersByTimeAsync(0)
    await engine.idle()
    expect(heard).toEqual(['stopp', 'keri alla'])
    expect(ran.filter((c) => c.kind !== 'readBox').at(-1)).toEqual({ kind: 'scroll', direction: 'down' })
    engine.stop()
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
    // The bar line's mute ends with it; the article itself does not mute.
    vi.advanceTimersByTime(RESUME_MS)
    expect(ra.muted).toBe(false)
  })

  it('riba: the setting is the last group of the settings page, off by default', () => {
    expect(SETTING_KEYS.at(-1)).toBe('readBar')
    expect(DEFAULT_SETTINGS.readBar).toBe(false)
    expect(settingsFrom({ readBar: true }).readBar).toBe(true)
    expect(settingsFrom({ readBar: 'yes' }).readBar).toBe(false)
  })
})

// ---------- the first run (30.1, ONBOARD lane) ----------
describe('the server going away, through the real recogniser and engine (30.1)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hosted: wss:// or another host is hosted; ws:// to this computer is local', () => {
    for (const a of ['ws://localhost:5173/api/asr', 'ws://127.0.0.1:5173/api/asr', 'ws://[::1]:5173/api/asr', 'ws://localhost:5173/api/asr?token=x']) expect(isHostedAddress(a)).toBe(false)
    for (const a of ['wss://utle.up.railway.app/api/asr', 'ws://192.168.1.20:5173/api/asr', 'wss://localhost:8443/api/asr', 'ws://laptop.local:5173/api/asr']) expect(isHostedAddress(a)).toBe(true)
    expect(isHostedAddress('not an address')).toBe(false)
  })

  it('server down then server back: the local line once over many failed tries, "Server vastab jälle." once, the microphone open again', async () => {
    vi.useFakeTimers()
    const sockets: Array<{ events: SocketEvents; socket: SocketLike }> = []
    const connect = (events: SocketEvents): SocketLike => {
      const socket: SocketLike = { readyState: 1, bufferedAmount: 0, send: () => undefined, close: () => events.close() }
      sockets.push({ events, socket })
      return socket
    }
    let mics = 0
    const microphone: AudioSource = { start: () => ((mics += 1), Promise.resolve()), stop: () => undefined }
    const patches: Array<Partial<StripState>> = []
    const engine = createEngine({
      logic: { initialInpage, inpageStep, inpageResult, inpageInstant, inpagePreview, applyIntent, pageIntentFrom },
      lang: 'et',
      run: () => Promise.resolve({ ok: true }),
      publish: (patch) => patches.push(patch),
      recognizer: (handlers, isInstant, onUnavailable) => createLocalRecognizer(handlers, isInstant, { onUnavailable, connect, holdMs: 0, audio: () => microphone, keepTrying: true }),
      micBlocked: () => undefined,
      ask: () => Promise.resolve({ error: 'unreachable' }),
      tabs: () => Promise.resolve([]),
      status: () => Promise.resolve('live'),
      hosted: isHostedAddress('ws://localhost:5173/api/asr'),
    })
    engine.start()
    // The server is stopped: every try is refused.
    for (let i = 0; i < 5; i++) {
      sockets.at(-1)?.events.close()
      await vi.advanceTimersByTimeAsync(5000)
    }
    const S = STRINGS.et.strip
    const problems = patches.flatMap((p) => (p.problem === undefined ? [] : [p.problem]))
    expect(sockets.length).toBe(6)
    expect(problems.filter((p) => p === S.serverDownLocal)).toHaveLength(1)
    expect(patches.some((p) => p.listening === false)).toBe(false)
    // It is started again: the next try is answered.
    sockets.at(-1)?.events.message(JSON.stringify({ type: 'ready' }))
    await vi.advanceTimersByTimeAsync(0)
    const lines = patches.flatMap((p) => (p.line === undefined ? [] : [p.line]))
    expect(lines.filter((l) => l === S.serverBack)).toHaveLength(1)
    expect(patches.at(-1)).toMatchObject({ connection: 'connected', problem: '', line: S.serverBack })
    expect(mics).toBe(1)
  })
})
