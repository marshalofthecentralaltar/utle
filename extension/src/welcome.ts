// The welcome page (docs/ARCHITECTURE.md 30.1, 31.7): the first run, in seven cards (round 10: the voice, its test and the choice after the server), for a helper who is
// not a developer. Opened on install instead of the bare microphone page, and again by "ava juhend"
// or the toolbar menu's "Alustamine". Like newtab.html, dist/page.js is loaded first, so page
// commands (utle-page-run) number its buttons and type into its demo box; the strip is mounted here.

import { STRINGS } from '../../src/core/strings.ts'
import { createDwell } from '../../src/ui/dwell.ts'
import { armElement } from './box.ts'
import { CONNECTION_KEYS, connectionFrom, connectionOf, isHostedAddress, isSocketAddress, serverCheck, serverUrl } from './connection.ts'
import { ENROL_PHRASES, VERIFY_PHRASES } from '../../src/core/enrolPhrases.ts'
import type { StripState, ToBackground, ToPage } from './messages.ts'
import { STATE_KEY } from './messages.ts'
import { phraseLine, voiceTestLine } from './voiceLines.ts'
import { mountStrip } from './strip.ts'
import { guardStore, readinessFrom } from '../../src/core/guard.ts'
import type { GuardReadiness } from '../../src/core/guard.ts'

const W = STRINGS.et.welcome
const WE = STRINGS.en.welcome
const text = STRINGS.et.strip
const en = STRINGS.en.strip

/** Step 3: the words in the demo box must stand still this long to count as a final that landed. */
export const DEMO_SETTLE_MS = 1000

const send = (message: ToBackground): void => {
  chrome.runtime.sendMessage(message).catch(() => undefined)
}

const setText = (id: string, value: string): void => {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

/** Click or a 1 s dwell, as on the settings page. */
function dwellable(el: HTMLElement, onFire: () => void): void {
  const dwell = createDwell({ onFire, onChange: (dwelling) => el.classList.toggle('dwelling', dwelling) })
  el.addEventListener('pointerenter', () => dwell.enter())
  el.addEventListener('pointerleave', () => dwell.leave())
  el.addEventListener('click', () => {
    if (dwell.click()) onFire()
  })
}

/** A large button: the Estonian label, the English one dim under it. */
function choice(id: string, label: string, sub: string, onFire: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.id = id
  b.className = 'choice'
  const fill = document.createElement('span')
  fill.className = 'fill'
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = label
  const small = document.createElement('span')
  small.className = 'sub'
  small.textContent = sub
  b.append(fill, name, small)
  dwellable(b, onFire)
  return b
}

interface Card {
  section: HTMLElement
  result: HTMLParagraphElement
}

/** One card: a dwellable head (number, title, English, "Tehtud") that runs the card's main action, then its body. */
function card(n: number, id: string, title: string, titleEn: string, body: string, bodyEn: string, onHead: () => void): Card {
  const section = document.createElement('section')
  section.className = 'step'
  section.id = id
  section.dataset.done = 'false'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'head'
  head.id = `${id}Head`
  const fill = document.createElement('span')
  fill.className = 'fill'
  const num = document.createElement('span')
  num.className = 'num'
  num.textContent = String(n)
  const titles = document.createElement('span')
  titles.className = 'titles'
  const t = document.createElement('span')
  t.textContent = title
  const sub = document.createElement('span')
  sub.className = 'sub'
  sub.textContent = titleEn
  titles.append(t, sub)
  const tick = document.createElement('span')
  tick.className = 'tick'
  tick.textContent = `✓ ${W.done}`
  head.append(fill, num, titles, tick)
  dwellable(head, onHead)
  const p = document.createElement('p')
  p.className = 'body'
  p.textContent = body
  const pe = document.createElement('p')
  pe.className = 'en'
  pe.textContent = bodyEn
  const result = document.createElement('p')
  result.className = 'result'
  result.id = `${id}Result`
  result.setAttribute('role', 'status')
  section.append(head, p, pe)
  document.getElementById('steps')?.append(section)
  return { section, result }
}

const done = { mic: false, server: false, demo: false, voice: false, check: false, guard: false }
/** Round 10 (31.7): what he chose on card 5. */
let guardChoice: 'owner' | 'all' | '' = ''
/** Card 5, once it is made: the cards above it tick it. */
let readyCard: Card | null = null

function show(c: Card, line: string, ok = false): void {
  c.result.textContent = line
  c.result.classList.toggle('ok', ok)
}

function mark(c: Card, on: boolean): void {
  c.section.dataset.done = String(on)
  readyCheck()
}

// ---------- the page ----------

document.title = `Ütle: ${W.title.toLocaleLowerCase('et')}`
setText('title', W.title)
setText('titleEn', WE.title)
setText('intro', W.intro)
setText('introEn', WE.intro)
setText('how', W.how)

// ---------- 1. Mikrofon ----------

const mic = card(1, 'stepMic', W.micTitle, WE.micTitle, W.micBody, WE.micBody, () => void askMic())
const micButton = choice('micAsk', W.micAsk, WE.micAsk, () => void askMic())
const micRow = document.createElement('div')
micRow.className = 'choices'
micRow.append(micButton)
mic.section.append(micRow, mic.result)

function micGranted(): void {
  if (!done.mic) send({ type: 'utle-mic-granted' })
  done.mic = true
  show(mic, W.micGranted, true)
  mark(mic, true)
}

function micBlocked(): void {
  done.mic = false
  show(mic, W.micDenied)
  const name = micButton.querySelector('.name')
  const sub = micButton.querySelector('.sub')
  if (name) name.textContent = text.permissionRetry
  if (sub) sub.textContent = en.permissionRetry
  mark(mic, false)
}

async function askMic(): Promise<void> {
  show(mic, '')
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
  } catch {
    micBlocked()
    return
  }
  micGranted()
}

