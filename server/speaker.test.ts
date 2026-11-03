import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASR_FRAME_SAMPLES } from '../src/speech/asrProtocol.ts'
import { HELD_OUT_PHRASES, MAX_CLIPPED_SHARE, MIN_ENROL_SECONDS, MIN_JUDGE_SECONDS, MIN_NEGATIVES, MIN_PHRASE_RMS, MIN_PHRASE_SECONDS, NEGATIVE_MARGIN, OWNER_THRESHOLD, PER_PROFILE_FLOOR, clippedShare, cosine, createSpeakerGate, meanEmbedding, normalised, pickThreshold, profilePath, profileSummary, profileVersionOf, speakerGates, speakerTestResult, thresholdPolicy, verdict } from './speaker.ts'
import * as speakerModule from './speaker.ts'
import type { EmbeddingExtractor, EnrolPhrase } from './speaker.ts'

/** The factory line is OWNER_THRESHOLD (server/speaker.ts). */
const FACTORY_THRESHOLD = OWNER_THRESHOLD

/**
 * A voice is a number from 0 to 1 carried in a frame's first sample. The fake extractor turns it
 * into a unit vector at that angle, so the cosine between two voices is cos(θ1 − θ2): the same
 * voice scores 1, voices a quarter turn apart score 0.
 */
const fakeExtractor: EmbeddingExtractor = {
  embed(samples) {
    const voice = samples[0] ?? 0
    const angle = (voice * Math.PI) / 2
    return new Float32Array([Math.cos(angle), Math.sin(angle)])
  },
}

/** 100 ms frames of speech at loudness `level`, the first sample saying whose voice it is. */
const speech = (voice: number, seconds: number, level = 0.1): Float32Array[] => {
  const frames: Float32Array[] = []
  for (let i = 0; i < Math.round(seconds * 10); i += 1) {
    const frame = new Float32Array(ASR_FRAME_SAMPLES).fill(level)
    frame[0] = voice
    frames.push(frame)
  }
  return frames
}
const silence = (seconds: number): Float32Array[] => Array.from({ length: Math.round(seconds * 10) }, () => new Float32Array(ASR_FRAME_SAMPLES))

