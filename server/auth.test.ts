import { describe, expect, it } from 'vitest'
import { authState, expectedToken, httpAuthorized, sameToken, upgradeAuthorized } from './auth.ts'

const req = (url: string, authorization?: string) => ({ url, headers: authorization === undefined ? {} : { authorization } })

describe('the server token (27.2)', () => {
  it('reads UTLE_TOKEN, and treats an empty or blank one as unset', () => {
    expect(expectedToken({ UTLE_TOKEN: 't1' })).toBe('t1')
    expect(expectedToken({ UTLE_TOKEN: '  t1 ' })).toBe('t1')
    expect(expectedToken({ UTLE_TOKEN: '' })).toBeUndefined()
    expect(expectedToken({ UTLE_TOKEN: '   ' })).toBeUndefined()
    expect(expectedToken({})).toBeUndefined()
  })

  it('says on or off for the status', () => {
    expect(authState('t1')).toBe('on')
    expect(authState(undefined)).toBe('off')
  })

  it('is open when no token is set', () => {
    expect(httpAuthorized(req('/api/status'), undefined)).toBe(true)
    expect(upgradeAuthorized(req('/api/asr'), undefined)).toBe(true)
  })

  it('takes the bearer header on http, and nothing else', () => {
    expect(httpAuthorized(req('/api/status', 'Bearer t1'), 't1')).toBe(true)
    expect(httpAuthorized(req('/api/status', 'bearer t1'), 't1')).toBe(true)
    expect(httpAuthorized(req('/api/status'), 't1')).toBe(false)
    expect(httpAuthorized(req('/api/status', 'Bearer t2'), 't1')).toBe(false)
    expect(httpAuthorized(req('/api/status', 't1'), 't1')).toBe(false)
    expect(httpAuthorized(req('/api/status', 'Bearer '), 't1')).toBe(false)
    expect(httpAuthorized(req('/api/status', 'Basic dDE='), 't1')).toBe(false)
    // The query is the websocket's way only: an http address with the token in it is refused.
    expect(httpAuthorized(req('/api/status?token=t1'), 't1')).toBe(false)
  })

  it('takes ?token= or the header on the websocket upgrade', () => {
    expect(upgradeAuthorized(req('/api/asr?token=t1'), 't1')).toBe(true)
    expect(upgradeAuthorized(req('/api/asr?engine=soniox&token=t1'), 't1')).toBe(true)
    expect(upgradeAuthorized(req('/api/asr?token=a%2Bb'), 'a+b')).toBe(true)
    expect(upgradeAuthorized(req('/api/asr', 'Bearer t1'), 't1')).toBe(true)
    expect(upgradeAuthorized(req('/api/asr'), 't1')).toBe(false)
    expect(upgradeAuthorized(req('/api/asr?token='), 't1')).toBe(false)
    expect(upgradeAuthorized(req('/api/asr?token=t2'), 't1')).toBe(false)
  })

  it('compares tokens of any length without throwing', () => {
    expect(sameToken('t1', 't1')).toBe(true)
    expect(sameToken('t1', 't12')).toBe(false)
    expect(sameToken('', 't1')).toBe(false)
    expect(sameToken('õ', 'õ')).toBe(true)
  })
})
