import { describe, expect, it } from 'vitest'
import { guardPatch, guardStore, onlyOwnerEffective, onlyOwnerWantedFrom, readinessFrom } from './guard.ts'

// Round 11 (F1, ARCHITECTURE 31.7 "Welcome and settings"): only-my-voice is never left on with no
// voice to judge against. The demo of 2026-11-03: 2.5 minutes of profile_missing, nothing ran.
describe('guard: only-my-voice, wanted and effective', () => {
  it('onlyOwner is on only when wanted and a voice taught for this model exists', () => {
    expect(onlyOwnerEffective(true, 'ready')).toBe(true)
    expect(onlyOwnerEffective(true, 'no_profile')).toBe(false)
    expect(onlyOwnerEffective(true, 'needs_retraining')).toBe(false)
    expect(onlyOwnerEffective(true, 'model_mismatch')).toBe(false)
    // Unknown (no server answer yet, the welcome without a voice test): off; the wish is kept.
    expect(onlyOwnerEffective(true, undefined)).toBe(false)
    // A voice exists but the speaker model is down: fail closed (the bar says nobody is obeyed).
    expect(onlyOwnerEffective(true, 'model_unavailable')).toBe(true)
    for (const r of ['ready', 'no_profile', 'needs_retraining', 'model_mismatch', 'model_unavailable', undefined] as const) expect(onlyOwnerEffective(false, r)).toBe(false)
  })

  it('guardStore keeps the wish (onlyOwnerWanted) and stores the effective mode as onlyOwner', () => {
    expect(guardStore(true, 'no_profile')).toEqual({ onlyOwnerWanted: true, onlyOwner: false })
    expect(guardStore(true, 'ready')).toEqual({ onlyOwnerWanted: true, onlyOwner: true })
    expect(guardStore(false, 'ready')).toEqual({ onlyOwnerWanted: false, onlyOwner: false })
  })

  it('onlyOwnerWantedFrom: the stored wish, or, from before round 11, the stored onlyOwner', () => {
    expect(onlyOwnerWantedFrom({ onlyOwnerWanted: true, onlyOwner: false })).toBe(true)
    expect(onlyOwnerWantedFrom({ onlyOwnerWanted: false, onlyOwner: true })).toBe(false)
    expect(onlyOwnerWantedFrom({ onlyOwner: true })).toBe(true)
    expect(onlyOwnerWantedFrom({})).toBe(false)
  })

  it('guardPatch: the startup never keeps the mode on with no_profile, and puts it back once ready', () => {
    // The demo: onlyOwner stored from an earlier run, no voice on the server.
    expect(guardPatch({ onlyOwner: true }, 'no_profile')).toEqual({ onlyOwnerWanted: true, onlyOwner: false })
    expect(guardPatch({ onlyOwnerWanted: true, onlyOwner: false }, 'no_profile')).toBeNull()
    expect(guardPatch({ onlyOwnerWanted: true, onlyOwner: false }, 'ready')).toEqual({ onlyOwnerWanted: true, onlyOwner: true })
    expect(guardPatch({ onlyOwnerWanted: true, onlyOwner: true }, 'ready')).toBeNull()
    expect(guardPatch({ onlyOwnerWanted: true, onlyOwner: true }, 'model_mismatch')).toEqual({ onlyOwnerWanted: true, onlyOwner: false })
    expect(guardPatch({ onlyOwnerWanted: false, onlyOwner: false }, 'ready')).toBeNull()
    expect(guardPatch({}, 'no_profile')).toEqual({ onlyOwnerWanted: false, onlyOwner: false })
  })

  it('readinessFrom reads the strip state\'s voiceReady; anything else is unknown', () => {
    expect(readinessFrom('ready')).toBe('ready')
    expect(readinessFrom('no_profile')).toBe('no_profile')
    expect(readinessFrom('')).toBeUndefined()
    expect(readinessFrom('protected')).toBeUndefined()
    expect(readinessFrom(undefined)).toBeUndefined()
  })
})