describe('the speaker gate', () => {
  let dir: string
  let profilePath: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-speaker-'))
    profilePath = join(dir, 'speaker', 'owner.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('judges nothing without a profile, and says so', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    expect(gate.hasProfile()).toBe(false)
    expect(gate.hasModel()).toBe(true)
    expect(gate.judge(speech(0, 3))).toBeNull()
  })

  it('learns the owner and knows him and a stranger, with one threshold (strict mode: no band in between)', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    expect(gate.enrol(speech(0, 8))).toBe(true)
    expect(gate.hasProfile()).toBe(true)
    expect(gate.judge(speech(0, 3))).toMatchObject({ speaker: 'owner', score: 1 })
    // cos(45°) = 0.707: still the owner.
    expect(gate.judge(speech(0.5, 3))?.speaker).toBe('owner')
    // cos(72°) = 0.309: someone else.
    expect(gate.judge(speech(0.8, 3))?.speaker).toBe('other')
    // cos(58.5°) = 0.52: round 4 called this unknown and obeyed it; it is someone else now.
    expect(gate.judge(speech(0.65, 3))?.speaker).toBe('other')
  })

  it('never calls the owner a stranger over a profile from another model or of another size (review)', () => {
    const first = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'old.onnx' })
    expect(first.enrol(speech(0, 8))).toBe(true)
    // The same file read by a server with a newer model: the embedding is not comparable, loudness still is.
    const second = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'new.onnx' })
    expect(second.hasProfile()).toBe(true)
    // Round 7: no verdict (null), so strict mode obeys it; unknown would be dropped.
    expect(second.judge(speech(0.8, 3))).toBeNull()
    expect(second.judge(speech(0, 3))).toBeNull()
    expect(second.judge(speech(0, 3, 0.02))?.speaker).toBe('other')
    // An extractor of another size over a profile that names this model: no score, so unknown.
    const wide: EmbeddingExtractor = { embed: () => new Float32Array([1, 0, 0]) }
    const third = createSpeakerGate(wide, { profilePath, modelName: 'old.onnx' })
    expect(third.judge(speech(0.8, 3))).toMatchObject({ speaker: 'unknown', score: 0 })
  })

  it('judges the same frames it learnt from: his own recording, silences and all, scores 1 (round 7)', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    // A voice whose embedding changes when silence is in the clip, as CAM++ did.
    const recording = [...silence(1), ...speech(0.3, 5), ...silence(2)]
    expect(gate.enrol(recording)).toBe(true)
    expect(gate.judge(recording)).toMatchObject({ speaker: 'owner', score: 1 })
  })

  it('calls an utterance shorter than MIN_JUDGE_SECONDS unknown, whatever it sounds like', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    gate.enrol(speech(0, 8))
    expect(gate.judge(speech(0.8, MIN_JUDGE_SECONDS - 0.1))).toMatchObject({ speaker: 'unknown', score: 0 })
    expect(gate.judge(speech(0.8, MIN_JUDGE_SECONDS))?.speaker).toBe('other')
  })

  it('refuses to learn from too little speech, and ignores the silence around it', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    expect(gate.enrol([...silence(5), ...speech(0, 1)])).toBe(false)
    expect(gate.hasProfile()).toBe(false)
    // Round 10 (31.7): free speech is split into a candidate and two held-out seconds, so four seconds at least.
    expect(gate.enrol([...silence(2), ...speech(0, 2), ...silence(2)])).toBe(false)
    expect(gate.enrol([...silence(2), ...speech(0, MIN_ENROL_SECONDS), ...silence(2)])).toBe(true)
  })

  it('stores the profile as an embedding and a loudness, never audio, and loads it again', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'fake.onnx' })
    gate.enrol(speech(0, 8, 0.2))
    expect(existsSync(profilePath)).toBe(true)
    const stored = JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, unknown>
    // Round 10 (31.7): format 2; the embedding is the candidate's (the held-out seconds are not in it).
    expect(stored).toMatchObject({ format: 2, model: { id: 'fake.onnx' }, embedding: [1, 0], seconds: 6 })
    expect(stored.rms).toBeCloseTo(0.2, 2)
    expect(JSON.stringify(stored).length).toBeLessThan(1000)

    // The same model reads it back (another model's name would make the embedding incomparable: see below).
    const again = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'fake.onnx' })
    expect(again.hasProfile()).toBe(true)
    expect(again.judge(speech(0, 3))?.speaker).toBe('owner')
    expect(again.judge(speech(1, 3))?.speaker).toBe('other')
  })

  it('replaces an earlier profile at the next enrolment', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    gate.enrol(speech(0, 8))
    gate.enrol(speech(1, 8))
    expect(gate.judge(speech(1, 3))?.speaker).toBe('owner')
    expect(gate.judge(speech(0, 3))?.speaker).toBe('other')
  })

  it('ignores a broken profile file', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath })
    gate.enrol(speech(0, 8))
    const broken = createSpeakerGate(fakeExtractor, { profilePath: join(dir, 'missing.json') })
    expect(broken.hasProfile()).toBe(false)
  })

  describe('without the model (the energy gate)', () => {
    it('refuses to learn without the model (round 10, 31.7: a loudness profile protects nothing and must not replace a good one)', () => {
      const gate = createSpeakerGate(null, { profilePath })
      expect(gate.hasModel()).toBe(false)
      expect(gate.enrol(speech(0, 8, 0.1))).toBe(false)
      expect(gate.enrolSpeech(speech(0, 8, 0.1))).toEqual({ ok: false, reason: 'model_unavailable' })
      expect(existsSync(profilePath)).toBe(false)
      expect(gate.judge(speech(0, 3, 0.1))).toBeNull()
    })

    it('uses the loudness of a profile made with the model when the model is gone', () => {
      createSpeakerGate(fakeExtractor, { profilePath }).enrol(speech(0, 8, 0.1))
      const gate = createSpeakerGate(null, { profilePath })
      expect(gate.hasProfile()).toBe(true)
      expect(gate.judge(speech(1, 3, 0.1))).toBeNull()
      expect(gate.judge(speech(0, 3, 0.01))?.speaker).toBe('other')
    })
  })

  describe('scripted enrolment (round 7)', () => {
    it('makes the profile the mean of one embedding per phrase, at unit length, and counts the phrases', () => {
      const gate = createSpeakerGate(fakeExtractor, { profilePath, modelName: 'fake.onnx' })
      // Round 10 (31.7): the last two phrases are held out: the candidate is the mean of the first four.
      const phrases = [0, 1, 0, 1, 0.5, 0.5].map((v) => gate.phrase(speech(v, 1.5))).filter((p) => p !== null)
      expect(phrases).toHaveLength(6)
      expect(gate.enrolPhrases(phrases)).toBe(true)
      const stored = JSON.parse(readFileSync(profilePath, 'utf8')) as { embedding: number[]; phrases: number; seconds: number; model: { id: string } }
      expect(stored.phrases).toBe(4)
      expect(stored.seconds).toBe(6)
      expect(stored.model.id).toBe('fake.onnx')
      expect(stored.embedding[0]).toBeCloseTo(Math.SQRT1_2, 6)
      expect(stored.embedding[1]).toBeCloseTo(Math.SQRT1_2, 6)
      // The voice halfway between the two read voices is the owner.
      expect(gate.judge(speech(0.5, 3))).toMatchObject({ speaker: 'owner', score: 1 })
    })

    it('refuses a profile from fewer than six phrases (four to learn from, two held out) (round 10)', () => {
      const gate = createSpeakerGate(fakeExtractor, { profilePath })
      const five = [1, 2, 3, 4, 5].map(() => gate.phrase(speech(0, 1.2))).filter((p) => p !== null)
      expect(gate.enrolPhrases(five)).toBe(false)
      expect(gate.hasProfile()).toBe(false)
      const six = [1, 2, 3, 4, 5, 6].map(() => gate.phrase(speech(0, 1.2))).filter((p) => p !== null)
      expect(gate.enrolPhrases(six)).toBe(true)
      expect(gate.hasProfile()).toBe(true)
      expect(gate.enrolPhrases([])).toBe(false)
    })

    it('does not count a phrase shorter than MIN_PHRASE_SECONDS, nor silence', () => {
      const gate = createSpeakerGate(fakeExtractor, { profilePath })
      expect(gate.phrase(speech(0, MIN_PHRASE_SECONDS - 0.1))).toBeNull()
      expect(gate.phrase(silence(2))).toBeNull()
    })
  })

  it('answers unknown when the extractor fails on an utterance', () => {
    let fail = false
    const flaky: EmbeddingExtractor = {
      embed(samples) {
        if (fail) throw new Error('no embedding')
        return fakeExtractor.embed(samples)
      },
    }
    const gate = createSpeakerGate(flaky, { profilePath })
    gate.enrol(speech(0, 8))
    fail = true
    expect(gate.judge(speech(0, 3))).toMatchObject({ speaker: 'unknown', score: 0 })
    expect(gate.enrol(speech(0, 8))).toBe(false)
  })
})