/** On load: granted ticks at once, prompt asks (Chrome's own question), denied says how to allow it. */
async function micOnLoad(): Promise<void> {
  let status: PermissionStatus | null = null
  try {
    status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
  } catch {
    status = null
  }
  if (status) {
    status.addEventListener('change', () => {
      if (status?.state === 'granted') micGranted()
      else if (status?.state === 'denied') micBlocked()
    })
  }
  if (status?.state === 'granted') micGranted()
  else if (status?.state === 'denied') micBlocked()
  else await askMic()
}

// ---------- 2. Server ----------

const server = card(2, 'stepServer', W.serverTitle, WE.serverTitle, W.serverBody, WE.serverBody, () => void testServer())
const where = document.createElement('div')
where.className = 'choices'
const local = choice('serverLocal', W.choiceLocal, WE.choiceLocal, () => void chooseLocal())
const hosted = choice('serverHosted', W.choiceHosted, WE.choiceHosted, () => chooseHosted())
where.append(local, hosted)
const whereNote = document.createElement('p')
whereNote.className = 'note'
whereNote.id = 'serverNote'
// The English on its own dim line under the Estonian, as everywhere on the page.
const whereNoteEn = document.createElement('p')
whereNoteEn.className = 'en'
whereNoteEn.id = 'serverNoteEn'
const fields = document.createElement('div')
fields.className = 'fields'
fields.id = 'serverFields'
const field = (id: string, label: string, type: string, placeholder: string): HTMLInputElement => {
  const l = document.createElement('label')
  l.htmlFor = id
  l.textContent = label
  const input = document.createElement('input')
  input.id = id
  input.type = type
  input.placeholder = placeholder
  input.autocomplete = 'off'
  input.spellcheck = false
  dwellable(input, () => input.focus())
  fields.append(l, input)
  return input
}
const address = field('asrUrl', `${text.serverAddress} · ${en.serverAddress}`, 'url', 'wss://…/api/asr')
const token = field('serverToken', `${text.serverToken} · ${en.serverToken}`, 'password', '')
const testRow = document.createElement('div')
testRow.className = 'choices'
testRow.append(choice('serverTest', text.serverTest, en.serverTest, () => void testServer()))
server.section.append(where, whereNote, whereNoteEn, fields, testRow, server.result)

let hostedChosen = false
function pressWhere(isHosted: boolean): void {
  hostedChosen = isHosted
  local.setAttribute('aria-pressed', String(!isHosted))
  hosted.setAttribute('aria-pressed', String(isHosted))
  fields.hidden = !isHosted
  whereNote.textContent = isHosted ? W.choiceHostedNote : W.choiceLocalNote
  whereNoteEn.textContent = isHosted ? WE.choiceHostedNote : WE.choiceLocalNote
}

