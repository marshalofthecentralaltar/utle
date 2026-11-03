// What every part of the page script shares: the results, sleep, and whether the page is leaving.

import type { BoxState, BrowserResult, PageContext } from '../../../src/browser/protocol.ts'

export type PageResult = BrowserResult | { ok: true; href: string; settled?: boolean }

export const ok = (extra: { box?: BoxState; hints?: number; page?: PageContext } = {}): BrowserResult => ({ ok: true, ...extra })
export const fail = (code: 'not_found' | 'failed', message: string): BrowserResult => ({ ok: false, code, message })
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** True once the page has started leaving (the answer may then never arrive; background.ts waits for the load). */
export let leaving = false

/** The page starts leaving (beforeunload, page.ts): the one writer of leaving, which lives here. */
export function markLeaving(): void {
  leaving = true
}