describe('no continuity (round 10, issue #3 B3): every utterance is judged on its own audio', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-continuity-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('the judgement says how many seconds of speech it was made from', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: join(dir, 'owner.json') })
    gate.enrol(speech(0, 8))
    expect(gate.judge([...silence(1), ...speech(0, 3)])).toEqual({ speaker: 'owner', score: 1, seconds: 3 })
    expect(gate.judge(speech(0, 0.4))).toEqual({ speaker: 'unknown', score: 0, seconds: 0.4 })
    expect(gate.judge(speech(0.8, 0.7))).toEqual({ speaker: 'other', score: 0.309, seconds: 0.7 })
  })

  it('the recency rule and its constants are gone: nothing can promote a short word by who spoke last', () => {
    const names = Object.keys(speakerModule)
    expect(names).not.toContain('continued')
    expect(names).not.toContain('CONTINUITY_MS')
    expect(names).not.toContain('SHORT_UTTERANCE_SECONDS')
  })

  it("a stranger's short word right after the owner's long one is verified on its own audio and denied", () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: join(dir, 'owner.json') })
    gate.enrol(speech(0, 8))
    expect(gate.verify(speech(0, 2)).reason).toBe('verified_owner')
    expect(gate.verify(speech(0.8, 0.7)).reason).toBe('rejected_other')
    expect(gate.verify(speech(0.8, 0.4)).reason).toBe('insufficient_audio')
    // The owner's own short word without enough audio is denied too (work package C improves it).
    expect(gate.verify(speech(0, 0.4)).reason).toBe('insufficient_audio')
  })
})

describe('verify (round 10, 31.2): one reason per case, fail closed', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-verify-'))
    path = join(dir, 'owner.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('profile_missing without a profile', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    expect(gate.verify(speech(0, 3))).toEqual({ judgement: null, reason: 'profile_missing', profileVersion: '' })
    expect(gate.profileVersion()).toBe('')
  })

  it('verified_owner at or above the threshold, rejected_other below it, with the profile version', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    gate.enrol(speech(0, 8))
    const version = gate.profileVersion()
    expect(version).toMatch(/^v1-[0-9a-f]{8}$/)
    expect(gate.verify(speech(0, 3))).toEqual({ judgement: { speaker: 'owner', score: 1, seconds: 3 }, reason: 'verified_owner', profileVersion: version })
    expect(gate.verify(speech(0.8, 1))).toEqual({ judgement: { speaker: 'other', score: 0.309, seconds: 1 }, reason: 'rejected_other', profileVersion: version })
  })

  it('insufficient_audio under MIN_JUDGE_SECONDS of speech', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    gate.enrol(speech(0, 8))
    expect(gate.verify([...silence(2), ...speech(0, MIN_JUDGE_SECONDS - 0.1)]).reason).toBe('insufficient_audio')
  })

  it('model_unavailable without the model, even for speech as loud as the owner (loudness is never identity)', () => {
    createSpeakerGate(fakeExtractor, { profilePath: path }).enrol(speech(0, 8))
    const gate = createSpeakerGate(null, { profilePath: path })
    expect(gate.judge(speech(0, 3))).toBeNull()
    expect(gate.verify(speech(0, 3)).reason).toBe('model_unavailable')
  })

  it('model_mismatch for a profile made with another model, or without an embedding', () => {
    createSpeakerGate(fakeExtractor, { profilePath: path, modelName: 'campplus.onnx' }).enrol(speech(0, 8))
    expect(createSpeakerGate(fakeExtractor, { profilePath: path, modelName: 'titanet.onnx' }).verify(speech(0, 3)).reason).toBe('model_mismatch')
    const loud = join(dir, 'loudness.json')
    writeFileSync(loud, JSON.stringify({ format: 2, model: { id: '', hash: '' }, embedding: [], rms: 0.1, seconds: 6, phrases: 0, heldOut: { count: 0, scores: [], passed: false, threshold: 0.54 } }))
    expect(createSpeakerGate(fakeExtractor, { profilePath: loud }).verify(speech(0, 3)).reason).toBe('model_mismatch')
  })

  it('verification_error when the extractor throws or the score is not a number', () => {
    let mode: 'ok' | 'throw' | 'short' = 'ok'
    const flaky: EmbeddingExtractor = {
      embed(samples) {
        if (mode === 'throw') throw new Error('onnx')
        if (mode === 'short') return new Float32Array([1])
        return fakeExtractor.embed(samples)
      },
    }
    const gate = createSpeakerGate(flaky, { profilePath: path })
    gate.enrol(speech(0, 8))
    mode = 'throw'
    expect(gate.verify(speech(0, 3)).reason).toBe('verification_error')
    mode = 'short'
    expect(gate.verify(speech(0, 3)).reason).toBe('verification_error')
  })

  it('a new enrolment is a new profile version', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    gate.enrol(speech(0, 8))
    const first = gate.profileVersion()
    gate.enrol(speech(0.1, 8))
    expect(gate.profileVersion()).not.toBe(first)
    expect(profileVersionOf(null)).toBe('')
  })
})

