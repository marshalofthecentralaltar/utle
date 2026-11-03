/**
 * Round 11 (F1, docs/ARCHITECTURE.md 31.7 "Welcome and settings"): whether only-my-voice is on.
 * He chooses it (the wish, `onlyOwnerWanted` in chrome.storage.local); it is in force (`onlyOwner`,
 * what the offscreen document is made with) only while a voice taught for this speaker model
 * exists. With no voice the gate drops every utterance as profile_missing and nothing he says can
 * reach the settings, so a first run that chose "Lülita sisse" without a voice would lock him out
 * (the demo of 2026-11-03: 2.5 minutes, 19 drops). Pure: no storage, no DOM.
 */

/** The speaker gate's readiness (the same names as src/speech/asrProtocol.ts ReadinessState; core imports nothing from speech). */
export type GuardReadiness = 'ready' | 'no_profile' | 'needs_retraining' | 'model_unavailable' | 'model_mismatch'
const READINESS: readonly GuardReadiness[] = ['ready', 'no_profile', 'needs_retraining', 'model_unavailable', 'model_mismatch']

/** The two chrome.storage.local keys. */
export interface GuardStore {
  /** What he chose: "Lülita sisse" / "Kuula ainult mind". */
  onlyOwnerWanted: boolean
  /** In force: the offscreen document is made with &onlyOwner=1. */
  onlyOwner: boolean
}

/**
 * In force when he wants it and a voice exists to judge against: `ready`, or `model_unavailable`
 * (a voice exists but the speaker model is down: fail closed, and the bar says nobody is obeyed).
 * No voice (`no_profile`), an old-format voice (`needs_retraining`), a voice of another model
 * (`model_mismatch`) or an unknown readiness: off, and the wish is kept.
 */
export function onlyOwnerEffective(wanted: boolean, readiness: GuardReadiness | undefined): boolean {
  return wanted && (readiness === 'ready' || readiness === 'model_unavailable')
}

/** What to store for a wish and a readiness. */
export function guardStore(wanted: boolean, readiness: GuardReadiness | undefined): GuardStore {
  return { onlyOwnerWanted: wanted, onlyOwner: onlyOwnerEffective(wanted, readiness) }
}

/** The stored wish; before round 11 there was only `onlyOwner`, which was the wish. */
export function onlyOwnerWantedFrom(stored: { onlyOwnerWanted?: unknown; onlyOwner?: unknown }): boolean {
  if (typeof stored.onlyOwnerWanted === 'boolean') return stored.onlyOwnerWanted
  return stored.onlyOwner === true
}

/**
 * The service worker's step when the offscreen document reports a readiness: what to store, or
 * null when storage already says it. A wish from before round 11 (only `onlyOwner`) is written out.
 */
export function guardPatch(stored: { onlyOwnerWanted?: unknown; onlyOwner?: unknown }, readiness: GuardReadiness): GuardStore | null {
  const next = guardStore(onlyOwnerWantedFrom(stored), readiness)
  return next.onlyOwner === (stored.onlyOwner === true) && next.onlyOwnerWanted === stored.onlyOwnerWanted ? null : next
}

/** The strip state's `voiceReady` as a readiness, or undefined (not reported yet). */
export function readinessFrom(value: unknown): GuardReadiness | undefined {
  return READINESS.find((r) => r === value)
}