/** Samas arvutis: the stored address and token go, so the local default holds; then it is tried. */
async function chooseLocal(): Promise<void> {
  pressWhere(false)
  address.value = ''
  token.value = ''
  await chrome.storage.local.remove(['asrUrl', 'serverToken']).catch(() => undefined)
  await testServer()
}

function chooseHosted(): void {
  pressWhere(true)
  show(server, '')
  address.focus()
}

/** Stores the fields (hosted only); false when the address is not a ws:// or wss:// address. */
async function storeServer(): Promise<boolean> {
  if (!hostedChosen) return true
  const value = address.value.trim()
  if (value !== '' && !isSocketAddress(value)) {
    show(server, text.notAnAddress(value))
    return false
  }
  if (value === '') await chrome.storage.local.remove('asrUrl')
  else await chrome.storage.local.set({ asrUrl: value })
  const secret = token.value.trim()
  if (secret === '') await chrome.storage.local.remove('serverToken')
  else await chrome.storage.local.set({ serverToken: secret })
  return true
}

/** "Proovi ühendust": GET /api/status through the settings page's path; the result goes to the strip's dot too. */
async function testServer(): Promise<void> {
  if (!(await storeServer())) return
  show(server, text.serverChecking)
  const connection = connectionFrom(await chrome.storage.local.get([...CONNECTION_KEYS]))
  const check = await serverCheck(serverUrl(connection.asrUrl, '/api/status'), connection.token)
  send({ type: 'utle-state', patch: { connection: connectionOf(check.state) } })
  done.server = check.state === 'live' || check.state === 'no_key'
  if (check.state === 'bad_token') show(server, text.serverWrongToken)
  else if (check.state === 'unreachable') show(server, `${text.serverUnreachable} ${isHostedAddress(connection.asrUrl) ? W.hintHosted : W.hintLocal}`)
  else {
    const ok = text.serverOk(check.speech ?? { local: false, soniox: false }, check.state === 'live')
    show(server, check.profile ? `${ok} ${text.serverProfile(check.profile)}` : ok, true)
  }
  mark(server, done.server)
  done.voice = check.profile?.enrolled === true
  mark(voice, done.voice)
  if (done.voice) show(voice, W.voiceDone, true)
}

void chrome.storage.local.get([...CONNECTION_KEYS]).then((stored) => {
  const a = typeof stored.asrUrl === 'string' ? stored.asrUrl : ''
  address.value = a
  token.value = typeof stored.serverToken === 'string' ? stored.serverToken : ''
  pressWhere(a.trim() !== '')
})

// ---------- 3. Õpeta mu hääl (round 10, 31.7: the voice first) ----------
// The phrases one at a time, read aloud; after each the server says whether it counted it (enough
// clean speech) or why to read it again. The last two are held out: the server checks the candidate
// on them and keeps the old voice when it fails. The page follows the strip's state (enrolPhrases,
// enrolProblem, enrolOutcome), which the offscreen document publishes.

const voice = card(3, 'stepVoice', W.voiceTitle, WE.voiceTitle, W.voiceBody, WE.voiceBody, () => startVoice())
const voiceStep = document.createElement('p')
voiceStep.id = 'voiceStep'
voiceStep.className = 'note'
const voicePhrase = document.createElement('p')
voicePhrase.id = 'voicePhrase'
voicePhrase.className = 'phrase'
const voiceFeedback = document.createElement('p')
voiceFeedback.id = 'voiceFeedback'
voiceFeedback.className = 'note'
voiceFeedback.setAttribute('role', 'status')
const voiceRow = document.createElement('div')
voiceRow.className = 'choices'
voiceRow.append(
  choice('voiceStart', W.voiceStart, WE.voiceStart, () => startVoice()),
  choice('voiceFinish', W.voiceFinish, WE.voiceFinish, () => send({ type: 'utle-enrol-finish' })),
)
voice.section.append(voiceStep, voicePhrase, voiceFeedback, voiceRow, voice.result)

let reading = false
let readingSeen = false
function showVoicePhrase(at: number): void {
  const index = Math.min(at, ENROL_PHRASES.length - 1)
  voiceStep.textContent = W.voiceStep(index + 1, ENROL_PHRASES.length)
  voicePhrase.textContent = ENROL_PHRASES[index] ?? ''
}
function startVoice(): void {
  reading = true
  readingSeen = false
  show(voice, '')
  voiceFeedback.textContent = text.scriptStart
  showVoicePhrase(0)
  send({ type: 'utle-enrol-script', phrases: ENROL_PHRASES.length })
}