describe('the arithmetic', () => {
  it('normalises and compares', () => {
    expect(normalised([3, 4])).toEqual([0.6, 0.8])
    expect(normalised([0, 0])).toEqual([0, 0])
    expect(cosine([1, 0], [1, 0])).toBe(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    // Vectors that cannot be compared give no score at all, never one that reads as a stranger (review).
    expect(cosine([1, 0], [1])).toBeNaN()
    expect(cosine([], [])).toBeNaN()
  })

  it('strict mode: draws one line, at OWNER_THRESHOLD, measured on the calibration set', () => {
    expect(verdict(OWNER_THRESHOLD)).toBe('owner')
    expect(verdict(OWNER_THRESHOLD - 0.001)).toBe('other')
    expect(verdict(1)).toBe('owner')
    expect(verdict(0)).toBe('other')
    // scripts/fixtures/speaker-set/scores.json: the closest other voice 0.499, the stand-in owner's next score 0.577.
    expect(OWNER_THRESHOLD).toBeGreaterThan(0.499)
    expect(OWNER_THRESHOLD).toBeLessThanOrEqual(0.577)
  })

  it('averages unit embeddings to unit length', () => {
    expect(meanEmbedding([])).toEqual([])
    const mean = meanEmbedding([[1, 0], [0, 1]])
    expect(mean[0]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(mean[1]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('picks the threshold with the fewest errors, ties toward dropping others, in the middle of the gap', () => {
    // A clean gap: the middle of it.
    expect(pickThreshold([0.7, 0.8, 0.9], [0.1, 0.3, 0.5])).toEqual({ threshold: 0.6, ownerDropped: 0, otherPassed: 0 })
    // An overlap of one: one error either way; the one that drops the owner clip wins (others never pass).
    const tie = pickThreshold([0.4, 0.8], [0.5, 0.2])
    expect(tie.ownerDropped + tie.otherPassed).toBe(1)
    expect(tie.otherPassed).toBe(0)
    expect(tie.threshold).toBeGreaterThan(0.5)
    expect(tie.threshold).toBeLessThanOrEqual(0.8)
  })
})

describe('profiles per token (round 7, HOST lane)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-profiles-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps today\'s owner.json for the local user, and puts each token\'s profile under profiles/', () => {
    expect(profilePath('/app', {}, '')).toBe(join('/app', 'models', 'speaker', 'owner.json'))
    expect(profilePath('/app', {}, 'abcdef0123456789')).toBe(join('/app', 'models', 'speaker', 'profiles', 'abcdef0123456789.json'))
    expect(profilePath('/app', { UTLE_DATA_DIR: '/data' }, 'abcdef0123456789')).toBe(join('/data', 'profiles', 'abcdef0123456789.json'))
    expect(profilePath('/app', { UTLE_DATA_DIR: '  ' }, '')).toBe(join('/app', 'models', 'speaker', 'owner.json'))
  })

  it('two tokens enrol two profiles and each is judged against its own', () => {
    const env = { UTLE_DATA_DIR: dir }
    const gateFor = speakerGates(fakeExtractor)
    const ralf = profilePath('/unused', env, 'aaaaaaaaaaaaaaaa')
    const mari = profilePath('/unused', env, 'bbbbbbbbbbbbbbbb')
    expect(gateFor(ralf)).toBe(gateFor(ralf))
    expect(gateFor(ralf)).not.toBe(gateFor(mari))
    expect(gateFor(ralf).enrol(speech(0, 8))).toBe(true)
    expect(gateFor(mari).judge(speech(0, 3))).toBeNull()
    expect(gateFor(mari).enrol(speech(1, 8))).toBe(true)
    expect(gateFor(ralf).judge(speech(0, 3))?.speaker).toBe('owner')
    expect(gateFor(ralf).judge(speech(1, 3))?.speaker).toBe('other')
    expect(gateFor(mari).judge(speech(1, 3))?.speaker).toBe('owner')
    expect(gateFor(mari).judge(speech(0, 3))?.speaker).toBe('other')
    expect(existsSync(join(dir, 'profiles', 'aaaaaaaaaaaaaaaa.json'))).toBe(true)
    expect(existsSync(join(dir, 'profiles', 'bbbbbbbbbbbbbbbb.json'))).toBe(true)
    expect(existsSync(join(dir, 'owner.json'))).toBe(false)
    // A restart reads each back from its own file.
    expect(speakerGates(fakeExtractor)(mari).judge(speech(1, 3))?.speaker).toBe('owner')
  })

  it('two tokens enrol two profiles from read phrases (round 7) and each is judged against its own', () => {
    const env = { UTLE_DATA_DIR: dir }
    const gateFor = speakerGates(fakeExtractor)
    const ralf = profilePath('/unused', env, 'dddddddddddddddd')
    const mari = profilePath('/unused', env, 'eeeeeeeeeeeeeeee')
    const read = (path: string, voice: number): EnrolPhrase[] => [1, 2, 3, 4, 5, 6, 7, 8].map(() => gateFor(path).phrase(speech(voice, 1.5))).filter((p): p is EnrolPhrase => p !== null)
    const ralfPhrases = read(ralf, 0)
    const mariPhrases = read(mari, 1)
    expect(ralfPhrases).toHaveLength(8)
    expect(gateFor(ralf).enrolPhrases(ralfPhrases)).toBe(true)
    expect(gateFor(mari).judge(speech(1, 3))).toBeNull()
    expect(gateFor(mari).enrolPhrases(mariPhrases)).toBe(true)
    expect(gateFor(ralf).judge(speech(0, 3))).toMatchObject({ speaker: 'owner', score: 1 })
    expect(gateFor(ralf).judge(speech(1, 3))?.speaker).toBe('other')
    expect(gateFor(mari).judge(speech(1, 3))).toMatchObject({ speaker: 'owner', score: 1 })
    expect(gateFor(mari).judge(speech(0, 3))?.speaker).toBe('other')
    expect(profileSummary(ralf)).toEqual({ enrolled: true, seconds: 9, format: 'v2', phrases: 6 })
    expect(JSON.parse(readFileSync(mari, 'utf8'))).toMatchObject({ phrases: 6, model: { id: 'nemo_en_titanet_small.onnx' } })
    // A restart reads each back from its own file.
    expect(speakerGates(fakeExtractor)(ralf).judge(speech(0, 3))?.speaker).toBe('owner')
  })

  it('summarises a profile for /api/status without reading out the voice', () => {
    const path = profilePath('/unused', { UTLE_DATA_DIR: dir }, 'cccccccccccccccc')
    expect(profileSummary(path)).toEqual({ enrolled: false })
    speakerGates(fakeExtractor)(path).enrol(speech(0, 8))
    expect(profileSummary(path)).toEqual({ enrolled: true, seconds: 6, format: 'v2', phrases: 0 })
  })
})

// ---------- round 10, lane VOICE (31.7): quality, held-out verification, versioned profile, readiness ----------

describe('enrolment phrase quality (round 10, 31.7)', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-quality-'))
    path = join(dir, 'owner.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a phrase with enough clean speech, with its quality', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    const result = gate.assessPhrase(speech(0, 1.5, 0.1))
    expect(result.problem).toBeNull()
    expect(result.phrase?.seconds).toBeCloseTo(1.5, 5)
    expect(result.quality).toMatchObject({ seconds: 1.5, clipped: 0 })
    expect(result.quality.rms).toBeCloseTo(0.1, 3)
  })

  it('asks again with a reason: too short, too quiet, clipped, model error', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    expect(gate.assessPhrase(speech(0, MIN_PHRASE_SECONDS - 0.1)).problem).toBe('too_short')
    expect(gate.assessPhrase(silence(2)).problem).toBe('too_short')
    expect(gate.assessPhrase(speech(0, 1.5, MIN_PHRASE_RMS * 0.8)).problem).toBe('too_quiet')
    expect(gate.assessPhrase(speech(0, 1.5, 1)).problem).toBe('clipped')
    const broken = createSpeakerGate(
      {
        embed: () => {
          throw new Error('onnx')
        },
      },
      { profilePath: path },
    )
    expect(broken.assessPhrase(speech(0, 1.5)).problem).toBe('model_error')
    // The old interface says null for every one of them.
    expect(gate.phrase(speech(0, 1.5, 1))).toBeNull()
  })

  it('clippedShare counts samples at full scale', () => {
    const frame = new Float32Array(1000).fill(0.1)
    for (let i = 0; i < 10; i += 1) frame[i] = i % 2 === 0 ? 1 : -1
    expect(clippedShare([frame])).toBeCloseTo(0.01, 6)
    expect(MAX_CLIPPED_SHARE).toBeLessThan(0.01)
  })
})

