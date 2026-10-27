// Round 9 (ARCHITECTURE 30.5.4): the service worker's side of the spend records. The offscreen
// engine cannot reach chrome.storage, so it sends each task's record here; this keeps the last
// SPEND_RING under SPEND_KEY in chrome.storage.local. Counts and names only, never words.

import { SPEND_KEY, spendRingWith } from '../../src/core/spend.ts'
import type { SpendRecord } from '../../src/core/spend.ts'

export type SpendMessage = { type: 'utle-spend'; record: SpendRecord }

/** One write at a time, so two records arriving together both land. */
let queue: Promise<void> = Promise.resolve()

export function keepSpend(record: SpendRecord): Promise<void> {
  queue = queue
    .then(async () => {
      const ring = (await chrome.storage.local.get(SPEND_KEY))[SPEND_KEY]
      await chrome.storage.local.set({ [SPEND_KEY]: spendRingWith(ring, record) })
    })
    .catch(() => undefined)
  return queue
}

/** Registered once by the service worker. Only the extension's own pages may send (the offscreen document). */
export function listenForSpend(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false
    if (typeof message !== 'object' || message === null || (message as { type?: unknown }).type !== 'utle-spend') return false
    const { record } = message as SpendMessage
    if (typeof record === 'object' && record !== null) void keepSpend(record)
    return false
  })
}
