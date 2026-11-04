// Asks and goals (docs/ARCHITECTURE.md 21.3, M7.2, round 4): one question to the model, one step on the page,
// one goal's loop, a chain of goals, and the verification of a type-first dictation.

import type { BoxState, BrowserResult, PageContext } from '../../../src/browser/protocol.ts'
import { readsBack } from '../../../src/core/addressee.ts'
import { firstGoal } from '../../../src/core/chain.ts'
import type { InpageSession, InpageStep } from '../../../src/core/inpage.ts'
import { besideCommands, ranOf } from '../../../src/core/meant.ts'
import { MAX_CHAIN_MS, MAX_CHAIN_STEPS, MAX_INTENT_STEPS } from '../../../src/core/pageIntent.ts'
import type { IntentAnswer, IntentRequest, IntentStep, RecentCommand, TabSummary } from '../../../src/core/pageIntent.ts'
import { placeNouns } from '../../../src/core/places.ts'
import { savedNames } from '../../../src/core/saved.ts'
import { BOX_CHARS, INTENT_LOOP_BUDGET_MS, LONG_COMMAND_WORDS, MAX_PLAN_GOALS, MAX_STEP_FAILURES, TITLE_CHARS, URL_CHARS, UTTERANCE_CHARS } from './constants.ts'
import { askWithTimeout, careOf, clipGoals, kindSummary, planFrom, sameGoal, settle, wordCount } from './helpers.ts'
import type { AskFailure, EngineParts, GoalEnd, Heard, Job, Live, Outcome } from './types.ts'

type GoalsParts = Pick<EngineParts, 'deps' | 'st' | 'inpageText' | 'say' | 'runSafe' | 'readBox' | 'takeBack' | 'setModelOff' | 'speakAloud' | 'scrollRan' | 'placeStep' | 'work'>