describe('held-out verification and the atomic replace (round 10, 31.7)', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-heldout-'))
    path = join(dir, 'speaker', 'owner.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const phrases = (gate: ReturnType<typeof createSpeakerGate>, voices: number[]): EnrolPhrase[] => voices.map((v) => gate.phrase(speech(v, 1.5))).filter((p): p is EnrolPhrase => p !== null)

  it('builds the candidate from N-2 phrases and verifies it on the 2 held out', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    const outcome = gate.enrolScripted(phrases(gate, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.2]))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.phrases).toBe(10)
    expect(outcome.heldOut.count).toBe(HELD_OUT_PHRASES)
    expect(outcome.heldOut.scores).toEqual([0.988, 0.951])
    expect(outcome.heldOut.passed).toBe(true)
    expect(outcome.heldOut.threshold).toBe(FACTORY_THRESHOLD)
  })

  it('a candidate that fails on the held-out phrases replaces nothing: the old profile stays, on disk and in use', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    expect(gate.enrolScripted(phrases(gate, [0, 0, 0, 0, 0, 0])).ok).toBe(true)
    const before = readFileSync(path, 'utf8')
    const version = gate.profileVersion()
    // Someone else read the last two (cos 72 degrees = 0.31, under the threshold).
    const failed = gate.enrolScripted(phrases(gate, [1, 1, 1, 1, 0.2, 0.2]))
    expect(failed).toMatchObject({ ok: false, reason: 'held_out_failed' })
    if (failed.ok) return
    expect(failed.heldOut?.passed).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(gate.profileVersion()).toBe(version)
    expect(gate.verify(speech(0, 3)).reason).toBe('verified_owner')
  })

  it('a write that fails half way keeps the old profile on disk and in memory, and leaves no partial file behind', () => {
    let fail = false
    const writeFile = (file: string, data: string): void => {
      if (fail) {
        writeFileSync(file, data.slice(0, 10))
        throw new Error('disk full')
      }
      writeFileSync(file, data)
    }
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path, writeFile })
    expect(gate.enrolScripted(phrases(gate, [0, 0, 0, 0, 0, 0])).ok).toBe(true)
    const before = readFileSync(path, 'utf8')
    const version = gate.profileVersion()
    fail = true
    expect(gate.enrolScripted(phrases(gate, [1, 1, 1, 1, 1, 1]))).toMatchObject({ ok: false, reason: 'write_failed' })
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(existsSync(`${path}.part`)).toBe(false)
    expect(gate.profileVersion()).toBe(version)
    expect(gate.verify(speech(0, 3)).reason).toBe('verified_owner')
    expect(gate.verify(speech(1, 3)).reason).toBe('rejected_other')
    // A restart reads the old one too.
    expect(createSpeakerGate(fakeExtractor, { profilePath: path }).verify(speech(0, 3)).reason).toBe('verified_owner')
  })

  it('too few phrases is its own reason, and keeps the old profile', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    expect(gate.enrolScripted(phrases(gate, [0, 0, 0, 0, 0, 0])).ok).toBe(true)
    expect(gate.enrolScripted(phrases(gate, [1, 1, 1]))).toMatchObject({ ok: false, reason: 'too_few_phrases' })
    expect(gate.verify(speech(0, 3)).reason).toBe('verified_owner')
  })

  it('free speech: the last two seconds are held out, the rest is the candidate', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    const outcome = gate.enrolSpeech([...speech(0, 6), ...speech(1, 2)])
    expect(outcome).toMatchObject({ ok: false, reason: 'held_out_failed' })
    expect(gate.hasProfile()).toBe(false)
    expect(gate.enrolSpeech(speech(0, 8))).toMatchObject({ ok: true, heldOut: { count: 2, passed: true } })
  })
})

