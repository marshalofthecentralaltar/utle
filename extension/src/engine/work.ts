// Round 5: the jobs at work, the thinking dots, the busy seconds and the watchdog (docs/ARCHITECTURE.md 21.3).

import { chainLine } from '../../../src/core/chain.ts'
import { RECENT_COMMANDS, recentFrom } from '../../../src/core/meant.ts'
import type { IntentChain } from '../../../src/core/pageIntent.ts'
import { BUSY_FROM_S, JOB_WATCHDOG_MS } from './constants.ts'
import { outcomeOf } from './helpers.ts'
import type { EngineParts, Job } from './types.ts'

export type Work = ReturnType<typeof createWork>

export function createWork({ deps, st, say, inpageText, onWorkChange }: Pick<EngineParts, 'deps' | 'st' | 'say' | 'inpageText' | 'onWorkChange'>) {
  /** Every job not finished: the one in its turn of the queue, those waiting for it, the verifications. */
  const jobs = new Set<Job>()
  /** The verifications in flight (round 3): a send waits for all of them before it sends. */
  const pending = new Set<Promise<void>>()
  /** Of those, the ones running page commands: the next utterance waits for them so commands do not interleave. */
  const acting = new Set<Promise<void>>()
  /** How many questions to the model are in flight; thinking is shown while any is. */
  let thinkingCount = 0
  let thinkingShown = false

  const showThinking = (): void => {
    const now = thinkingCount > 0
    if (now === thinkingShown) return
    thinkingShown = now
    deps.publish({ thinking: now })
  }

  /** Round 5: clamped at 0, so a reset while questions are in flight never leaves the dots on. */
  const think = (on: boolean): void => {
    thinkingCount = Math.max(0, thinkingCount + (on ? 1 : -1))
    showThinking()
  }

  /** Round 5: a cancel or a watchdog clears the dots whatever is in flight; the jobs' own decrements then clamp at 0. */
  const resetThinking = (): void => {
    thinkingCount = 0
    showThinking()
  }

  // ---- Round 5: busy seconds. While any job works, the strip shows the elapsed seconds from BUSY_FROM_S on. ----
  let busyShown = 0
  let busyTimer: ReturnType<typeof setInterval> | null = null
  const publishBusy = (seconds: number): void => {
    if (seconds === busyShown) return
    busyShown = seconds
    deps.publish({ busySeconds: seconds })
  }
  const busyTick = (): void => {
    const now = Date.now()
    let longest = 0
    for (const job of jobs) if (job.started !== null) longest = Math.max(longest, now - job.started)
    const seconds = Math.floor(longest / 1000)
    publishBusy(seconds >= BUSY_FROM_S ? seconds : 0)
  }
  const anyWorking = (): boolean => [...jobs].some((job) => job.started !== null)
  const busyCheck = (): void => {
    if (anyWorking()) {
      if (busyTimer === null) busyTimer = setInterval(busyTick, 1000)
    } else {
      if (busyTimer !== null) clearInterval(busyTimer)
      busyTimer = null
      publishBusy(0)
    }
    onWorkChange()
  }
  // ---- end of busy seconds ----

  const newJob = (utterance: string, send: boolean): Job => {
    const job: Job = { utterance, arrived: Date.now(), send, interrupted: false, cancelled: false, controller: null, looping: false, verifying: false, acting: false, chain: null, continued: false, started: null, watchdog: null, dropped: false, spend: { asks: 0, input: 0, output: 0, cacheRead: 0, ms: 0, provider: '', model: '', steps: 0, goals: 1 }, ending: null, timedOut: false, handedOff: false, ran: [], ok: true }
    jobs.add(job)
    return job
  }

  /** Round 4: the strip's chain line while a chain runs, '' once it is over. Published on change only. */
  let chainShown = ''
  const showChain = (chain: IntentChain | null): void => {
    const line = chain === null ? '' : chainLine(chain)
    if (line === chainShown) return
    chainShown = line
    deps.publish({ chain: line })
  }

  // ---- Round 5: the watchdog. A job that works JOB_WATCHDOG_MS without finishing its goal is given up. ----
  const unwatch = (job: Job): void => {
    if (job.watchdog !== null) clearTimeout(job.watchdog)
    job.watchdog = null
  }
  /** Gives the job up as a barge-in would: the question in flight, the loop and the chain end; the page command in hand finishes. */
  const giveUp = (job: Job): void => {
    job.interrupted = true
    job.cancelled = true
    job.controller?.abort()
    job.started = null
    unwatch(job)
  }
  const tookTooLong = (job: Job): void => {
    if (!jobs.has(job) || job.cancelled) return
    job.timedOut = true
    job.dropped = true
    giveUp(job)
    if (job.chain !== null) showChain(null)
    resetThinking()
    busyCheck()
    say(inpageText.tookTooLong)
  }
  /** (Re)starts the job's watchdog: at its turn, and at every goal of its chain. */
  const watch = (job: Job): void => {
    unwatch(job)
    job.watchdog = setTimeout(() => tookTooLong(job), JOB_WATCHDOG_MS)
  }
  /** The job begins working: it is counted as busy and watched. */
  const beginWork = (job: Job): void => {
    job.started = Date.now()
    watch(job)
    busyCheck()
  }
  /** Round 9 (30.5.4): one record per task, at its end; none for a job a verification took over. */
  const reportSpend = (job: Job): void => {
    if (job.handedOff || !deps.spend) return
    const { asks, steps, goals, input, cacheRead, output, ms, provider, model } = job.spend
    deps.spend({ outcome: outcomeOf(job), asks, steps, goals, input, cacheRead, output, ms, provider, model })
  }
  /** Round 10 (#5, 34.2): the job's command joins the recent ones the model hears; a type-first job's verification reports instead. */
  const remember = (job: Job): void => {
    if (job.handedOff || job.ran.length === 0) return
    st.recent = [...st.recent, recentFrom(job.utterance, job.ran, job.ok && job.ending !== 'unclear', job.from)].slice(-RECENT_COMMANDS)
  }
  /** The job is over, however it ended. */
  const endWork = (job: Job): void => {
    unwatch(job)
    job.started = null
    if (jobs.delete(job)) {
      reportSpend(job)
      remember(job)
    }
    busyCheck()
  }
  // ---- end of the watchdog ----
  return { jobs, pending, acting, think, resetThinking, busyCheck, newJob, showChain, giveUp, watch, beginWork, endWork }
}