// oxlint-disable-next-line max-lines-per-function, complexity -- MACHINES removes this
export function createGoals({ deps, st, inpageText, say, runSafe, readBox, takeBack, setModelOff, speakAloud, scrollRan, placeStep, work }: GoalsParts) {
  const { newJob, beginWork, endWork, watch, think, showChain, pending, acting } = work
  /**
   * The page in front for the model: readPage, or what is known from the box when the page cannot
   * answer. baseText, when given, replaces the box text: the box as it was before the utterance,
   * never with the utterance's own words in it, so the model judges the words themselves.
   */
  const readPage = async (box: BoxState, baseText: string | null): Promise<PageContext> => {
    const read = await runSafe({ kind: 'readPage' })
    const fallback: PageContext = { url: '', title: '', box: baseText === null ? box : { ...box, text: baseText }, items: [], media: null, hints: st.session.hints }
    const page = !read.ok || !read.page ? fallback : baseText === null ? read.page : { ...read.page, box: { ...read.page.box, text: baseText } }
    // Round 6 (26.1): the names of his saved values, never a value.
    const names = savedNames(st.session.saved ?? [])
    // Clipped to IntentRequestSchema's limits: a page beyond them would be a 400, and the model never asked.
    // Round 8 (29.4.2): the nouns of his places, never an address.
    const nouns = placeNouns(st.places)
    return { ...page, url: page.url.slice(0, URL_CHARS), title: page.title.slice(0, TITLE_CHARS), box: { ...page.box, text: page.box.text.slice(0, BOX_CHARS) }, ...(names.length > 0 ? { saved: names } : {}), ...(nouns.length > 0 ? { places: nouns } : {}) }
  }

  /**
   * One question to the model: the page as it is now (with the box as it was before the utterance
   * when baseText is given), the tabs, the lines before this utterance and the steps already taken
   * for it. Null when the model gave no answer (the caller keeps what the rules did), or when the
   * job was cancelled by a later utterance.
   */
  const askOnce = async (job: Job, box: BoxState, baseText: string | null, recentBefore: RecentCommand[], steps: IntentStep[]): Promise<Heard | null> => {
    if (job.cancelled) return null
    // Review R3 M3: the controller is set before the page is read, so a barge-in while the page
    // is read counts this as model work begun and cancels it.
    const controller = new AbortController()
    job.controller = controller
    let answer: IntentAnswer | AskFailure
    let page: PageContext
    let tabs: TabSummary[]
    try {
      page = await readPage(box, baseText)
      tabs = await deps.tabs().catch((): TabSummary[] => [])
      if (job.cancelled) return null
      // Round 4: in a chain the model is asked about the goal in hand, and told the chain.
      const chain = job.chain
      const request: IntentRequest = { lang: deps.lang, utterance: (chain === null ? job.utterance : chain.goal).slice(0, UTTERANCE_CHARS), page, tabs, recent: recentBefore, care: careOf(job) }
      if (steps.length > 0) request.steps = steps
      if (chain !== null) request.chain = chain
      const asked = Date.now()
      answer = await askWithTimeout(deps.ask, request, controller)
      // Round 9 (30.5.4): every ask counts, a failed one with its time and no tokens.
      job.spend.asks += 1
      job.spend.ms += Date.now() - asked
      if (!('error' in answer) && answer.usage) {
        const { usage } = answer
        job.spend.input += usage.input + usage.cacheWrite
        job.spend.output += usage.output
        job.spend.cacheRead += usage.cacheRead
        job.spend.provider = usage.provider
        job.spend.model = usage.model
      }
    } finally {
      job.controller = null
    }
    if (job.cancelled) return null
    if ('error' in answer) {
      if (answer.error === 'no_model') setModelOff(true)
      return null
    }
    setModelOff(false)
    const intent = deps.logic.pageIntentFrom(answer.intent, { page, tabs }) ?? { kind: 'unclear', say: '' }
    return { intent, say: answer.say, more: answer.done === false, plan: planFrom(answer), page }
  }

  /**
   * Runs one step: its commands in order through the page, stopping at the first failure, and
   * inpageResult for the line and the session (hints, undo). u: the live utterance whose preview
   * may still be in the box; a step without a setText puts the base back first. suffix: added to
   * both lines (round 3: "Jõuan järele…" on a stale utterance).
   */
  const perform = async (step: InpageStep, u: Live | null, suffix = '', job: Job | null = null, page: PageContext | null = null): Promise<Outcome> => {
    const withSuffix = (line: string): string => (suffix === '' || line === '' ? line : `${line} ${suffix}`)
    st.session = step.session
    say(withSuffix(step.line))
    // Round 8 (29.2): "loe viimane lause ette": the text is read aloud; nothing runs on the page.
    if (step.speak !== undefined) speakAloud(step.speak)
    // A command, or nothing at all: the preview must not stay in the box.
    if (u !== null && !step.commands.some((c) => c.kind === 'setText')) await takeBack(u)
    if (step.commands.length === 0) {
      st.readBack = false
      if (job !== null) {
        job.ran.push(ranOf([], step.line))
        job.ok = true
      }
      return { ok: true, line: step.line }
    }
    // Round 10 (#5, 34.2): a command that opens, switches or closes a tab remembers the tab he was on.
    if (job !== null && job.from === undefined && step.commands.some((c) => c.kind === 'newTab' || c.kind === 'switchTab' || c.kind === 'closeTab')) {
      const front = (await deps.tabs().catch((): TabSummary[] => [])).find((t) => t.active)
      if (front !== undefined) job.from = `${front.index} ${JSON.stringify(front.title)}`
    }
    let last: BrowserResult = { ok: true }
    for (const command of step.commands) {
      last = await runSafe(command)
      if (!last.ok) break
    }
    const after = deps.logic.inpageResult(st.session, step.commands, last)
    st.session = after.session
    st.readBack = readsBack(step.commands, last)
    const line = after.line !== '' ? after.line : step.line
    if (job !== null) {
      job.ran.push(ranOf(step.commands, line, page?.items))
      job.ok = last.ok
    }
    // Round 5: a job given up meanwhile ("katkesta", the watchdog) keeps that line, not this late result.
    if (job?.dropped !== true) say(withSuffix(line))
    scrollRan(step.commands.at(-1), last, withSuffix(line))
    return { ok: last.ok, line }
  }

  /**
   * Round 10 (#5, 34.3): a site opened while a login or form is in progress opens beside it (goTo
   * becomes newTab), so the tab in front is never lost; the strip says so. The page is read only
   * when the step has a goTo and the caller has not read it.
   */
  const beside = async (step: InpageStep, box: BoxState, page: PageContext | null): Promise<InpageStep> => {
    if (!step.commands.some((c) => c.kind === 'goTo')) return step
    // The box as it was before the utterance: a preview of his own words is not words he has not sent.
    const front = page ?? (await readPage(box, box.text))
    const commands = besideCommands(step.commands, front)
    return commands === step.commands ? step : { ...step, commands, line: `${step.line} ${inpageText.beside}`.trim() }
  }

  /**
   * Round 4: the model planned goals after the one its action serves. With no chain yet, the
   * chain starts: the goal is the part of the utterance the action served (firstGoal). In a chain,
   * a plan on a goal's first ask means the goal itself held several parts ("siis ava Karin ja
   * kustuta see"): the goal narrows to its first part and the rest go before what remained.
   */
  const planChain = (job: Job, heard: Heard, firstAskOfGoal: boolean): void => {
    if (heard.plan.length === 0 || !firstAskOfGoal) return
    const chain = job.chain
    if (chain === null) {
      const goal = firstGoal(job.utterance, heard.plan, heard.say)
      // Review: a plan that repeats the whole utterance or the goal in hand would ask the same thing
      // again until MAX_CHAIN_STEPS; such goals, and duplicates, are not goals.
      const remaining = heard.plan.filter((g, i) => !sameGoal(g, goal) && !sameGoal(g, job.utterance) && heard.plan.findIndex((h) => sameGoal(h, g)) === i)
      if (remaining.length === 0) return
      job.chain = { original: job.utterance.slice(0, 1000), completed: [], goal, remaining }
    } else {
      const goal = firstGoal(chain.goal, heard.plan, heard.say)
      const known = [...chain.completed, goal, chain.goal, chain.original, ...chain.remaining]
      const fresh = heard.plan.filter((g, i) => !known.some((k) => sameGoal(k, g)) && heard.plan.findIndex((h) => sameGoal(h, g)) === i)
      if (fresh.length === 0) return
      job.chain = { ...chain, goal, remaining: [...fresh, ...chain.remaining].slice(0, MAX_PLAN_GOALS) }
    }
    showChain(job.chain)
  }

  /**
   * M7.2: runs the model's step and, while the model says the goal asks for more, looks at the
   * page again and asks again with the steps taken so far. Bounded: maxSteps steps (MAX_INTENT_STEPS,
   * or what the chain has left), INTENT_LOOP_BUDGET_MS since `since`, MAX_STEP_FAILURES failed
   * steps, an unclear answer stops it, and so does a later utterance (round 3: the step in hand
   * finishes, no further one is asked for; the strip keeps that step's line). Everything runs
   * through perform, so the session stays true. Round 4: an unclear after a good step ("Valmis")
   * ends the goal as done; `taken` counts the steps run, for the chain's total.
   */
  const runGoal = async (job: Job, box: BoxState, recentBefore: RecentCommand[], first: Heard, u: Live | null, since: number, maxSteps: number, taken: { n: number }): Promise<GoalEnd> => {
    let heard = first
    let steps: IntentStep[] = []
    let failures = 0
    for (;;) {
      planChain(job, heard, steps.length === 0)
      // Round 8 (29.4.2): a place is resolved here, from his own list; applyIntent never sees it.
      const planned = heard.intent.kind === 'place' ? placeStep(heard.intent.noun) : deps.logic.applyIntent(st.session, heard.intent, heard.page, heard.say)
      // Round 10 (#5, 34.3): beside a login in progress, a site or place opens in a new tab.
      const step = await beside(planned, box, heard.page)
      const outcome = await perform(step, u, '', job, heard.page)
      u = null
      if (job.dropped) return 'stopped'
      // Round 10 (#5, 34.4): a tie asked its question; his next utterance answers it.
      if (heard.intent.kind === 'choose') return 'stopped'
      if (heard.intent.kind === 'unclear') {
        if (steps.some((s) => s.ok)) return 'done'
        // Round 9: an unclear with no step of it run is its own ending.
        if (steps.length === 0) job.ending = 'unclear'
        return 'stopped'
      }
      // A step with nothing to run did nothing: the model hears that, not a success.
      const ok = outcome.ok && step.commands.length > 0
      if (!ok) failures += 1
      taken.n += 1
      steps = [...steps, { action: kindSummary(heard.intent), say: heard.say, ok, message: ok ? '' : outcome.line }]
      if (!heard.more && ok) return 'done'
      // A failed step is asked about once more even when the model thought it was done: the
      // model could not know the click would miss, and the steps now say so.
      if (steps.length >= maxSteps || failures >= MAX_STEP_FAILURES) return 'stopped'
      if (job.interrupted) return 'stopped'
      if (Date.now() - since > INTENT_LOOP_BUDGET_MS) return 'stopped'
      await settle()
      if (job.interrupted) return 'stopped'
      job.looping = true
      const next = await askOnce(job, box, null, recentBefore, steps)
      if (next === null) return 'stopped'
      heard = next
    }
  }

  /**
   * Round 4: works through the utterance's goals. The first goal runs as M7.2's loop; when the
   * model's answer carried a plan the chain starts, and each goal done shifts to the next: asked
   * afresh with that goal as the utterance, the chain in the request, and the steps reset. It
   * stops when nothing remains, after MAX_CHAIN_STEPS page steps in all, after MAX_CHAIN_MS since
   * the utterance arrived, on unclear, on two failed steps for one goal, when the model cannot be
   * reached, and on barge-in (a later utterance; a plain send only waits). The chain line on the
   * strip is published on every shift and cleared when the chain ends, however it ends.
   */
  const follow = async (job: Job, box: BoxState, recentBefore: RecentCommand[], first: Heard, u: Live | null): Promise<void> => {
    const started = job.arrived
    const taken = { n: 0 }
    let heard = first
    let since = job.arrived
    if (job.chain !== null) showChain(job.chain)
    // Round 9 (30.5.4): done only when the last goal ended done and nothing remained.
    let finished = false
    try {
      for (;;) {
        const end = await runGoal(job, box, recentBefore, heard, u, since, Math.min(MAX_INTENT_STEPS, MAX_CHAIN_STEPS - taken.n), taken)
        u = null
        const chain = job.chain
        if (end !== 'done' || chain === null) {
          finished = end === 'done'
          break
        }
        const [goal, ...remaining] = chain.remaining
        if (goal === undefined) {
          finished = true
          break
        }
        if (taken.n >= MAX_CHAIN_STEPS || Date.now() - started > MAX_CHAIN_MS || job.interrupted) break
        job.chain = { ...chain, completed: clipGoals([...chain.completed, chain.goal]), goal, remaining }
        showChain(job.chain)
        await settle()
        if (job.interrupted) break
        job.looping = true
        since = Date.now()
        // Round 5: the watchdog is per goal, so a long chain is never given up while it moves.
        watch(job)
        const next = await askOnce(job, box, null, recentBefore, [])
        if (next === null) break
        heard = next
      }
    } finally {
      // Review: the chain line goes on every exit, a thrown step included.
      const chain = job.chain
      st.lastDone = clipGoals(chain === null ? [job.utterance] : [...chain.completed, chain.goal])
      if (chain !== null) showChain(null)
      job.ending ??= finished ? 'done' : 'stopped'
      job.spend.steps += taken.n
      job.spend.goals = chain === null ? 1 : chain.completed.length + 1
    }
  }

  /**
   * Round 3: the verification of a type-first dictation, in the background. The words are in the
   * box and the next utterance goes on; a send waits for this. A verdict of dictate or unclear, no
   * answer, or a cancellation leaves the words. A command: when the box still reads as the typing
   * left it, the typing is taken back (the session from before it, the base in the box) and the
   * command runs; when the box has changed since (more was typed, or the page changed it), nothing
   * is touched and the strip says the words were a command.
   */
  const verify = (from: Job, box: BoxState, before: InpageSession, typedSession: InpageSession, typed: Outcome, expected: string | null, recentBefore: RecentCommand[]): void => {
    const job = newJob(from.utterance, false)
    // Round 10 (#5, 34.2): the typing is this utterance's command until a verdict takes it back.
    job.ran = [...from.ran]
    job.ok = from.ok
    job.verifying = true
    job.chain = from.chain
    job.continued = from.continued
    let done = (): void => undefined
    const p = new Promise<void>((resolve) => {
      done = resolve
    })
    pending.add(p)
    void (async () => {
      think(true)
      beginWork(job)
      try {
        const heard = await askOnce(job, box, box.text, recentBefore, [])
        if (heard === null) return
        // Round 9 (30.5.4): the words stay as typed: dictation is the task done, unclear its own ending.
        if (heard.intent.kind === 'dictate' || heard.intent.kind === 'unclear') {
          job.ending = heard.intent.kind === 'dictate' ? 'done' : 'unclear'
          return
        }
        // Round 5 (review M7): a long sentence judged one plain command with nothing after it stays.
        if (heard.intent.kind === 'command' && !heard.more && heard.plan.length === 0 && wordCount(job.utterance) >= LONG_COMMAND_WORDS) {
          job.ending = 'done'
          say(inpageText.keptWords)
          return
        }
        job.acting = true
        acting.add(p)
        if (typed.ok && expected !== null) {
          const now = await readBox()
          if (now.text !== expected) {
            say(inpageText.lateCommand(job.utterance))
            return
          }
        }
        // The rules' typing is taken back: the session from before it (unless something since has
        // moved the session on), and the base in the box.
        if (st.session === typedSession) st.session = before
        if (typed.ok) await runSafe({ kind: 'setText', text: box.text })
        job.ran = []
        await follow(job, box, recentBefore, heard, null)
      } finally {
        think(false)
        endWork(job)
        pending.delete(p)
        acting.delete(p)
        done()
      }
    })()
  }
  return { askOnce, perform, beside, follow, verify }
}
