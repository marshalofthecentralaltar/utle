import { describe, expect, it } from 'vitest'
import { LOCAL_USER, authState, expectedToken, httpAuthorized, httpUser, profileId, sameToken, tokenUsers, upgradeAuthorized, upgradeUser } from './auth.ts'

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

describe('profiles per token (round 7): several tokens, each a user', () => {
  it('reads several tokens separated by commas, each optionally name:token', () => {
    const users = tokenUsers({ UTLE_TOKEN: ' ralf:ta , tb,  ,mari:tc ' })
    expect(users.map((u) => [u.name, u.token])).toEqual([
      ['ralf', 'ta'],
      [profileId('tb').slice(0, 6), 'tb'],
      ['mari', 'tc'],
    ])
    expect(tokenUsers({})).toEqual([])
    expect(tokenUsers({ UTLE_TOKEN: '  ' })).toEqual([])
  })

  it('keys each user by the first 16 hex digits of the token\'s SHA-256, never the token', () => {
    expect(profileId('ta')).toMatch(/^[0-9a-f]{16}$/)
    expect(profileId('ta')).not.toBe(profileId('tb'))
    expect(tokenUsers({ UTLE_TOKEN: 'ralf:ta' })[0]?.id).toBe(profileId('ta'))
  })

  it('tells which user a request is, by the header on http and ?token= on the socket', () => {
    const users = tokenUsers({ UTLE_TOKEN: 'ralf:ta,mari:tb' })
    expect(httpUser(req('/api/status', 'Bearer ta'), users)?.name).toBe('ralf')
    expect(httpUser(req('/api/status', 'Bearer tb'), users)?.name).toBe('mari')
    expect(httpUser(req('/api/status', 'Bearer tc'), users)).toBeNull()
    expect(httpUser(req('/api/status?token=ta'), users)).toBeNull()
    expect(upgradeUser(req('/api/asr?token=tb'), users)?.name).toBe('mari')
    expect(upgradeUser(req('/api/asr'), users)).toBeNull()
  })

  it('is the local user (today\'s owner.json) when no token is set', () => {
    expect(httpUser(req('/api/status'), [])).toBe(LOCAL_USER)
    expect(upgradeUser(req('/api/asr'), [])).toBe(LOCAL_USER)
    expect(LOCAL_USER.id).toBe('')
  })

  it('keeps the single-token checks working with a list in UTLE_TOKEN', () => {
    const env = { UTLE_TOKEN: 'ralf:ta,tb' }
    expect(httpAuthorized(req('/api/status', 'Bearer tb'), tokenUsers(env))).toBe(true)
    expect(upgradeAuthorized(req('/api/asr?token=ta'), tokenUsers(env))).toBe(true)
    expect(upgradeAuthorized(req('/api/asr?token=ralf:ta'), tokenUsers(env))).toBe(false)
  })
})