describe('the versioned profile (round 10, 31.7)', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-profile-'))
    path = join(dir, 'owner.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('holds the embedding, the model id and file hash, the phrase count, quality, threshold policy with provenance, the held-out result and timestamps; no audio', () => {
    const times = ['2026-11-01T10:00:00.000Z', '2026-11-01T11:00:00.000Z']
    let call = 0
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path, modelName: 'titanet.onnx', modelHash: 'abc123', now: () => times[Math.min(call++, 1)] ?? '' })
    const read = (v: number): EnrolPhrase[] => [1, 2, 3, 4, 5, 6, 7].map(() => gate.phrase(speech(v, 1.5))).filter((p): p is EnrolPhrase => p !== null)
    expect(gate.enrolScripted(read(0)).ok).toBe(true)
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(stored).toMatchObject({
      format: 2,
      model: { id: 'titanet.onnx', hash: 'abc123' },
      embedding: [1, 0],
      phrases: 5,
      seconds: 7.5,
      quality: { phrases: 5, minSeconds: 1.5, meanSeconds: 1.5, maxClipped: 0 },
      threshold: { value: FACTORY_THRESHOLD, source: 'factory', negatives: 0 },
      heldOut: { count: 2, scores: [1, 1], passed: true, threshold: FACTORY_THRESHOLD },
      createdAt: times[0],
      updatedAt: times[0],
    })
    expect(String((stored.threshold as { provenance: string }).provenance)).toMatch(/synthetic/)
    expect(Object.keys(stored).sort()).toEqual(['createdAt', 'embedding', 'format', 'heldOut', 'model', 'phrases', 'quality', 'rms', 'seconds', 'threshold', 'updatedAt'])
    expect(JSON.stringify(stored).length).toBeLessThan(1000)
    // Re-enrolment keeps the creation time and moves the update time.
    expect(gate.enrolScripted(read(0.05)).ok).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ createdAt: times[0], updatedAt: times[1] })
  })

  it('a profile made with the same model file name but another file hash does not protect', () => {
    createSpeakerGate(fakeExtractor, { profilePath: path, modelName: 'titanet.onnx', modelHash: 'aaa' }).enrol(speech(0, 8))
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path, modelName: 'titanet.onnx', modelHash: 'bbb' })
    expect(gate.verify(speech(0, 3)).reason).toBe('model_mismatch')
    expect(gate.readiness()).toMatchObject({ state: 'model_mismatch', protected: false, profileMatchesModel: false })
  })

  it('a round-7 owner.json (version 1) is reported "needs retraining", never treated as protection', () => {
    // The exact shape round 7 wrote (server/speaker.ts before round 10).
    writeFileSync(path, JSON.stringify({ version: 1, model: 'nemo_en_titanet_small.onnx', embedding: [1, 0], rms: 0.1, seconds: 14.2, phrases: 12 }))
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    expect(gate.hasProfile()).toBe(false)
    expect(gate.verify(speech(0, 3)).reason).toBe('model_mismatch')
    expect(gate.judge(speech(0, 3))).toBeNull()
    expect(gate.readiness()).toEqual({ state: 'needs_retraining', protected: false, extractor: true, profileMatchesModel: false, verifiable: false })
    expect(profileSummary(path)).toEqual({ enrolled: false, format: 'needs_retraining' })
    // Teaching the voice again replaces it with format 2.
    expect(gate.enrol(speech(0, 8))).toBe(true)
    expect(gate.readiness().state).toBe('ready')
  })

  it('a hosted per-token file of round 7 is "needs retraining" too', () => {
    const tokenFile = profilePath('/unused', { UTLE_DATA_DIR: dir }, 'ffffffffffffffff')
    mkdirSync(dirname(tokenFile), { recursive: true })
    writeFileSync(tokenFile, JSON.stringify({ version: 1, model: 'nemo_en_titanet_small.onnx', embedding: [0, 1], rms: 0.2, seconds: 8, phrases: 0 }))
    expect(speakerGates(fakeExtractor)(tokenFile).readiness().state).toBe('needs_retraining')
    expect(speakerGates(fakeExtractor)(tokenFile).verify(speech(1, 3)).reason).toBe('model_mismatch')
  })

  it('delete removes the file and every authorization with it', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    gate.enrol(speech(0, 8))
    expect(gate.deleteProfile()).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(gate.verify(speech(0, 3)).reason).toBe('profile_missing')
    expect(gate.readiness().state).toBe('no_profile')
    expect(gate.profileVersion()).toBe('')
  })
})

