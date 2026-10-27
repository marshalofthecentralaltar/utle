import { describe, expect, it } from 'vitest'
import { SPEAKER_REASONS, authorizes, parseAsrMessage, parseDecision, verdictFor, verifiedOwner } from './asrProtocol.ts'
import type { SpeakerDecision, SpeakerReason } from './asrProtocol.ts'

// Round 10 (ARCHITECTURE 31.1): the typed decision and the barrier's one rule.
const SESSION = { sessionId: 'session-1', profileVersion: 'v1-0badcafe' }
const decision = (reason: SpeakerReason, over: Partial<SpeakerDecision> = {}): SpeakerDecision => ({
  segmentId: 3,
  ...SESSION,
  verdict: verdictFor(reason),
  reason,
  score: 0.5,
  timings: { judgeMs: 12, speechMs: 900 },
  ...over,
})

describe('the speaker decision (round 10, 31.1)', () => {
  it('has exactly the eight reasons, and only verified_owner stands for the owner', () => {
    expect([...SPEAKER_REASONS].sort()).toEqual(['insufficient_audio', 'verified_owner', 'mixed_speakers', 'model_mismatch', 'model_unavailable', 'profile_missing', 'rejected_other', 'verification_error'].sort())
    expect(SPEAKER_REASONS.map((r) => [r, verdictFor(r)])).toEqual([
      ['verified_owner', 'owner'],
      ['rejected_other', 'other'],
      ['insufficient_audio', 'unknown'],
      ['profile_missing', 'unknown'],
      ['model_unavailable', 'unknown'],
      ['model_mismatch', 'unknown'],
      ['verification_error', 'unknown'],
      ['mixed_speakers', 'other'],
    ])
  })

  for (const reason of SPEAKER_REASONS) {
    it(`${reason}: survives the wire on a final and on a rejection, and authorizes only if it is verified_owner`, () => {
      const d = decision(reason)
      const final = parseAsrMessage(JSON.stringify({ type: 'final', text: 'saada', speaker: d.verdict, segment: d.segmentId, decision: d }))
      expect(final).toEqual({ type: 'final', text: 'saada', speaker: d.verdict, segment: 3, decision: d })
      expect(parseAsrMessage(JSON.stringify({ type: 'rejected', decision: d }))).toEqual({ type: 'rejected', decision: d })
      expect(authorizes(d, SESSION, 2)).toBe(reason === 'verified_owner')
      expect(verifiedOwner(d)).toBe(reason === 'verified_owner')
    })
  }

  it('reads no decision from a wrong shape: unknown reason, missing fields, a segment below 1', () => {
    const good = decision('verified_owner')
    expect(parseDecision(good)).toEqual(good)
    expect(parseDecision({ ...good, reason: 'owner' })).toBeNull()
    expect(parseDecision({ ...good, verdict: 'boss' })).toBeNull()
    expect(parseDecision({ ...good, segmentId: 0 })).toBeNull()
    expect(parseDecision({ ...good, segmentId: 1.5 })).toBeNull()
    expect(parseDecision({ ...good, sessionId: 7 })).toBeNull()
    expect(parseDecision({ ...good, timings: {} })).toBeNull()
    expect(parseDecision(null)).toBeNull()
    // A final with a broken decision is a final without one (and so never authorized).
    expect(parseAsrMessage(JSON.stringify({ type: 'final', text: 'saada', speaker: 'owner', segment: 1, decision: { reason: 'verified_owner' } }))).toEqual({ type: 'final', text: 'saada', speaker: 'owner' })
    expect(parseAsrMessage(JSON.stringify({ type: 'rejected', decision: { reason: 'rejected_other' } }))).toBeNull()
    expect(parseAsrMessage(JSON.stringify({ type: 'speakerSession', ...SESSION }))).toEqual({ type: 'speakerSession', ...SESSION })
    expect(parseAsrMessage(JSON.stringify({ type: 'activity', text: 'leaked' }))).toEqual({ type: 'activity' })
  })

  it('authorizes denies missing, unannounced, other-session, other-profile, stale and inconsistent decisions', () => {
    const d = decision('verified_owner')
    expect(authorizes(d, SESSION, 2)).toBe(true)
    expect(authorizes(undefined, SESSION, 0)).toBe(false)
    expect(authorizes(d, null, 0)).toBe(false)
    expect(authorizes(d, { ...SESSION, sessionId: 'session-0' }, 0)).toBe(false)
    expect(authorizes(d, { ...SESSION, profileVersion: 'v1-old' }, 0)).toBe(false)
    expect(authorizes(d, { sessionId: '', profileVersion: '' }, 0)).toBe(false)
    expect(authorizes({ ...d, sessionId: '', profileVersion: '' }, { sessionId: '', profileVersion: '' }, 0)).toBe(false)
    expect(authorizes(d, SESSION, 3)).toBe(false)
    expect(authorizes(d, SESSION, 4)).toBe(false)
    expect(authorizes({ ...d, verdict: 'unknown' }, SESSION, 0)).toBe(false)
    expect(authorizes({ ...d, reason: 'insufficient_audio' }, SESSION, 0)).toBe(false)
  })
})