// ---------- 4. Proovi minu häält ----------

const check = card(4, 'stepCheck', W.testTitle, WE.testTitle, W.testBody, WE.testBody, () => startCheck())
const checkSay = document.createElement('p')
checkSay.id = 'checkSay'
checkSay.className = 'phrase'
checkSay.textContent = `${text.voiceTestSay} „${VERIFY_PHRASES[1] ?? ''}“`
const checkRow = document.createElement('div')
checkRow.className = 'choices'
checkRow.append(choice('checkStart', W.testStart, WE.testStart, () => startCheck()))
check.section.append(checkSay, checkRow, check.result)

let testsSeen = -1
function startCheck(): void {
  show(check, text.voiceTestSay)
  send({ type: 'utle-voice-test' })
}

// ---------- 5. Kuula ainult mind ----------

const guard = card(5, 'stepGuard', W.guardTitle, WE.guardTitle, W.guardBody, WE.guardBody, () => void guardOn())
const guardOnButton = choice('guardOn', W.guardOn, W.guardOnSub, () => void guardOn())
const guardAllButton = choice('guardAll', W.guardAll, W.guardAllSub, () => void guardAll())
const guardRow = document.createElement('div')
guardRow.className = 'choices'
guardRow.append(guardOnButton, guardAllButton)
guard.section.append(guardRow, guard.result)

/** Round 11 (F1): the readiness the offscreen document last reported (the strip state's voiceReady). */
let voiceReady: GuardReadiness | undefined
/** Whether only-owner is in force now (guardOn): the voice test knew him, or the server says ready. */
let guardInForce = false

/**
 * Round 11 (F1, 31.7): "Lülita sisse" is kept as his wish (onlyOwnerWanted) at any time, but the
 * mode is in force only once the voice test knew him (or the server says the voice is ready): with
 * no voice the gate would drop everything he says, and nothing by voice could undo it. Until then
 * the card says it waits, and every voice is heard.
 */
async function guardOn(): Promise<void> {
  const store = guardStore(true, done.check ? 'ready' : voiceReady)
  await chrome.storage.local.set({ ...store }).catch(() => undefined)
  guardChoice = 'owner'
  guardInForce = store.onlyOwner
  guardOnButton.setAttribute('aria-pressed', 'true')
  guardAllButton.setAttribute('aria-pressed', 'false')
  show(guard, store.onlyOwner ? W.guardOnDone : text.guardWaiting, store.onlyOwner)
  mark(guard, true)
}

/** All voices: allowed at any time, and said plainly to be without protection. */
async function guardAll(): Promise<void> {
  await chrome.storage.local.set({ ...guardStore(false, voiceReady) }).catch(() => undefined)
  guardInForce = false
  guardChoice = 'all'
  guardOnButton.setAttribute('aria-pressed', 'false')
  guardAllButton.setAttribute('aria-pressed', 'true')
  show(guard, W.guardAllDone)
  mark(guard, true)
}

/** The strip's state, published by the offscreen document: the phrases, their problems, the outcome, the voice test. */
function followVoice(state: StripState | undefined): void {
  if (!state) return
  // Round 11 (F1): a wish that waited is put in force once the voice is ready, and the card says so.
  voiceReady = readinessFrom(state.voiceReady)
  if (guardChoice === 'owner' && !guardInForce && voiceReady === 'ready') void guardOn()
  if (reading) {
    if (state.enrolPhrases >= 0) {
      readingSeen = true
      showVoicePhrase(state.enrolPhrases)
      voiceFeedback.textContent = state.enrolProblem !== '' ? phraseLine(state.enrolProblem, text) : text.scriptStart
    } else if (readingSeen) {
      reading = false
      voiceFeedback.textContent = ''
      done.voice = state.enrolOutcome === 'ok'
      show(voice, state.line, done.voice)
      mark(voice, done.voice)
    }
  }
  if (testsSeen < 0) testsSeen = state.voiceTests
  else if (state.voiceTests > testsSeen) {
    testsSeen = state.voiceTests
    const result = state.voiceTest
    if (result === 'recognised' || result === 'not_recognised' || result === 'too_short' || result === 'noisy' || result === 'unavailable') {
      done.check = result === 'recognised'
      show(check, voiceTestLine(result, text), done.check)
      mark(check, done.check)
      if (done.check && guardChoice === 'owner' && !guardInForce) void guardOn()
    }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes[STATE_KEY]) return
  followVoice(changes[STATE_KEY].newValue as StripState | undefined)
})
void chrome.storage.session.get(STATE_KEY).then((stored) => followVoice(stored[STATE_KEY] as StripState | undefined))