describe('the threshold policy (round 10, 31.7)', () => {
  it('is the factory threshold, with its provenance, unless enough negatives support one per profile', () => {
    expect(thresholdPolicy([])).toMatchObject({ value: FACTORY_THRESHOLD, source: 'factory', negatives: 0 })
    const few = Array.from({ length: MIN_NEGATIVES - 1 }, () => 0.1)
    expect(thresholdPolicy(few).source).toBe('factory')
    const enough = Array.from({ length: MIN_NEGATIVES }, (_, i) => 0.1 + i * 0.005)
    const policy = thresholdPolicy(enough)
    expect(policy.source).toBe('per_profile')
    expect(policy.negatives).toBe(MIN_NEGATIVES)
    // The highest negative plus the margin, never below the floor.
    expect(policy.value).toBeCloseTo(Math.max(PER_PROFILE_FLOOR, 0.1 + (MIN_NEGATIVES - 1) * 0.005 + NEGATIVE_MARGIN), 6)
    expect(thresholdPolicy(Array.from({ length: MIN_NEGATIVES }, () => 0.62)).value).toBeCloseTo(0.67, 6)
  })

  it('the gate uses the per-profile threshold when given consenting negatives, and records it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'utle-policy-'))
    try {
      const path = join(dir, 'owner.json')
      // Negatives at voice 0.9 score cos(81 degrees) = 0.156 against the owner: the per-profile line is the floor.
      const negatives = Array.from({ length: MIN_NEGATIVES }, () => Array.from(fakeExtractor.embed(new Float32Array([0.9]))))
      const gate = createSpeakerGate(fakeExtractor, { profilePath: path, negatives })
      expect(gate.enrol(speech(0, 8))).toBe(true)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ threshold: { source: 'per_profile', value: PER_PROFILE_FLOOR, negatives: MIN_NEGATIVES } })
      // cos(58.5 degrees) = 0.52: below the factory line, above this profile's.
      expect(gate.verify(speech(0.65, 3)).reason).toBe('verified_owner')
      // A later factory line does not move a per-profile one.
      const later = createSpeakerGate(fakeExtractor, { profilePath: path, factoryThreshold: 0.6 })
      expect(later.verify(speech(0.65, 3)).reason).toBe('verified_owner')
      expect(later.readiness().threshold).toEqual({ value: PER_PROFILE_FLOOR, source: 'per_profile' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a factory-sourced profile is judged at the factory line of today, not the one it was made with (the stored value is history)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'utle-policy-'))
    try {
      const path = join(dir, 'owner.json')
      const made = createSpeakerGate(fakeExtractor, { profilePath: path })
      expect(made.enrol(speech(0, 8))).toBe(true)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ threshold: { source: 'factory', value: FACTORY_THRESHOLD } })
      // cos(55.8 degrees) = 0.562: above the line it was made with, below a factory line moved to 0.6.
      expect(made.verify(speech(0.62, 3)).reason).toBe('verified_owner')
      const moved = createSpeakerGate(fakeExtractor, { profilePath: path, factoryThreshold: 0.6 })
      expect(moved.verify(speech(0.62, 3)).reason).toBe('rejected_other')
      expect(moved.judge(speech(0.62, 3))?.speaker).toBe('other')
      // Readiness reports the line in force and, when it differs, the one the profile was made with.
      expect(moved.readiness().threshold).toEqual({ value: 0.6, source: 'factory', stored: FACTORY_THRESHOLD })
      expect(made.readiness().threshold).toEqual({ value: FACTORY_THRESHOLD, source: 'factory' })
      // A new enrolment under the moved line records it, with its held-out check at that line.
      const again = createSpeakerGate(fakeExtractor, { profilePath: path, factoryThreshold: 0.6 })
      expect(again.enrol(speech(0, 8))).toBe(true)
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ threshold: { source: 'factory', value: 0.6 }, heldOut: { threshold: 0.6 } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readiness and the voice test (round 10, 31.7)', () => {
  let dir: string
  let path: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'utle-ready-'))
    path = join(dir, 'owner.json')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is ready only with the extractor loaded, a format-2 profile of this model, verified on held-out speech', () => {
    expect(createSpeakerGate(fakeExtractor, { profilePath: path }).readiness()).toEqual({ state: 'no_profile', protected: false, extractor: true, profileMatchesModel: false, verifiable: false })
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    gate.enrol(speech(0, 8))
    expect(gate.readiness()).toEqual({ state: 'ready', protected: true, extractor: true, profileMatchesModel: true, verifiable: true, phrases: 0, heldOut: { count: 2, passed: true }, threshold: { value: FACTORY_THRESHOLD, source: 'factory' } })
    expect(createSpeakerGate(null, { profilePath: path }).readiness()).toMatchObject({ state: 'model_unavailable', protected: false, extractor: false })
  })

  it('the voice test: recognised, not recognised, too short, noisy, unavailable', () => {
    const gate = createSpeakerGate(fakeExtractor, { profilePath: path })
    expect(gate.test(speech(0, 2)).result).toBe('unavailable')
    gate.enrol(speech(0, 8))
    expect(gate.test(speech(0, 2))).toMatchObject({ result: 'recognised', score: 1, seconds: 2 })
    expect(gate.test(speech(1, 2))).toMatchObject({ result: 'not_recognised', seconds: 2 })
    expect(gate.test(speech(0, 0.3)).result).toBe('too_short')
    expect(gate.test(speech(1, 2, 1)).result).toBe('noisy')
    expect(speakerTestResult('rejected_other', 'too_quiet')).toBe('noisy')
    expect(createSpeakerGate(null, { profilePath: path }).test(speech(0, 2)).result).toBe('unavailable')
    expect(speakerTestResult('model_mismatch', null)).toBe('unavailable')
    expect(speakerTestResult('verification_error', null)).toBe('unavailable')
  })
})
