// The in-page engine (docs/ARCHITECTURE.md 21.2, 21.3): one recogniser and one InpageSession for
// the whole browser. No chrome.* here: the offscreen document wires it to the service worker, and
// the unit test wires it to fakes.

import type { BoxState, BrowserCommand, BrowserResult } from '../../src/browser/protocol.ts'
import type { InpageStep } from '../../src/core/inpage.ts'
import { STRINGS } from '../../src/core/strings.ts'
import { verifiedOwner } from '../../src/speech/asrProtocol.ts'
import type { EndpointMode } from '../../src/speech/asrProtocol.ts'
import { documentPaused, inDocument } from '../../src/core/documentMode.ts'
import { speak as synthSpeak } from '../../src/speech/synth.ts'
// ---------- reading aloud (29.5) ----------
import { isReadStop } from '../../src/core/reading.ts'
// ---------- wake word and places (29.4) ----------
import { placeByNoun, placeCommand, placeHost, placeNounSaid, placeVoice } from '../../src/core/places.ts'
import { wakeWordFrom } from '../../src/core/wake.ts'
// ---------- round 10: addressed speech (32) ----------
import { recentFinals } from '../../src/core/addressee.ts'
import type { AddresseeRequest, AddresseeVerdict } from '../../src/core/addressee.ts'
// ---------- the engine's parts (engine/) ----------
import { ASK_TIMEOUT_MS, COMMAND_TIMEOUT_MS, ENROL_TIMEOUT_FACTOR, GOAL_CHARS, LAG_SHOWN_MS, LONG_UTTERANCE_WORDS, NO_BOX, PLACE_ASK_MS, SEND_PROBE_BOX, STALE_MS, TITLE_CHARS, URL_CHARS, UTTERANCE_CHARS } from './engine/constants.ts'
import { careOf, clipGoals, wordCount } from './engine/helpers.ts'
import { createGoals } from './engine/goals.ts'
import type { AskFailure, Engine, EngineDeps, EngineHandlers, EngineState, Job, Live } from './engine/types.ts'
import { createWakeGate } from './engine/wake.ts'
import { createWork } from './engine/work.ts'

export { ASK_TIMEOUT_CAREFUL_MS, ASK_TIMEOUT_MS, BUSY_FROM_S, CAREFUL_WORDS, COMMAND_TIMEOUT_MS, ENROL_TIMEOUT_FACTOR, INTENT_LOOP_BUDGET_MS, JOB_WATCHDOG_MS, LAG_SHOWN_MS, LONG_COMMAND_WORDS, LONG_UTTERANCE_WORDS, MAX_STEP_FAILURES, PLACE_ASK_MS, SEND_PROBE_BOX, SETTLE_MS, STALE_MS, askTimeoutMs } from './engine/constants.ts'
export type { AskFailure, Engine, EngineDeps, EngineHandlers, InpageLogic } from './engine/types.ts'

