// The number labels over the actionable elements (showHints, hideHints).

import type { BrowserResult } from '../../../src/browser/protocol.ts'
import type { Site } from '../sites.ts'
import { ok } from './common.ts'
import type { Box } from './items.ts'
import { collect } from './items.ts'

export let hintLayer: HTMLElement | null = null
/** The visible elements of the last showHints, by number (1-based). */
export let hinted: HTMLElement[] = []

export function hideHints(): void {
  hintLayer?.remove()
  hintLayer = null
  hinted = []
}

export function showHints(site: Site | null): BrowserResult {
  hideHints()
  const elements = collect(site).visible.map((c) => c.el)
  const host = document.createElement('utle-hints')
  host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    .n { position: absolute; font: bold 15px/1 system-ui, sans-serif; color: #000; background: #ffd400;
         border: 2px solid #000; border-radius: 4px; padding: 2px 5px; box-shadow: 0 1px 3px rgba(0,0,0,.5);
         white-space: nowrap; pointer-events: none; }`
  root.append(style)
  const labels = elements.map((_el, i) => {
    const label = document.createElement('span')
    label.className = 'n'
    label.textContent = String(i + 1)
    root.append(label)
    return label
  })
  document.documentElement.append(host)
  placeLabels(labels, elements)
  hintLayer = host
  hinted = elements
  return ok({ hints: elements.length })
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

// Each label goes outside its element so it never hides the element's text. Spots in order:
// left, above, right, below. The first one that stays in the viewport and covers nothing wins;
// if every spot covers something, the one covering least. Only when no outside spot fits in the
// viewport does the label sit on the element's corner.
function placeLabels(labels: HTMLElement[], elements: HTMLElement[]): void {
  const rects = elements.map((el) => el.getBoundingClientRect())
  const taken: Box[] = []
  elements.forEach((_el, i) => {
    const label = labels[i]
    const r = rects[i]
    if (!label || !r) return
    const w = label.offsetWidth
    const h = label.offsetHeight
    const gap = 2
    const spots: Box[] = [
      [r.left - w - gap, r.top + Math.max((r.height - h) / 2, 0)],
      [r.left, r.top - h - gap],
      [r.right + gap, r.top + Math.max((r.height - h) / 2, 0)],
      [r.left, r.bottom + gap],
    ].map(([x = 0, y = 0]) => ({ left: x, top: y, right: x + w, bottom: y + h }))
    const area = (a: Box, b: Box): number =>
      overlaps(a, b) ? (Math.min(a.right, b.right) - Math.max(a.left, b.left)) * (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0
    // Cost of a spot: how much it covers other elements and labels. Never its own element.
    const cost = (b: Box): number => {
      if (b.left < 0 || b.top < 0 || b.right > window.innerWidth || b.bottom > window.innerHeight || overlaps(b, r)) return Infinity
      return rects.reduce((sum, o) => sum + area(b, o), 0) + taken.reduce((sum, o) => sum + area(b, o) * 4, 0)
    }
    const costs = spots.map(cost)
    const best = costs.indexOf(Math.min(...costs))
    const chosen = spots[best]
    const spot: Box =
      chosen !== undefined && (costs[best] ?? Infinity) < Infinity
        ? chosen
        : { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.max(r.left, 0) + w, bottom: Math.max(r.top, 0) + h }
    taken.push(spot)
    label.style.left = `${spot.left + window.scrollX}px`
    label.style.top = `${spot.top + window.scrollY}px`
  })
}
