// The engine's helpers that read no engine state (docs/ARCHITECTURE.md 21.2).

import { hasConnective } from '../../../src/core/chain.ts'
import type { IntentAnswer, IntentRequest, ModelIntent } from '../../../src/core/pageIntent.ts'
import type { SpendOutcome } from '../../../src/core/spend.ts'
import { CAREFUL_WORDS, GOAL_CHARS, MAX_PLAN_GOALS, SETTLE_MS, askTimeoutMs } from './constants.ts'
import type { AskFailure, Care, EngineDeps, Job } from './types.ts'

export const wordCount = (utterance: string): number => utterance.trim().split(/\s+/).filter((w) => w !== '').length
/** Lower case, letters and digits only: for telling one goal from another however the model spelt it. */
export const sameGoal = (a: string, b: string): boolean => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** Goals as the chain carries them: each clipped to the schema's length, at most MAX_PLAN_GOALS, the newest kept. */
export const clipGoals = (goals: readonly string[]): string[] => goals.map((g) => g.slice(0, GOAL_CHARS)).slice(-MAX_PLAN_GOALS)

/** Round 9 (30.5.4): how a task ended, for its spend record. */
export const outcomeOf = (job: Job): SpendOutcome => {
  if (job.timedOut) return 'tookTooLong'
  if (job.cancelled || job.dropped) return 'cancelled'
  if (job.spend.asks === 0) return 'rules'
  return job.ending ?? 'stopped'
}

/** Round 5: how hard the model should think about this job's ask. */
export const careOf = (job: Job): Care => (job.chain !== null || wordCount(job.utterance) >= CAREFUL_WORDS || hasConnective(job.utterance) ? 'careful' : 'quick')

/** One question to the model, given up after askTimeoutMs or when the engine aborts it. Never rejects. */
export const askWithTimeout = (ask: EngineDeps['ask'], request: IntentRequest, controller: AbortController): Promise<IntentAnswer | AskFailure> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller.abort()
      resolve({ error: 'unreachable' })
    }, askTimeoutMs(request.care))
    // The engine's own abort answers at once; the fetch ends on its own.
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve({ error: 'aborted' })
    })
    ask(request, controller.signal).then(
      (answer) => {
        clearTimeout(timer)
        resolve(answer)
      },
      () => {
        clearTimeout(timer)
        resolve({ error: 'unreachable' })
      },
    )
  })

/** The model's plan as a clean list: strings only, trimmed, no empties, clipped to the schema's limits. */
export const planFrom = (answer: IntentAnswer): string[] =>
  (Array.isArray(answer.plan) ? answer.plan : [])
    .filter((goal): goal is string => typeof goal === 'string')
    .map((goal) => goal.trim().slice(0, GOAL_CHARS))
    .filter((goal) => goal !== '')
    .slice(0, MAX_PLAN_GOALS)

/** The step for the model, e.g. "command goTo", "command clickItem 12", "edit undo", "send". */
export const kindSummary = (intent: ModelIntent): string => {
  switch (intent.kind) {
    case 'command': {
      const c = intent.command
      const withId = c.kind === 'clickItem' || c.kind === 'focusItem' || c.kind === 'hover' || c.kind === 'contextMenu' || c.kind === 'scrollTo'
      const detail = withId ? ` ${c.id}` : c.kind === 'clickHint' ? ` ${c.number}` : ''
      return `command ${c.kind}${detail}`
    }
    case 'edit':
      return `edit ${intent.edit.kind}`
    default:
      return intent.kind
  }
}

export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