export function createEngine(given: EngineDeps): Engine {
  /** Round 10 (33.4): the line the strip shows now, so the end of a timed scroll never writes over a newer one. */
  let shownLine = ''
  const deps: EngineDeps = {
    ...given,
    publish: (patch) => {
      if (patch.line !== undefined) shownLine = patch.line
      given.publish(patch)
    },
  }
  const text = STRINGS[deps.lang].strip
  const inpageText = STRINGS[deps.lang].inpage
  /** The state the engine's parts share (engine/types.ts EngineState). */
  const st: EngineState = { session: deps.logic.initialInpage(deps.lang), recent: [], readBack: false, modelOff: false, lastDone: [], places: [] }
  let listening = false
  let queue: Promise<void> = Promise.resolve()
  let live: Live | null = null
  /** 27.3: the server refused the token. The standing line and the socket's failure name it. */
  let badToken = false
  /** Round 9 (30.1): the socket failed while listening; the down line was said once and waits for the server. */
  let outage = false
  const downLine = (): string => (badToken ? text.badToken : deps.hosted === true ? text.serverDownHosted : text.serverDownLocal)

  const setModelOff = (off: boolean): void => {
    if (off === st.modelOff) return
    st.modelOff = off
    deps.publish({ modelProblem: off ? inpageText.modelOff : '' })
  }

  /** Publishes a line about an utterance. */
  const say = (line: string): void => {
    deps.publish({ line, resting: st.session.asleep })
  }

  /** One page command, never longer than COMMAND_TIMEOUT_MS (round 5): a page that never answers must not hold the engine. */
  const runSafe = async (command: BrowserCommand): Promise<BrowserResult> => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timedOut = new Promise<BrowserResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, code: 'failed', message: 'timed_out' }), COMMAND_TIMEOUT_MS)
    })
    try {
      return await Promise.race([deps.run(command), timedOut])
    } catch (error) {
      return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  // ---------- round 10 (#7, ARCHITECTURE 33.4): the timed scroll ----------
  /** A slow scroll this engine started may still run ("katkesta" stops it); the page also ends one by itself. */
  let scrolling = false
  let scrollTimer: ReturnType<typeof setTimeout> | null = null
  const endScrollTimer = (): void => {
    if (scrollTimer !== null) clearTimeout(scrollTimer)
    scrollTimer = null
  }
  /**
   * After a step ran: a slow scroll that started is remembered, any other scroll forgets it. A timed
   * one says it ended when its time is up, if its line is still the one shown (the page stops it itself).
   */
  const scrollRan = (command: BrowserCommand | undefined, result: BrowserResult, line: string): void => {
    if (command?.kind !== 'scroll') return
    endScrollTimer()
    scrolling = result.ok && command.mode === 'slow'
    if (!scrolling || command.seconds === undefined) return
    scrollTimer = setTimeout(() => {
      scrollTimer = null
      scrolling = false
      if (shownLine === line) say(inpageText.scrollEnded)
    }, command.seconds * 1000)
  }
  /** "katkesta": a slow scroll still running is stopped at once, outside the queue. */
  const stopScroll = (): void => {
    endScrollTimer()
    if (!scrolling) return
    scrolling = false
    void runSafe({ kind: 'scroll', direction: 'down', mode: 'stop' })
  }
  // ---------- end of the timed scroll ----------

  // ---------- round 10 (#7, ARCHITECTURE 33.2): the endpoint mode ----------
  /** The last box read, and where the mode goes once the recogniser is made. */
  let lastBox: BoxState = NO_BOX
  let endpointTo: ((mode: EndpointMode) => void) | null = null
  /** Dictation (a box armed, or the entry flow) ends an utterance at 1.0 s of silence; a command at 0.6 s. */
  const tellEndpoint = (): void => endpointTo?.(entry || lastBox.armed ? 'dictation' : 'command')
  // ---------- end of the endpoint mode ----------

  const readBox = async (): Promise<BoxState> => {
    const read = await runSafe({ kind: 'readBox' })
    const box = read.ok && read.box ? read.box : NO_BOX
    lastBox = box
    tellEndpoint()
    return box
  }

  /** What this utterance wants in the box now, or null to leave the box alone. */
  const wanted = (u: Live): string | null => {
    const base = u.base
    if (base === null || !base.present) return null
    const preview = deps.logic.inpagePreview(inDocument(base) ? { ...st.session, paused: u.paused === true } : st.session, u.partial, base)
    if (preview !== null) return preview
    // The words may be a command now: take back a preview already typed.
    return u.inBox !== null ? base.text : null
  }

  /** Types the newest wanted text, one setText at a time, skipping partials that came in between. */
  const type = (u: Live): void => {
    if (u.typing !== null) return
    u.typing = (async () => {
      await u.ready
      for (;;) {
        if (u.over) break
        const want = wanted(u)
        if (want === null || want === u.inBox) break
        u.inBox = want
        await runSafe({ kind: 'setText', text: want })
      }
      u.typing = null
    })()
  }

  /** Ends u's typing, waits for the setText in flight, and puts the base back if a preview is in the box. */
  const takeBack = async (u: Live): Promise<void> => {
    u.over = true
    await u.ready
    if (u.typing !== null) await u.typing
    const base = u.base
    if (base !== null && base.present && u.inBox !== null && u.inBox !== base.text) {
      u.inBox = base.text
      await runSafe({ kind: 'setText', text: base.text })
    }
  }

  const work = createWork({ deps, st, say, inpageText, onWorkChange: () => wakeGate.listenWork() })
  const { jobs, pending, acting, think, resetThinking, busyCheck, newJob, showChain, giveUp, beginWork, endWork } = work
  let lagShown = false


  /** The rules' step for an utterance against the probe box. Pure: the probe box is never typed into. Null when the rules throw. */
  const probe = (utterance: string): InpageStep | null => {
    try {
      return deps.logic.inpageStep(st.session, utterance, SEND_PROBE_BOX)
    } catch {
      return null
    }
  }

  /** The rules alone say whether an utterance is a plain send, before its turn comes. */
  const isPlainSend = (utterance: string): boolean => {
    const step = probe(utterance)
    return step !== null && step.commands.length === 1 && step.commands[0]?.kind === 'pressSend'
  }

  /** Round 5: the rules say the utterance is the global cancel ("katkesta"). */
  const isCancelAll = (utterance: string): boolean => probe(utterance)?.cancel === true

  /**
   * Round 5: "katkesta": every job is given up, the queued ones do nothing at all, the live
   * preview is taken back, and the strip's dots, seconds and chain line go. The model is not asked.
   */
  const cancelAll = (): void => {
    stopScroll()
    for (const job of jobs) {
      job.dropped = true
      giveUp(job)
    }
    dropLive()
    showChain(null)
    resetThinking()
    busyCheck()
  }


  /**
   * Barge-in (round 3): a new utterance stops the model work of every earlier one at the next
   * safe point. A plain send is the exception: it waits for a verification instead of cancelling
   * it (nothing is sent while the box is being judged), but a multi-step loop is still given up.
   * Review R3 M3: only a job that has begun (its turn came: a question in flight, the loop, a
   * verification, or the typing a verification would follow) is cancelled; one still waiting its
   * turn has nothing stale, so it is only interrupted (no further step) and gets the rules and its
   * first ask when its turn comes. STALE_MS covers one that waited too long.
   */
  const interrupt = (newcomer: Job): void => {
    for (const job of jobs) {
      if (job === newcomer) continue
      if (newcomer.send && job.verifying && !job.acting) continue
      // Round 4: a plain send does not cancel a chain of goals; it waits its turn behind it.
      if (newcomer.send && job.chain !== null) continue
      job.interrupted = true
      const modelWork = job.started !== null || job.controller !== null || job.looping || job.verifying
      if (modelWork && (!newcomer.send || job.looping)) {
        job.cancelled = true
        job.controller?.abort()
      }
    }
  }

  const { askOnce, perform, beside, follow, verify } = createGoals({ deps, st, inpageText, say, runSafe, readBox, takeBack, setModelOff, speakAloud: (text) => speakAloud(text), scrollRan, placeStep: (noun) => placeStep(noun), work })


  const settled = (set: Set<Promise<void>>): Promise<unknown> => Promise.all([...set])

  const handle = async (job: Job, u: Live | null): Promise<void> => {
    try {
      // A send waits for every verification: nothing is sent while the box is being judged. Any
      // other utterance waits only for a verification running page commands, so commands of two
      // utterances do not interleave.
      await settled(job.send || job.continued ? pending : acting)
      beginWork(job)
      // Round 5: "katkesta" came while this one waited: nothing of it runs, its preview goes.
      if (job.dropped) {
        if (u !== null) await takeBack(u)
        return
      }
      // Round 4: a continued utterance carries what the last one finished as its completed goals.
      if (job.continued && job.chain !== null) job.chain = { ...job.chain, completed: clipGoals(st.lastDone) }
      let box: BoxState
      if (u === null) {
        box = await readBox()
      } else {
        u.over = true
        await u.ready
        if (u.typing !== null) await u.typing
        // The base, never the box as it reads now: that holds the preview. A plain send typed no
        // preview and waited for the chain or verification before it, which may have armed or filled
        // the box since the base was read (review): it reads the box as it is now.
        box = job.send ? await readBox() : (u.base ?? NO_BOX)
      }
      // Round 8 (29.2): in a document the rules hear whether the pause before this final was a long one.
      if (inDocument(box)) st.session = { ...st.session, paused: job.paused === true }
      // ---------- wake word and places (29.4) ----------
      // Round 8 (29.4.3): "lisa koht uudised" saves the tab in front; "lisa koht" asks for the word first.
      if (await placeByVoice(job, box, u)) {
        st.lastDone = clipGoals([job.utterance])
        return
      }
      // Round 8: "vaata uudiseid" opens his place, before the rules; never in an armed box (it may be a message).
      const place = box.armed ? null : placeCommand(job.utterance, st.places)
      if (place !== null) {
        await perform(await beside({ session: st.session, commands: [{ kind: 'goTo', url: place.url }], line: wakeText.opening(place.place.label) }, box, null), u, '', job)
        st.lastDone = clipGoals([job.utterance])
        return
      }
      // ---------- end of wake word and places ----------
      const before = st.session
      const recentBefore = st.recent
      const rules = deps.logic.inpageStep(st.session, job.utterance, box)
      // Round 8 (29.4.1): words the rules type into an armed box open the dictation window.
      wakeDictation(job, box, rules)
      // Waited too long in the queue: the rules alone, and the strip says so (round 3). A continued
      // utterance meant to wait for the chain before it (round 4) is never stale.
      const stale = Date.now() - job.arrived > STALE_MS && !job.continued
      // Dictation by the rules: a short utterance, or one with no armed box, may mean something else.
      const shouldAsk = rules.ask === true && (!box.armed || wordCount(job.utterance) < LONG_UTTERANCE_WORDS) && !stale && !job.cancelled
      if (!shouldAsk) {
        await perform(await beside(rules, box, null), u, stale ? inpageText.catchingUp : '', job)
        st.lastDone = clipGoals([job.utterance])
        return
      }
      // Round 5: a single-line field (a form's name, email, code) is verified before anything is typed.
      const single = box.single === true
      // Round 8 (29.2): never in a document: there the model is asked first, and only about a command verb.
      if (box.armed && !single && !inDocument(box)) {
        // Type first, verify after: the words are in the box at once, and the model only takes
        // them back when it is sure they were something else. The verification does not hold the
        // queue (round 3).
        const typed = await perform(rules, u, '', job)
        const typedSession = st.session
        const expected = rules.commands.reduce<string | null>((text, c) => (c.kind === 'setText' ? c.text : text), null)
        if (!job.cancelled) {
          // Round 9: the verification's job reports the task's spend, not this one.
          job.handedOff = true
          verify(job, box, before, typedSession, typed, expected, recentBefore)
        }
        return
      }
      // Nothing was typed, so there is nothing to show yet: wait for the model.
      think(true)
      deps.publish({ line: careOf(job) === 'careful' ? inpageText.thinkingLong : inpageText.thinking })
      try {
        const heard = await askOnce(job, box, box.text, recentBefore, [])
        if (job.dropped) {
          if (u !== null) await takeBack(u)
          return
        }
        if (heard === null) {
          // A single-line field with a model that gave no answer gets nothing typed (round 5); the
          // rules' step stands everywhere else, and where there is no model at all.
          if (single && box.armed && !st.modelOff) {
            if (u !== null) await takeBack(u)
            say(inpageText.fieldUnverified)
            return
          }
          await perform(await beside(rules, box, null), u, '', job)
          return
        }
        // Review of round 5: in a field he armed himself, a model that cannot tell leaves the
        // typing to the rules, as type-first does everywhere else; nothing is lost to "ei saanud aru".
        if (single && box.armed && heard.intent.kind === 'unclear' && heard.plan.length === 0) {
          job.ending = 'unclear'
          await perform(rules, u, '', job)
          return
        }
        await follow(job, box, recentBefore, heard, u)
      } finally {
        think(false)
      }
    } finally {
      endWork(job)
    }
  }

  const begin = (): Live => {
    const u: Live = { base: null, ready: Promise.resolve(), partial: '', inBox: null, typing: null, over: false, paused: pausedNow() }
    // The base is read once, after every earlier utterance's commands have run.
    u.ready = queue.then(async () => {
      u.base = await readBox()
    })
    queue = u.ready
    return u
  }

  /**
   * Round 4 (review): while the server learns his voice he speaks eight seconds of anything; those
   * words are neither typed nor run. Cleared by onEnrolled, or by a timer when no answer comes.
   */
  let enrolTimer: ReturnType<typeof setTimeout> | null = null
  let enrolling = false
  const endEnrolment = (): void => {
    if (enrolTimer !== null) clearTimeout(enrolTimer)
    enrolTimer = null
    enrolling = false
  }

  /** The utterance in progress ends with no final: its preview goes, when it typed one. */
  const dropLive = (): void => {
    const u = live
    live = null
    if (u === null) return
    u.over = true
    queue = queue.then(() => takeBack(u))
  }

  /** Round 6 (26.5): the options page's entry flow is running; utterances go there. */
  let entry = false
  /** One utterance for the entry flow, in turn. A page that does not answer (not in front) ends entry mode. */
  const toEntry = (utterance: string): void => {
    queue = queue
      .then(async () => {
        const result = await runSafe({ kind: 'savedEntry', utterance })
        if (!result.ok && entry) {
          entry = false
          say(inpageText.entryGone)
        }
      })
      .catch(() => undefined)
  }

  // ---------- document mode (29.2): the pause window and reading aloud ----------
  /** Date.now() of the last final handed to a job, or null before the first. */
  let lastFinalAt: number | null = null
  /** Whether speech starting now begins after the document pause window (DOCUMENT_PAUSE_MS). */
  const pausedNow = (): boolean => documentPaused(lastFinalAt, Date.now())
  /** A final arrived: the pause before it is measured from when its speech began (its first partial), else from now. */
  const finalArrived = (job: Job, u: Live | null): void => {
    job.paused = u?.paused ?? pausedNow()
    lastFinalAt = Date.now()
  }
  const speakAloud = (text: string): void => {
    const lang = deps.lang === 'et' ? 'et-EE' : 'en-US'
    const read = deps.speak ?? synthSpeak
    try {
      read(text, lang, () => undefined)
    } catch {
      // Speech synthesis missing or refused: the strip line already says what was meant.
    }
  }
  // ---------- end of document mode ----------
  // ---------- wake word and places (29.4) ----------
  const wakeText = STRINGS[deps.lang].wake
  /** The model's place, resolved here; a noun no longer set opens nothing. */
  const placeStep = (noun: string): InpageStep => {
    const place = placeByNoun(st.places, noun)
    return place === undefined ? { session: st.session, commands: [], line: wakeText.missing } : { session: st.session, commands: [{ kind: 'goTo', url: place.url }], line: wakeText.opening(place.label) }
  }
  /** Round 8 (29.4.3): "lisa koht" asked for the word; the next final within PLACE_ASK_MS is it. */
  let placeAsk: { action: 'save' | 'remove'; until: number } | null = null
  /**
   * Saving or removing a place by voice. True when the utterance was that (done, or asking for the
   * word). An answer to the question that is not a usable word ends the question and goes on as usual.
   */
  const placeByVoice = async (job: Job, box: BoxState, u: Live | null): Promise<boolean> => {
    let want = placeVoice(job.utterance, box.armed)
    const asked = placeAsk
    placeAsk = null
    if (want === null && asked !== null && Date.now() < asked.until) {
      const noun = placeNounSaid(job.utterance)
      if (noun !== '') want = { action: asked.action, noun }
    }
    if (want === null) return false
    if (u !== null) await takeBack(u)
    if (want.noun === null) {
      placeAsk = { action: want.action, until: Date.now() + PLACE_ASK_MS }
      say(want.action === 'save' ? wakeText.placeAsk : wakeText.placeAskRemove)
      return true
    }
    if (want.action === 'remove' && placeByNoun(st.places, want.noun) === undefined) {
      say(wakeText.placeNotThere(want.noun))
      return true
    }
    const result = await runSafe(want.action === 'save' ? { kind: 'savePlace', noun: want.noun } : { kind: 'removePlace', noun: want.noun })
    if (!result.ok) say(wakeText.placeNotSaved)
    else say(want.action === 'save' ? wakeText.placeSaved(want.noun, placeHost(result.tab?.url ?? '')) : wakeText.placeRemoved(want.noun))
    return true
  }
  const wakeGate = createWakeGate({ deps, wakeText, jobCount: () => jobs.size, entry: () => entry, enrolling: () => enrolling, whileReading: (utterance) => whileReading(utterance), dropLive, isPlainSend })
  const { windowOpen, wakeDictation, wakeStopped } = wakeGate
  // ---------- end of wake word and places ----------
  // ---------- reading aloud (29.5) ----------
  /**
   * While a reading is in progress the microphone stays live and hears the synthesised voice too, so
   * every final is taken here: a stop word (isReadStop: "stopp", "aitab", "lõpeta lugemine", "paus",
   * "peata", …) stops the reading at once, outside the queue and before the rules (which would stop a
   * scroll or type a one-word reply); anything else is dropped unseen (no heard line, no typing). True
   * when a reading took the utterance.
   */
  const whileReading = (utterance: string): boolean => {
    if (deps.reading?.() !== true) return false
    dropLive()
    if (!isReadStop(utterance)) return true
    deps.publish({ heard: utterance })
    const stop: BrowserCommand = { kind: 'read', what: 'stop' }
    say(STRINGS[deps.lang].browserDoing(stop))
    void runSafe(stop)
    return true
  }
  // ---------- end of reading aloud ----------

  /** The utterance being spoken ends: its preview is handed to whoever takes the final. */
  const detachLive = (): Live | null => {
    const u = live
    live = null
    if (u !== null) u.over = true
    return u
  }
  /** One final, with the preview its partials typed (round 10: the addressee check may hand it over later). */
  const takeFinal = (utterance: string, u: Live | null): void => {
    deps.publish({ heard: utterance })
    if (entry) {
      toEntry(utterance)
      return
    }
    // Round 5: "katkesta" drops everything at once, in the handler, and asks nobody.
    if (isCancelAll(utterance)) {
      cancelAll()
      if (u !== null) queue = queue.then(() => takeBack(u))
      say(inpageText.cancelled)
      return
    }
    const job = newJob(utterance, isPlainSend(utterance))
    finalArrived(job, u)
    interrupt(job)
    // A step that throws must not stop every utterance after it: the queue stays a resolved promise.
    queue = queue.then(() => handle(job, u)).catch(() => undefined)
  }
  /** Round 4: "siis ava Karin" soon after the last utterance goes on from it: no barge-in, and the new words are asked as the next goal of the chain the last utterance was. */
  const takeContinued = (text: string, added: string, u: Live | null): void => {
    deps.publish({ heard: text })
    const job = newJob(added, false)
    finalArrived(job, u)
    job.continued = true
    job.chain = { original: text.slice(0, 1000), completed: [], goal: added.slice(0, GOAL_CHARS), remaining: [] }
    queue = queue.then(() => handle(job, u)).catch(() => undefined)
  }

  const handlers: EngineHandlers = {
    onUtterance(utterance) {
      if (enrolling) return
      if (whileReading(utterance)) return
      if (entry) {
        deps.publish({ heard: utterance })
        toEntry(utterance)
        return
      }
      takeFinal(utterance, detachLive())
    },
    onUtteranceContinued(text, added) {
      if (enrolling) return
      if (whileReading(added)) return
      takeContinued(text, added, detachLive())
    },
    onInterim(interim) {
      // An empty interim keeps the last words on the strip until new speech arrives.
      if (interim === '' || enrolling) return
      // 29.5: while reading, the partials are the reader's own voice (or a stop word, taken as a final): never shown or typed.
      if (deps.reading?.() === true) return
      deps.publish({ heard: interim })
      // Round 6: while saving by voice, partials are shown, never typed.
      if (!listening || entry) return
      const u = live ?? begin()
      live = u
      u.partial = interim
      type(u)
    },
    onError() {
      listening = false
      endEnrolment()
      deps.publish({ listening: false, problem: text.micBlocked })
      deps.micBlocked()
    },
    onNotice() {
      // The local recogniser has no fallback here; nothing to show.
    },
    onForeign(reason) {
      // Round 4 (review): someone else's final was dropped; the preview its partials typed must not
      // sit in his box until he next speaks (he may not). Taken back like a stopped utterance.
      dropLive()
      // Round 10 (31.7, issue #3 C): a short word without enough owner audio ran nothing; the strip
      // asks for the longer form. Nothing else: no recency, no exception for send.
      if (reason === 'insufficient_audio') deps.publish({ line: text.voiceTooShort })
    },
    onEnrolled() {
      endEnrolment()
    },
    onConnection(state) {
      // Round 9 (30.1): once per outage the down line, once when it is back "Server vastab jälle.".
      if (state === 'down') {
        if (!listening || outage) {
          deps.publish({ connection: 'down' })
          return
        }
        outage = true
        deps.publish({ connection: 'down', problem: downLine() })
        return
      }
      if (state === 'connected' && outage) {
        outage = false
        deps.publish({ connection: 'connected', problem: '', line: text.serverBack })
        return
      }
      // A try in an outage stays red until the socket is ready.
      if (state === 'connecting' && outage) return
      deps.publish({ connection: state })
    },
    onLag(ms) {
      // Round 3: how far behind the speech server is. Shown from LAG_SHOWN_MS, cleared once it is below.
      if (ms > LAG_SHOWN_MS) {
        lagShown = true
        deps.publish({ lag: ms })
      } else if (lagShown) {
        lagShown = false
        deps.publish({ lag: 0 })
      }
    },
  }

  // Round 8 (29.4.1): in wake mode every final, continuation and partial passes the gate first (engine/wake.ts).
  wakeGate.gate(handlers)

  // ---------- round 10 (#6, 32.3): the addressee check of always-on mode ----------
  /** The finals heard before (after the speaker gate), oldest first: the check's context. */
  let finals: string[] = []
  /** Finals not meant for Ütle since the last one that was. */
  let ignoredCount = 0
  /** The last final was judged not for Ütle: a continuation of it is a final of its own. */
  let lastIgnored = false
  /** The checks in order: a final waits for the one before it, so nothing overtakes a pending check. */
  let checks: Promise<void> = Promise.resolve()
  /** Review 1: "katkesta" drops the checks still pending too; each check remembers the epoch it began in. */
  let checkEpoch = 0
  if (!wakeGate.on && deps.addressee !== undefined) {
    const check = deps.addressee
    const inner = { onUtterance: handlers.onUtterance, onUtteranceContinued: handlers.onUtteranceContinued, onInterim: handlers.onInterim }
    const judged = (): boolean => !entry && !enrolling && deps.reading?.() !== true
    /** The page in front, in short. */
    const pageNow = async (): Promise<AddresseeRequest['page']> => {
      const read = await runSafe({ kind: 'readPage' })
      const page = read.ok ? read.page : undefined
      return { url: (page?.url ?? '').slice(0, URL_CHARS), title: (page?.title ?? '').slice(0, TITLE_CHARS), box: { present: page?.box.present === true, armed: page?.box.armed === true } }
    }
    /** The verdict, or null when the check gave none (it then goes on as before: the rules and the model still judge). */
    const verdictOf = async (utterance: string, before: string[]): Promise<AddresseeVerdict | null> => {
      // A rule knows it (a command, a send, the cancel): it was said to Ütle.
      if (probe(utterance)?.ask !== true) return 'command'
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS)
      try {
        const request: AddresseeRequest = { lang: deps.lang, utterance: utterance.slice(0, UTTERANCE_CHARS), finals: before, page: await pageNow(), readBack: st.readBack }
        const answer = await check(request, controller.signal).catch((): AskFailure => ({ error: 'unreachable' }))
        return 'error' in answer ? null : answer.verdict
      } finally {
        clearTimeout(timer)
      }
    }
    /**
     * One final (or continuation) through the check, in order; take runs it when it was for Ütle,
     * with whether the final before it was judged not for Ütle (read only once that verdict is in).
     */
    /**
     * Round 10 prompt 6 (QUICK, 32.3): the check asked on the stable words, before the client's hold
     * released their final. A final takes it only for exactly its words, the same finals before them
     * and the same epoch; anything else is asked again and this answer is dropped unread.
     */
    let early: { words: string; before: string[]; epoch: number; verdict: Promise<AddresseeVerdict | null> } | null = null
    const earlyFor = (words: string, before: readonly string[]): Promise<AddresseeVerdict | null> | null =>
      early !== null && early.words === words && early.epoch === checkEpoch && early.before.length === before.length && early.before.every((f, i) => f === before[i]) ? early.verdict : null
    const judge = (words: string, take: (u: Live | null, priorIgnored: boolean) => void): void => {
      const u = detachLive()
      const before = recentFinals(finals)
      const asked = earlyFor(words, before)
      early = null
      finals = recentFinals([...finals, words])
      const epoch = checkEpoch
      checks = checks
        .then(async () => {
          // Review 1: the verdict before this one has settled here, not when these words arrived.
          const priorIgnored = lastIgnored
          const verdict = epoch === checkEpoch ? await (asked ?? verdictOf(words, before)) : 'ignore'
          if (epoch !== checkEpoch) {
            // Cancelled while it waited: dropped like everything else in flight, nothing counted.
            if (u !== null) queue = queue.then(() => takeBack(u))
            return
          }
          if (verdict === 'ignore') {
            lastIgnored = true
            ignoredCount += 1
            if (u !== null) queue = queue.then(() => takeBack(u))
            // The bar shows the count, never the words.
            deps.publish({ heard: '', ignored: wakeText.notForMe(ignoredCount) })
            return
          }
          if (lastIgnored || ignoredCount > 0) deps.publish({ ignored: '' })
          lastIgnored = false
          ignoredCount = 0
          take(u, priorIgnored)
        })
        .catch(() => undefined)
    }
    /** Review 1: "katkesta" never waits behind a check (round 5: instant) and drops the pending ones. */
    const cancelNow = (utterance: string): void => {
      checkEpoch += 1
      early = null
      lastIgnored = false
      inner.onUtterance(utterance)
    }
    handlers.onStable = (words) => {
      // Only an ask starts here: nothing is shown, typed or run before the final (32.3).
      if (!judged() || words.trim() === '' || isCancelAll(words)) return
      const before = recentFinals(finals)
      if (earlyFor(words, before) !== null) return
      early = { words, before, epoch: checkEpoch, verdict: verdictOf(words, before).catch(() => null) }
    }
    handlers.onUtterance = (utterance) => {
      if (!judged()) return inner.onUtterance(utterance)
      if (isCancelAll(utterance)) return cancelNow(utterance)
      judge(utterance, (u) => takeFinal(utterance, u))
    }
    handlers.onUtteranceContinued = (text, added) => {
      if (!judged()) return inner.onUtteranceContinued(text, added)
      if (isCancelAll(added)) return cancelNow(added)
      // What it continues was not for Ütle: these words are judged and taken on their own.
      judge(added, (u, priorIgnored) => (priorIgnored ? takeFinal(added, u) : takeContinued(text, added, u)))
    }
    handlers.onInterim = (interim) => {
      if (!judged()) return inner.onInterim(interim)
      // Review 1: the strip shows his live words; nothing is previewed into the box before a verdict
      // says command or dictation (dictation lands with the final).
      if (interim !== '') deps.publish({ heard: interim })
    }
  }
  // ---------- end of the addressee check ----------

  // ---------- only the owner (round 10, ARCHITECTURE 31.4) ----------
  // Outside every other wrapper: the wake word, reading aloud, the entry flow and the queue all sit
  // behind these two doors. The recogniser checks the segment and the session (31.3); this is the
  // second, independent wall.
  const ownerOnly = (inner: EngineHandlers): EngineHandlers => ({
    ...inner,
    onInterim() {
      // Unverified words: never typed into the box, never shown on the strip.
    },
    onUtterance(utterance, decision) {
      if (verifiedOwner(decision)) inner.onUtterance(utterance)
      else dropLive()
    },
    onUtteranceContinued(text, added, decision) {
      if (verifiedOwner(decision)) inner.onUtteranceContinued(text, added)
      else dropLive()
    },
    onStable(text, decision) {
      // Round 10 prompt 6 (QUICK, 32.3): an early ask only for words of a verified owner decision.
      if (verifiedOwner(decision)) inner.onStable?.(text)
    },
  })
  const heardBy: EngineHandlers = deps.onlyOwner === true ? ownerOnly(handlers) : handlers
  // ---------- end of only the owner ----------

  const recognizer = deps.recognizer(
    heardBy,
    // Round 6: a spelled letter for the entry flow must not wait for the hold.
    // Round 8 (29.4.1): no quick reply from a partial while the wake window is closed (a partial cannot be gated).
    (utterance) => entry || ((!wakeGate.on || windowOpen()) && deps.logic.inpageInstant(st.session, utterance)),
    () => {
      listening = false
      endEnrolment()
      deps.publish({ listening: false, problem: badToken ? text.badToken : text.modelUnreachable, connection: 'down' })
    },
  )

  // Round 10 (#7, 33.2): the recogniser hears every mode from now on, command until a box says otherwise.
  endpointTo = (mode) => recognizer.setEndpointMode?.(mode)
  tellEndpoint()

  // Once: the strip tells him before he speaks when the server has no model.
  queue = queue.then(async () => {
    const status = await deps.status().catch((): 'unreachable' => 'unreachable')
    badToken = status === 'bad_token'
    st.modelOff = status === 'no_key' || badToken
    deps.publish({ modelProblem: badToken ? text.badToken : st.modelOff ? inpageText.modelOff : '' })
    // Round 9 (30.1): a 401 learnt after the socket failed names the token, not the server.
    if (outage && badToken) deps.publish({ problem: downLine() })
  })

  const start = (): void => {
    if (listening) return
    // Round 10 (#2, 32.2): in PASSIVE the room is heard all day; a hosted server or a cloud recogniser would get all of it. Never a silent upload.
    if (wakeGate.on && (deps.uploads === true || deps.hosted === true)) {
      deps.publish({ listening: false, problem: wakeText.uploadsOff })
      return
    }
    listening = true
    wakeGate.wakeStarted()
    deps.publish({ listening: true, problem: '', line: deps.wakeWord === undefined ? text.sayPrompt : wakeText.prompt(wakeWordFrom(deps.wakeWord)), resting: st.session.asleep })
    recognizer.start()
  }

  const stop = (): void => {
    if (!listening) return
    listening = false
    outage = false
    recognizer.stop()
    // Stopped in the middle of an utterance: no final will come, so its preview goes.
    dropLive()
    endEnrolment()
    wakeStopped()
    // The server sends no lag of 0 once the socket is gone: the line is cleared here.
    if (lagShown) {
      lagShown = false
      deps.publish({ listening: false, lag: 0 })
    } else deps.publish({ listening: false })
  }

  return {
    toggle() {
      if (listening) stop()
      else start()
    },
    start,
    stop,
    flush() {
      recognizer.flush?.()
    },
    enrol(seconds) {
      if (!recognizer.enrol) return
      if (!listening) start()
      dropLive()
      endEnrolment()
      enrolling = true
      enrolTimer = setTimeout(endEnrolment, seconds * 1000 * ENROL_TIMEOUT_FACTOR)
      recognizer.enrol(seconds)
    },
    get listening() {
      return listening
    },
    setSaved(items) {
      st.session = { ...st.session, saved: [...items] }
    },
    setEntry(on) {
      entry = on
      tellEndpoint()
      if (on) dropLive()
    },
    setPlaces(list) {
      st.places = [...list]
    },
    async idle() {
      for (;;) {
        const c = checks
        await c
        const q = queue
        await q
        const typing = live?.typing ?? null
        if (typing !== null) await typing
        if (pending.size > 0) {
          await settled(pending)
          continue
        }
        if (c === checks && q === queue && (live?.typing ?? null) === null) return
      }
    },
  }
}