// ---------- 6. Proovi ----------

const demoCard = card(6, 'stepTry', W.tryTitle, WE.tryTitle, W.tryBody, WE.tryBody, () => armDemo())
const demo = document.createElement('textarea')
demo.id = 'demo'
demo.rows = 2
demo.setAttribute('aria-label', W.tryTitle)
const demoRow = document.createElement('div')
demoRow.className = 'choices'
demoRow.append(choice('demoArm', W.tryArm, WE.tryArm, () => armDemo()))
demoCard.section.append(demo, demoRow, demoCard.result)
show(demoCard, W.tryWaiting)

/** The demo box is the armed box: dictation goes there (page.ts reads the same armed field). */
function armDemo(): void {
  armElement(demo)
  demo.focus()
}

// A final has landed when the words have stood still for DEMO_SETTLE_MS (previews change as he speaks).
let lastText = ''
let changedAt = Date.now()
setInterval(() => {
  const now = demo.value
  if (now !== lastText) {
    lastText = now
    changedAt = Date.now()
    return
  }
  if (done.demo || now.trim() === '' || Date.now() - changedAt < DEMO_SETTLE_MS) return
  done.demo = true
  show(demoCard, W.tryWorks, true)
  mark(demoCard, true)
}, 200)

// ---------- 5. Valmis ----------

const ready = card(7, 'stepReady', W.readyTitle, WE.readyTitle, W.readyBody, WE.readyBody, () => void openHelp())
const list = document.createElement('ul')
list.className = 'examples'
for (const example of text.examples.slice(0, 3)) {
  const li = document.createElement('li')
  li.textContent = example
  list.append(li)
}
const readyRow = document.createElement('div')
readyRow.className = 'choices'
readyRow.append(
  choice('readyHelp', W.help, WE.help, () => void openHelp()),
  choice('readySettings', text.settings, en.settings, () => void chrome.runtime.openOptionsPage()),
)
ready.section.append(list, readyRow, ready.result)
readyCard = ready

/** Abi: the help page (30.2). */
async function openHelp(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL('help.html'), active: true })
}

function readyCheck(): void {
  if (readyCard === null) return
  const all = done.mic && done.server && done.demo
  readyCard.section.dataset.done = String(all)
  // Round 10 (31.7): the last card says how the voice is set: protected only when he turned it on after the test knew him.
  const voiceLine = guardChoice === 'owner' ? ` ${guardInForce ? W.guardOnDone : text.guardWaiting}` : guardChoice === 'all' ? ` ${W.guardAllDone}` : ''
  show(readyCard, all ? `${W.readyDone}${voiceLine}` : '', all)
}

// ---------- start ----------

readyCheck()
armDemo()
void micOnLoad()
// Round 10 (31.7): "õpi mu hääl uuesti" opens welcome.html#voice: the phrases start at once.
if (window.location.hash === '#voice') {
  voice.section.scrollIntoView({ block: 'start' })
  startVoice()
}
// The server as stored is tried at once, so the card says where things stand.
void testServer()

mountStrip()

// Page commands from the service worker, for this tab only (as on the new-tab page).
let myId: number | null = null
const myTab: Promise<number | null> = chrome.tabs.getCurrent().then(
  (tab) => (myId = tab?.id ?? -1),
  () => (myId = -1),
)
const answer = async (message: ToPage, reply: (result: unknown) => void): Promise<void> => {
  const utle = globalThis.__utle
  reply(utle ? await utle.run(message.command) : { ok: false, code: 'failed', message: 'The page script is missing.' })
}
chrome.runtime.onMessage.addListener((message: ToPage, _sender, reply) => {
  if (!message || message.type !== 'utle-page-run') return false
  if (myId !== null && myId !== message.tabId) return false
  void myTab.then((id) => {
    if (id === message.tabId) void answer(message, reply)
  })
  return true
})
