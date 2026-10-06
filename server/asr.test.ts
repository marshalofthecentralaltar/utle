import { describe, expect, it } from 'vitest'
import { MAX_ENROL_SECONDS, parseClientFrame, speakerLine, wantsSoniox } from './asr.ts'

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

describe('the log line about the speaker gate', () => {
  it('says what the server has, never whose voice', () => {
    expect(speakerLine({ model: true, profile: true })).toBe("[asr] speaker model loaded; owner's voice learnt")
    expect(speakerLine({ model: false, profile: false })).toContain('no speaker model')
    expect(speakerLine({ model: false, profile: false })).toContain('not learnt yet')
  })
})

describe('the engine on the socket address', () => {
  it('routes ?engine=soniox and UTLE_ASR=soniox to Soniox', () => {
    expect(wantsSoniox('/api/asr', {})).toBe(false)
    expect(wantsSoniox('/api/asr?engine=soniox', {})).toBe(true)
    expect(wantsSoniox('/api/asr', { UTLE_ASR: 'soniox' })).toBe(true)
  })
})
