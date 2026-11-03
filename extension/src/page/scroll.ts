// scroll: the page or the scrollable under the view, by a screen, a little, or slowly.

import type { BrowserResult, ScrollMode } from '../../../src/browser/protocol.ts'
import { fail, ok, sleep } from './common.ts'
import { area } from './items.ts'

/** The scrollable containers under the middle of the screen, largest first, then the document. */
function scrollables(): Element[] {
  const found: Element[] = []
  let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
  while (el && el !== document.body && el !== document.documentElement) {
    const s = getComputedStyle(el)
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowY === 'overlay') && el.scrollHeight > el.clientHeight + 4) found.push(el)
    el = el.parentElement
  }
  found.sort((a, b) => area(b.getBoundingClientRect()) - area(a.getBoundingClientRect()))
  found.push(document.scrollingElement ?? document.documentElement)
  return found
}

// Round 3 (docs/ARCHITECTURE.md 23.2): a page, a little, slowly, and stop.
/** A page scroll moves this share of the view, a little scroll this. */
const PAGE_SCROLL_SHARE = 0.8
const LITTLE_SCROLL_SHARE = 1 / 3
/** A smooth scroll gets this long to settle before the command answers. */
const SCROLL_SETTLE_MAX_MS = 600
/** The settle check looks this often; two unchanged looks after a move count as settled. */
const SCROLL_SETTLE_POLL_MS = 50
/** A slow scroll moves at this speed until it is stopped. */
const SLOW_SCROLL_PX_PER_S = 90

/** The slow scroll under way: its container and its next animation frame. Null when nothing moves. */
let slowScroll: { el: Element; frame: number } | null = null

/** Ends the slow scroll, if one is under way. Every other scroll, a stop and a navigation call it. */
export function stopSlowScroll(): void {
  if (slowScroll === null) return
  cancelAnimationFrame(slowScroll.frame)
  slowScroll = null
}

function canScroll(el: Element, direction: string): boolean {
  if (direction === 'up' || direction === 'top') return el.scrollTop > 0
  return el.scrollTop < el.scrollHeight - el.clientHeight - 1
}

function nothingScrolled(direction: string): BrowserResult {
  return fail('failed', direction === 'down' || direction === 'bottom' ? 'Nothing scrolled: the page is already at the end, or it does not scroll.' : 'Nothing scrolled: the page is already at the top.')
}

/**
 * Starts a steady scroll on the first container that can move. It ends on stop, on another scroll,
 * on a navigation, at the end of the container, or (round 10, 33.4) once seconds have passed.
 */
function startSlowScroll(direction: 'up' | 'down', seconds?: number): BrowserResult {
  const el = scrollables().find((e) => canScroll(e, direction))
  if (el === undefined) return nothingScrolled(direction)
  const sign = direction === 'down' ? 1 : -1
  let last = performance.now()
  const until = seconds === undefined ? Infinity : last + seconds * 1000
  let owed = 0
  const step = (now: number): void => {
    if (slowScroll === null || slowScroll.el !== el) return
    if (now >= until) {
      slowScroll = null
      return
    }
    owed += ((now - last) / 1000) * SLOW_SCROLL_PX_PER_S
    last = now
    const whole = Math.floor(owed)
    if (whole > 0) {
      owed -= whole
      const before = el.scrollTop
      el.scrollBy({ top: sign * whole, behavior: 'instant' })
      if (el.scrollTop === before) {
        slowScroll = null
        return
      }
    }
    slowScroll.frame = requestAnimationFrame(step)
  }
  slowScroll = { el, frame: requestAnimationFrame(step) }
  return ok()
}

/** Waits for a smooth scroll of el to settle: unchanged for two looks after it moved, or the cap. True when it moved. */
async function scrollSettled(el: Element, before: number): Promise<boolean> {
  const started = performance.now()
  let last = el.scrollTop
  let still = 0
  while (performance.now() - started < SCROLL_SETTLE_MAX_MS) {
    await sleep(SCROLL_SETTLE_POLL_MS)
    const now = el.scrollTop
    if (now === last && now !== before) {
      if (++still >= 2) break
    } else {
      still = 0
      last = now
    }
  }
  return el.scrollTop !== before
}

/**
 * Scrolls the first container that can move; failed when none can, so the model can try something
 * else. page (the default) and little scroll smoothly and answer once the scroll has settled; slow
 * starts a steady scroll and answers at once; stop ends it (ok even when nothing was moving).
 */
export async function scroll(direction: string, mode: ScrollMode = 'page', seconds?: number): Promise<BrowserResult> {
  stopSlowScroll()
  if (mode === 'stop') return ok()
  if (!['down', 'up', 'top', 'bottom'].includes(direction)) return fail('failed', `Unknown scroll direction "${direction}".`)
  if (mode === 'slow' && (direction === 'up' || direction === 'down')) return startSlowScroll(direction, seconds !== undefined && seconds > 0 ? seconds : undefined)
  const share = mode === 'little' ? LITTLE_SCROLL_SHARE : PAGE_SCROLL_SHARE
  for (const el of scrollables()) {
    if (!canScroll(el, direction)) continue
    const before = el.scrollTop
    const amount = Math.round((el.clientHeight || window.innerHeight) * share)
    if (direction === 'down') el.scrollBy({ top: amount, behavior: 'smooth' })
    else if (direction === 'up') el.scrollBy({ top: -amount, behavior: 'smooth' })
    else if (direction === 'top') el.scrollTo({ top: 0, behavior: 'instant' })
    else el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
    const moved = direction === 'top' || direction === 'bottom' ? el.scrollTop !== before : await scrollSettled(el, before)
    if (moved) return ok()
  }
  return nothingScrolled(direction)
}
