/**
 * Round 9 (ARCHITECTURE 30.5.5): list prices per model id, USD per million tokens, for the evals'
 * dollar figures. Moved out of scripts/flow-eval.ts.
 *
 * Anthropic: the claude-api skill's table (cached 2026-10-06). Cache reads as listed (Sonnet 5.5 and
 * Opus 5.5 $0.20, Fable 5.1 $0.25), else 0.1 x input; cache writes (5-minute) 1.25 x input.
 * DeepSeek V4.1-Flash: the round 9 plan, section 1 (2026-10-25, from web snippets): $0.15 in, $0.003
 * cache hit, $0.60 out off-peak, double at peak. The peak hours, weekdays 01:00 to 04:00 and 06:00 to
 * 10:00 UTC, are UNVERIFIED: read them off DeepSeek's pricing page before trusting a DeepSeek figure.
 * DeepSeek caches by prefix with no write charge.
 */

import type { ModelUsage } from '../server/model/types.ts'

export interface Price {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const anthropic = (input: number, output: number, cacheRead = input / 10): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25 })

export const PRICES: Readonly<Record<string, Price>> = {
  'claude-fable-5-1': anthropic(10, 50, 0.25),
  'claude-opus-5-5': anthropic(4, 20, 0.2),
  'claude-sonnet-5-5': anthropic(2, 10, 0.2),
  'claude-haiku-5-5': anthropic(0.1, 0.5),
  'claude-haiku-4-5': anthropic(1, 5),
}

const DEEPSEEK_FLASH_OFF_PEAK: Price = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 }
const DEEPSEEK_FLASH_IDS = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4.1-flash'])

/** DeepSeek's peak (UNVERIFIED hours, see above): weekdays 01:00 to 04:00 and 06:00 to 10:00 UTC. */
export function deepseekPeak(at: Date): boolean {
  const day = at.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = at.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

/** The price of a model id at a moment, or null when no price is known. */
export function priceOf(model: string, at: Date = new Date()): Price | null {
  const known = PRICES[model]
  if (known) return known
  if (DEEPSEEK_FLASH_IDS.has(model)) {
    const factor = deepseekPeak(at) ? 2 : 1
    const p = DEEPSEEK_FLASH_OFF_PEAK
    return { input: p.input * factor, output: p.output * factor, cacheRead: p.cacheRead * factor, cacheWrite: 0 }
  }
  return null
}

/** USD for one ask's tokens; NaN when the model has no price. */
export function costOf(model: string, usage: ModelUsage, at: Date = new Date()): number {
  const price = priceOf(model, at)
  if (!price) return Number.NaN
  return (usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite) / 1_000_000
}
