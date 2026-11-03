// media: play, pause and seek the page's video.

import type { BrowserResult, MediaAction } from '../../../src/browser/protocol.ts'
import { fail, ok, sleep } from './common.ts'
import { mediaElement } from './items.ts'

/** media on YouTube: how long a keyboard shortcut gets to change the player's state. */
const SHORTCUT_MS = 250

type Check = (el: HTMLMediaElement) => boolean

/** The YouTube shortcut for an action, and how to tell it worked. null: no shortcut (exitFullscreen). */
function shortcutFor(action: MediaAction, el: HTMLMediaElement): { key: string; done: Check } | null {
  const volume = el.volume
  const time = el.currentTime
  switch (action) {
    case 'play':
      return el.paused ? { key: 'k', done: (m) => !m.paused } : { key: '', done: () => true }
    case 'pause':
      return el.paused ? { key: '', done: () => true } : { key: 'k', done: (m) => m.paused }
    case 'toggle':
      return { key: 'k', done: (m) => m.paused !== el.paused }
    case 'mute':
      return el.muted ? { key: '', done: () => true } : { key: 'm', done: (m) => m.muted }
    case 'unmute':
      return el.muted ? { key: 'm', done: (m) => !m.muted } : { key: '', done: () => true }
    case 'volumeUp':
      return { key: 'ArrowUp', done: (m) => !m.muted && (m.volume > volume || volume >= 1) }
    case 'volumeDown':
      return { key: 'ArrowDown', done: (m) => m.volume < volume || volume <= 0 }
    case 'fullscreen':
      return { key: 'f', done: () => document.fullscreenElement !== null }
    case 'exitFullscreen':
      return null
    case 'forward':
      return { key: 'l', done: (m) => m.currentTime > time + 5 || m.ended }
    case 'back':
      return { key: 'j', done: (m) => m.currentTime < time - 5 || time < 10 }
  }
}

/** One key press on the YouTube player, as its keyboard shortcuts expect it. */
function pressPlayerKey(player: HTMLElement, key: string): void {
  const code = key.length === 1 ? `Key${key.toUpperCase()}` : key
  const init = { key, code, bubbles: true, cancelable: true, composed: true }
  player.focus()
  player.dispatchEvent(new KeyboardEvent('keydown', init))
  player.dispatchEvent(new KeyboardEvent('keyup', init))
}

/** On YouTube, the player's own keyboard shortcut; true when the element shows it worked. */
async function youtubeShortcut(player: HTMLElement, el: HTMLMediaElement, action: MediaAction): Promise<boolean> {
  const shortcut = shortcutFor(action, el)
  if (!shortcut) return false
  if (shortcut.key === '') return true
  pressPlayerKey(player, shortcut.key)
  await sleep(SHORTCUT_MS)
  return shortcut.done(el)
}

/** YouTube's l and j move this many seconds each. */
const YOUTUBE_SEEK_STEP = 10

/**
 * Round 8 (29.1): forward or back by an amount. On a plain video or audio element, currentTime
 * moves by seconds, clamped to [0, duration]. On YouTube, whose l/j/arrow shortcuts move a fixed
 * 5 or 10 s, path 1 writes currentTime on the element directly too; when it has not moved toward
 * the target within SHORTCUT_MS (a player that ignores or resets the write), path 2 presses l or j
 * round(seconds / 10) times, at least once, so the amount is rounded to the nearest 10 s.
 */
async function seekBy(el: HTMLMediaElement, player: HTMLElement | null, action: 'forward' | 'back', seconds: number): Promise<BrowserResult> {
  const before = el.currentTime
  const wanted = before + (action === 'back' ? -seconds : seconds)
  const target = Math.max(0, Number.isFinite(el.duration) ? Math.min(el.duration, wanted) : wanted)
  try {
    el.currentTime = target
  } catch (error) {
    if (!player) return fail('failed', `The video did not take "${action}": ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!player) {
    await sleep(60)
    return ok()
  }
  // Path 1 (YouTube): the element took the write when it is now nearer the target than halfway.
  await sleep(SHORTCUT_MS)
  if (Math.abs(el.currentTime - target) <= Math.abs(before - target) / 2) return ok()
  // Path 2 (YouTube): the write was ignored; the player's own 10 s shortcut, repeated.
  const presses = Math.max(1, Math.round(seconds / YOUTUBE_SEEK_STEP))
  for (let i = 0; i < presses; i++) {
    pressPlayerKey(player, action === 'forward' ? 'l' : 'j')
    await sleep(60)
  }
  await sleep(SHORTCUT_MS)
  return ok()
}

export async function media(action: MediaAction, seconds?: number): Promise<BrowserResult> {
  const el = mediaElement()
  if (!el) return fail('not_found', 'There is no video or audio on this page.')
  const player = document.querySelector<HTMLElement>('#movie_player')
  if (seconds !== undefined && (action === 'forward' || action === 'back')) return seekBy(el, player && player.contains(el) ? player : null, action, seconds)
  if (action === 'exitFullscreen') {
    if (document.fullscreenElement) await document.exitFullscreen()
    return ok()
  }
  if (player && player.contains(el) && (await youtubeShortcut(player, el, action))) return ok()
  try {
    switch (action) {
      case 'play':
        await el.play()
        break
      case 'pause':
        el.pause()
        break
      case 'toggle':
        if (el.paused) await el.play()
        else el.pause()
        break
      case 'mute':
        el.muted = true
        break
      case 'unmute':
        el.muted = false
        if (el.volume === 0) el.volume = 0.2
        break
      case 'volumeUp':
        el.volume = Math.min(1, Math.round((el.volume + 0.2) * 10) / 10)
        el.muted = false
        break
      case 'volumeDown':
        el.volume = Math.max(0, Math.round((el.volume - 0.2) * 10) / 10)
        break
      case 'fullscreen':
        await (player ?? el.closest<HTMLElement>('.html5-video-player') ?? el).requestFullscreen()
        break
      case 'forward':
        el.currentTime = Number.isFinite(el.duration) ? Math.min(el.duration, el.currentTime + 10) : el.currentTime + 10
        break
      case 'back':
        el.currentTime = Math.max(0, el.currentTime - 10)
        break
    }
  } catch (error) {
    return fail('failed', `The video did not take "${action}": ${error instanceof Error ? error.message : String(error)}`)
  }
  await sleep(60)
  return ok()
}
