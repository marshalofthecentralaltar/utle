import { describe, expect, it } from 'vitest'
import { MAX_ENROL_PHRASES, MAX_ENROL_SECONDS, judgedLine, parseClientFrame, speakerLine, vadLine, wantsSoniox } from './asr.ts'

describe('client text frames (round 4)', () => {
  it('reads flush, enrol and onlyOwner, and nothing else', () => {
    expect(parseClientFrame('{"type":"flush"}')).toEqual({ type: 'flush' })
    expect(parseClientFrame('{"type":"enrol","seconds":8}')).toEqual({ type: 'enrol', seconds: 8 })
    expect(parseClientFrame('{"type":"enrol","seconds":7.6}')).toEqual({ type: 'enrol', seconds: 8 })
    expect(parseClientFrame('{"type":"onlyOwner","on":true}')).toEqual({ type: 'onlyOwner', on: true })
    expect(parseClientFrame('{"type":"onlyOwner","on":false}')).toEqual({ type: 'onlyOwner', on: false })
  })

  it('refuses an enrolment of no, negative or absurd length, and malformed frames', () => {
    expect(parseClientFrame('{"type":"enrol"}')).toBeNull()
    expect(parseClientFrame('{"type":"enrol","seconds":0}')).toBeNull()
    expect(parseClientFrame(`{"type":"enrol","seconds":${MAX_ENROL_SECONDS + 1}}`)).toBeNull()
    expect(parseClientFrame('{"type":"onlyOwner","on":"yes"}')).toBeNull()
    expect(parseClientFrame('{"type":"speaker"}')).toBeNull()
    expect(parseClientFrame('not json')).toBeNull()
    expect(parseClientFrame('42')).toBeNull()
  })
})

describe('client text frames (round 7)', () => {
  it('reads scripted enrolment and its early end', () => {
    expect(parseClientFrame('{"type":"enrolScript","phrases":12}')).toEqual({ type: 'enrolScript', phrases: 12 })
    expect(parseClientFrame('{"type":"enrolFinish"}')).toEqual({ type: 'enrolFinish' })
    expect(parseClientFrame('{"type":"enrolScript","phrases":0}')).toBeNull()
    expect(parseClientFrame(`{"type":"enrolScript","phrases":${MAX_ENROL_PHRASES + 1}}`)).toBeNull()
    expect(parseClientFrame('{"type":"enrolScript"}')).toBeNull()
  })
})

describe('the log line about the speech detector (round 7)', () => {
  it('says whether the model is loaded', () => {
    expect(vadLine(true)).toBe('[asr] vad model loaded')
    expect(vadLine(false)).toBe('[asr] no vad model')
  })
})

describe('the log line about the speaker gate', () => {
  it('says what the server has, never whose voice', () => {
    expect(speakerLine({ model: true, profile: true })).toBe("[asr] speaker model loaded; owner's voice learnt")
    expect(speakerLine({ model: false, profile: false })).toContain('no speaker model')
    expect(speakerLine({ model: false, profile: false })).toContain('not learnt yet')
  })

  it('counts the configured profiles when tokens name users (round 7), the old wording without', () => {
    expect(speakerLine({ model: true, profile: false }, { count: 2, enrolled: 1 })).toBe('[asr] speaker model loaded; 2 profiles, 1 enrolled')
    expect(speakerLine({ model: true, profile: false }, { count: 1, enrolled: 0 })).toBe('[asr] speaker model loaded; 1 profile, 0 enrolled')
    expect(speakerLine({ model: true, profile: false })).toBe("[asr] speaker model loaded; owner's voice not learnt yet")
  })
})

describe("the log line about a final's verdict", () => {
  it('says the verdict and the score, and the reason when continuity decided it (round 7), never the text', () => {
    expect(judgedLine({ speaker: 'owner', score: 0.71, seconds: 1.4 }, true)).toBe('[asr] final judged owner 0.71 (only owner on)')
    expect(judgedLine({ speaker: 'other', score: 0.2 }, false)).toBe('[asr] final judged other 0.2 (only owner off)')
    expect(judgedLine({ speaker: 'owner', score: 0.168, seconds: 0.4, reason: 'continuity' }, true)).toBe('[asr] final judged owner 0.168 continuity (only owner on)')
  })
})

describe('the engine on the socket address', () => {
  it('routes ?engine=soniox and UTLE_ASR=soniox to Soniox', () => {
    expect(wantsSoniox('/api/asr', {})).toBe(false)
    expect(wantsSoniox('/api/asr?engine=soniox', {})).toBe(true)
    expect(wantsSoniox('/api/asr', { UTLE_ASR: 'soniox' })).toBe(true)
  })
})
