import type { BrowserCommand, BrowserFailure, MediaAction, PressableKey } from '../browser/protocol.ts'
import type { SavedKind } from './saved.ts'
import type { FormatStyle } from '../browser/protocol.ts'
import { HELP_EXAMPLES, HELP_EXAMPLES_EN, PHRASE_GROUPS } from './phrases.ts'

/**
 * Every line a person can read in Ütle, in one table keyed by language, so a native speaker
 * proofreads one file. Estonian is the default (docs/ARCHITECTURE.md section 20.3).
 */
export type Lang = 'et' | 'en'

export const DEFAULT_LANG: Lang = 'et'

/** The recogniser's BCP 47 tag for each language. */
export const LANG_TAG: Record<Lang, string> = { et: 'et-EE', en: 'en-US' }

/** The interface language for a recogniser tag. Anything Estonian is Estonian, the rest English. */
export function langOfTag(tag: string): Lang {
  return tag.toLowerCase().startsWith('et') ? 'et' : 'en'
}

export interface Strings {
  // What the user can say next, per mode.
  promptListening: string
  promptThinking: string
  promptConfirming: string
  promptAsleep: string
  promptReading: string
  promptChoosing(count: number): string
  promptDraft: string
  promptConfirmSend: string
  promptSending: string

  // What the editor made of an utterance.
  waiting: string
  stillWorking: string
  nothingToConfirm: string
  noLongerFits: string
  saved: string
  asleep: string
  listeningAgain: string
  alreadyListening: string
  helpShown: string
  nothingToUndo: string
  undone(what: string): string
  lastEdit: string
  noParagraph(n: number): string
  paragraph(n: number): string
  readingParagraph(n: number): string
  discarded: string
  dropped: string
  nothingToChoose: string
  countToChoose(n: number): string
  didNotFit: string
  couldNotTell: string
  placeNotFound: string
  stoppedReading: string
  nothingRead: string

  // Local document commands.
  sayWhichToRead: string
  sayWhichToDelete: string
  noParagraphOf(n: number, total: number): string
  paragraphDeleted(n: number): string

  // Browser commands: while on the way, after success, after failure.
  browserDoing(command: BrowserCommand): string
  browserDone(command: BrowserCommand, tabTitle: string | null, hints: number | null): string
  browserFailed(command: BrowserCommand, code: BrowserFailure): string

  // Messages.
  draftStarted(to: string | null): string
  draftAlreadyOpen: string
  draftEmpty: string
  draftTextSummary: string
  answerFirst: string
  confirmSend(to: string | null, text: string): string
  sendYesOrNo: string
  sendCancelled: string
  sent(to: string | null): string
  sendFailed(reason: string): string
  draftDropped: string
  noDraft: string
  browserTimedOut: string
  sendTimedOut: string

  // In-page mode (section 21.1): what an utterance did to the site's message box.
  inpage: {
    sleeping: string
    resting: string
    pickField: string
    sayWho: string
    nothingToSend: string
    boxEmpty: string
    boxNotFound: string
    notInText(text: string): string
    replacing(from: string, to: string): string
    deletingWord: string
    deletingSentence: string
    /** Round 3: "kustuta sõna X" selects the word and deletes it. */
    deletingNamed(word: string): string
    clearing: string
    newLine: string
    mark(mark: string): string
    undoing: string
    written: string
    conversationOpen(name: string): string
    sent: string
    notSent(reason: string): string
    /** Section 21.3: what a misheard or inflected command was taken to be, before the usual line. */
    understood(text: string): string
    // M7.
    /** Neither the rules nor the model could tell what was meant. */
    notUnderstood: string
    /** The model is being asked. */
    thinking: string
    /** The free-form understanding is off (no key, no server). */
    modelOff: string
    /** Dictation with no armed box: where the words can go. */
    noPlaceToWrite: string
    // Round 3.
    /** Suffix on the line of an utterance that waited too long in the queue and got the rules alone. */
    catchingUp: string
    /** A verification came back as a command after the box had changed: nothing was touched. */
    lateCommand(say: string): string
    // Round 5 (fields).
    /** "numbritena": dictation is written as digits until "tavaliselt". */
    spellDigits: string
    spellWords: string
    /** What a one-line form field holds after typing, read back, with what to say next. */
    typedInto(text: string): string
    // Round 5 (BRAIN lane).
    /** The model is being asked with care (a long utterance or a chain): it takes longer. */
    thinkingLong: string
    /** The job's watchdog fired: everything of it was given up. */
    tookTooLong: string
    /** "katkesta": every job, chain and verification was dropped. */
    cancelled: string
    /** A long sentence typed into the box was judged a single command: the words stay, nothing runs. */
    keptWords: string
    /** A single-line field waits for the model; it did not answer, so nothing was typed. */
    fieldUnverified: string
    // Round 6 (Minu andmed, 26.2): a saved value typed, which one, gone, the hint, the settings page not in front.
    /** "Kirjutasin: X (minu e-post). Ütle „valmis“ või „edasi“." */
    insertedSaved(text: string, name: string): string
    /** "Kumb: a või b?" (two), "Milline: a, b või c?" (more). */
    whichSaved(names: readonly string[]): string
    savedMissing: string
    /** Added to the line when an armed field has a saved value of its kind: " Või ütle „minu e-post“." */
    savedHint(names: readonly string[]): string
    entryGone: string
    // ---------- document mode (29.2) ----------
    /** "saada" in a document: nothing is sent. */
    documentNoSend: string
    /** "loe viimane lause ette": the strip while the text is read aloud. */
    reading: string
  }

  // The interpreter.
  stillWorks: string
  unreachable: string
  tooSlow: string
  unreadable: string
  assistantFailed: string
  assistantRejected: string
  couldNotWork: string
  notSafe: string

  // Interface chrome.
  ui: {
    language: string
    docName: string
    draftName(to: string | null): string
    micTurnOff: string
    micTurnOn: string
    voiceCheck: string
    backToDocument: string
    noticeDemo: string
    noticeRehearsal: string
    noticeServerDown: string
    noticeNoSpeech: string
    noticeFakeBridge: string
    typeInstead: string
    say: string
    yes: string
    no: string
    microphone: string
    micListening: string
    micNotListening: string
    youCanSay: string
    sayList: ReadonlyArray<readonly [string, string]>
    changes: string
    undoHint: string
    startAgain: string
    document: string
    message: string
    recipient: string
    noRecipient: string
    emptyDraft: string
  }

  check: {
    title(language: string): string
    intro: string
    stop: string
    start: string
    continue: string
    startOver: string
    copy: string
    copied: string
    listening: string
    right: string
    wrong(n: number): string
    percentWrong: string
    ofWords(errors: number, words: number, finished: boolean): string
    report(language: string, errors: number, words: number, percent: number): string
    reportLine(n: number, expected: string, heard: string, errors: number): string
    noSpeech: string
  }

  // The extension's strip and its permission page (in-page mode, section 21.2).
  strip: {
    micLabel: string
    listening: string
    notListening: string
    resting: string
    sayPrompt: string
    modelUnreachable: string
    micBlocked: string
    permissionTitle: string
    permissionAsk: string
    permissionDone: string
    permissionRetry: string
    // The new-tab page (21.3), ext lane.
    newTabTitle: string
    newTabHint: string
    // The strip's controls and the pill (M7, ui lane).
    hide: string
    show: string
    settings: string
    thinking: string
    /** Example phrases, shown three at a time under the new tab's tiles. */
    examples: readonly string[]
    examplesLead: string
    // The options page (M7, ui lane). Estonian first, English as the second line.
    optionsTitle: string
    optionsHelp: string
    optionsHelpEn: string
    barHeight: string
    barHeightEn: string
    barSmall: string
    barNormal: string
    barLarge: string
    micSide: string
    micSideEn: string
    micLeft: string
    micRight: string
    startHidden: string
    startHiddenEn: string
    startShown: string
    startFolded: string
    advanced: string
    advancedEn: string
    asrUrl: string
    utleUrl: string
    save: string
    saved: string
    notAnAddress(value: string): string
    savedReload: string
    // Push-to-talk by looking (round 3, ptt lane).
    /** The microphone's label in gaze mode while it is off. */
    gazeOff: string
    /** The thin line under the done line when the speech server is behind by this many seconds. */
    lagLine(seconds: number): string
    listenMode: string
    listenModeEn: string
    listenToggle: string
    listenToggleEn: string
    listenGaze: string
    listenGazeEn: string
    gazeTarget: string
    gazeTargetEn: string
    gazeMic: string
    gazeMicEn: string
    gazeBar: string
    gazeBarEn: string
    speechEngine: string
    speechEngineEn: string
    engineLocal: string
    engineLocalEn: string
    engineSoniox: string
    engineSonioxEn: string
    engineNote: string
    engineNoteEn: string
    // The owner's voice (round 4, VOICE lane).
    /** The group on the options page. */
    myVoice: string
    myVoiceEn: string
    /** The button that starts enrolment. */
    teachVoice: string
    teachVoiceEn: string
    /** The two choices of the only-owner setting. */
    onlyOwner: string
    onlyOwnerEn: string
    everyone: string
    everyoneEn: string
    voiceNote: string
    voiceNoteEn: string
    /** The strip's lines: speak now, learnt, failed; and someone else's utterance was skipped. */
    enrolStart(seconds: number): string
    enrolDone: string
    enrolFailed: string
    foreign: string
    // Round 7 (SPEECH lane): strict mode and scripted enrolment.
    /** Said once after three dropped finals in a row. */
    foreignRetrain: string
    /** Scripted enrolment: the button, its sub-line, the line while reading, the step counter, the early end, and a thin profile. */
    teachScript: string
    teachScriptEn: string
    teachFree: string
    teachFreeEn: string
    scriptStart: string
    scriptStep(at: number, total: number): string
    scriptFinish: string
    scriptFinishEn: string
    enrolPhrasesDone(phrases: number): string
    enrolFew(phrases: number, enough: number): string
    // The hosted server (round 6, HOST lane, ARCHITECTURE 27.3).
    /** The settings page's section and its fields. */
    serverTitle: string
    serverAddress: string
    serverAddressHelp: string
    serverToken: string
    serverTest: string
    serverChecking: string
    /** The test answered: what the server has (the speech engines, understanding on or off). */
    serverOk(speech: { local: boolean; soniox: boolean }, understanding: boolean): string
    serverUnreachable: string
    serverWrongToken: string
    /** Round 7 (27.6): which voice profile the token is, after the test answered. */
    serverProfile(profile: { name: string; enrolled: boolean }): string
    /** The strip's standing line when the server answers 401. */
    badToken: string
    // ---------- the first run (30.1, ONBOARD lane) ----------
    /** The socket to a local address failed or was lost: said once per outage. */
    serverDownLocal: string
    /** The same for a hosted address (wss://, or any host but this computer). */
    serverDownHosted: string
    /** The socket is ready again after an outage: said once. */
    serverBack: string
    /** The connection dot's words: connected, connecting, down. */
    connConnected: string
    connConnecting: string
    connDown: string
    /** Round 9 (30.2.3): the help page. */
    helpTitle: string
    helpHint: string
    /** 30.1: the pill's title while the strip is folded because the page asks something. */
    askingFold: string
  }

  // Round 6 (Minu andmed, 26.5 and 26.6): the settings section and the voice entry flow.
  andmed: {
    title: string
    titleEn: string
    help: string
    helpEn: string
    empty: string
    /** "Ütle: minu e-post, mu meil" */
    sayLine(phrases: readonly string[]): string
    edit: string
    forget: string
    forgotten(name: string): string
    /** The buttons that start the voice flow. */
    add(kind: SavedKind): string
    kindName(kind: SavedKind): string
    /** The name a first item of a kind gets. */
    defaultName(kind: SavedKind): string
    formTitle: string
    formName: string
    formKind: string
    formValue: string
    formSave: string
    formMissing: string
    formSaved(name: string): string
    askKind: string
    askName: string
    nameTaken(name: string): string
    /** The value step's line. */
    stepValue: string
    suffixHint: string
    /** After each utterance of the value step: what is there now. */
    now(value: string, suffix: string): string
    readBack(spoken: string, suffix: string): string
    nothingYet: string
    needAt: string
    needDigit: string
    savedOk(name: string): string
    abandoned: string
    stepTitle: string
    suffixLabel: string
    /** The flow's two buttons, for the eyes. */
    done: string
    cancel: string
  }
  // ---------- wake word and places (29.4) ----------
  /** Round 8: the wake word mode and Minu kohad. */
  wake: {
    /** The strip's line when listening starts in wake mode. */
    prompt(word: string): string
    /** The dictation window closed ("aitab", or 20 s of silence). */
    closed: string
    /** The settings page: the mode's choice and the word's field. */
    listenWake: string
    listenWakeEn: string
    wordLabel: string
    wordHelp: string
    wordSave: string
    wordSaved(word: string): string
    /** A place opened by its noun. */
    opening(label: string): string
    /** The model named a place that is no longer set. */
    missing: string
    placesTitle: string
    placesTitleEn: string
    placesHelp: string
    placeNoun: string
    placeUrl: string
    placeAdd: string
    placeRemove: string
    placeAdded(noun: string): string
    placeRemoved(noun: string): string
    placeBad: string
    sayLine(noun: string): string
    /** Round 8 (29.4.3): saving the tab in front as a place, by voice. */
    placeSaved(noun: string, host: string): string
    placeAsk: string
    placeAskRemove: string
    placeNotSaved: string
    placeNotThere(noun: string): string
  }
  // ---------- end of wake word and places ----------

  // ---------- reading aloud (29.5) ----------
  read: {
    /** The amber line while a reading is in progress. */
    now: string
    onward: string
    stopped: string
    noVoice: string
    skipped: string
    ended: string
    nothing: string
    failed: string
    /** The settings page: "Loe riba ette" (readBar). */
    barTitle: string
    barOn: string
    barOff: string
    barNote: string
  }

  // ---------- the first run (30.1, ONBOARD lane): the welcome page and the toolbar menu ----------
  welcome: {
    title: string
    intro: string
    how: string
    done: string
    micTitle: string
    micBody: string
    micAsk: string
    micGranted: string
    micDenied: string
    serverTitle: string
    serverBody: string
    choiceLocal: string
    choiceLocalNote: string
    choiceHosted: string
    choiceHostedNote: string
    /** After "Ei saa ühendust.": what to do, by where the server is. */
    hintLocal: string
    hintHosted: string
    tryTitle: string
    tryBody: string
    tryArm: string
    tryWaiting: string
    tryWorks: string
    voiceTitle: string
    voiceBody: string
    voiceDone: string
    readyTitle: string
    readyBody: string
    readyDone: string
    help: string
    menuWelcome: string
    menuSettings: string
    menuHelp: string
  }
}

/** The address without scheme and www, or the search words of a Google search. */
function placeOf(url: string): { search: string | null; host: string } {
  const search = /^https:\/\/www\.google\.com\/search\?q=([^&]*)/.exec(url)
  if (search?.[1] !== undefined) {
    let words = search[1]
    try {
      words = decodeURIComponent(words.replace(/\+/g, ' '))
    } catch {
      // A malformed escape is shown as it is.
    }
    return { search: words, host: 'google.com' }
  }
  const host = /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(url)?.[1] ?? url
  return { search: null, host }
}

const KEY_ET: Record<PressableKey, string> = {
  Escape: 'Sulgen.',
  Enter: 'Kinnitan.',
  Tab: 'Järgmine väli.',
  Backspace: 'Kustutan tagant.',
  Delete: 'Kustutan eest.',
  ArrowLeft: 'Vasakule.',
  ArrowRight: 'Paremale.',
  ArrowUp: 'Üles.',
  ArrowDown: 'Alla.',
  Home: 'Rea algusesse.',
  End: 'Rea lõppu.',
  Undo: 'Võtan tagasi.',
  Redo: 'Teen uuesti.',
  SelectAll: 'Valin kõik.',
}

// ---------- document mode (29.2): what a format command does, for the strip ----------
const FORMAT_ET: Record<FormatStyle, string> = {
  bold: 'Paks kiri.',
  italic: 'Kaldkiri.',
  underline: 'Allajoonitud.',
  heading: 'Pealkiri.',
  normal: 'Tavaline tekst.',
  list: 'Loend.',
  paragraph: 'Uus lõik.',
}

const FORMAT_EN: Record<FormatStyle, string> = {
  bold: 'Bold.',
  italic: 'Italic.',
  underline: 'Underlined.',
  heading: 'Heading.',
  normal: 'Normal text.',
  list: 'Bulleted list.',
  paragraph: 'New paragraph.',
}
// ---------- end of document mode ----------

const KEY_EN: Record<PressableKey, string> = {
  Escape: 'Closing.',
  Enter: 'Confirming.',
  Tab: 'Next field.',
  Backspace: 'Deleting backwards.',
  Delete: 'Deleting forwards.',
  ArrowLeft: 'Left.',
  ArrowRight: 'Right.',
  ArrowUp: 'Up.',
  ArrowDown: 'Down.',
  Home: 'Start of the line.',
  End: 'End of the line.',
  Undo: 'Undoing.',
  Redo: 'Redoing.',
  SelectAll: 'Selecting everything.',
}

const MEDIA_ET: Record<MediaAction, string> = {
  play: 'Mängin.',
  pause: 'Paus.',
  toggle: 'Mängin või peatan.',
  mute: 'Vaigistan.',
  unmute: 'Heli tagasi.',
  volumeUp: 'Heli valjemaks.',
  volumeDown: 'Heli vaiksemaks.',
  fullscreen: 'Täisekraan.',
  exitFullscreen: 'Täisekraanist välja.',
  forward: 'Edasi kümme sekundit.',
  back: 'Tagasi kümme sekundit.',
}

const MEDIA_EN: Record<MediaAction, string> = {
  play: 'Playing.',
  pause: 'Paused.',
  toggle: 'Play or pause.',
  mute: 'Muted.',
  unmute: 'Sound back on.',
  volumeUp: 'Louder.',
  volumeDown: 'Quieter.',
  fullscreen: 'Full screen.',
  exitFullscreen: 'Leaving full screen.',
  forward: 'Forward ten seconds.',
  back: 'Back ten seconds.',
}

/** Round 8 (29.1): the line for a seek by an amount, "Edasi üks minut.", "Tagasi 90 sekundit.". */
function seekEt(action: MediaAction, seconds: number): string {
  const amount = seconds === 60 ? 'üks minut' : seconds % 60 === 0 ? `${seconds / 60} minutit` : seconds === 1 ? 'üks sekund' : `${seconds} sekundit`
  return `${action === 'back' ? 'Tagasi' : 'Edasi'} ${amount}.`
}

function seekEn(action: MediaAction, seconds: number): string {
  const amount = seconds === 60 ? 'one minute' : seconds % 60 === 0 ? `${seconds / 60} minutes` : seconds === 1 ? 'one second' : `${seconds} seconds`
  return `${action === 'back' ? 'Back' : 'Forward'} ${amount}.`
}

const ET: Strings = {
  promptListening: 'Ütle, mida muuta, või lõigu number.',
  promptThinking: 'Hetk.',
  promptConfirming: 'Ütle jah või ei või ainult parandatud sõna.',
  promptAsleep: 'Jätkamiseks ütle „ärka üles“.',
  promptReading: 'Lugemise lõpetamiseks ütle „stopp“.',
  promptChoosing: (count) => `Ütle number 1 kuni ${count} või ei.`,
  promptDraft: 'Ütle, mida kirjutada. Kui valmis, ütle „saada“.',
  promptConfirmSend: 'Ütle jah või ei.',
  promptSending: 'Saadan.',

  waiting: 'Kuulan.',
  stillWorking: 'Hetk, eelmine on veel pooleli.',
  nothingToConfirm: 'Pole midagi kinnitada.',
  noLongerFits: 'See ei sobi enam dokumenti. Midagi ei muutunud.',
  saved: 'Tehtud. Muudatus on märgitud.',
  asleep: 'Puhkan. Ma ei kuula.',
  listeningAgain: 'Kuulan.',
  alreadyListening: 'Kuulan juba.',
  helpShown: 'Siin on, mida saad öelda.',
  nothingToUndo: 'Pole midagi tagasi võtta.',
  undone: (what) => `Tagasi võetud: ${what}`,
  lastEdit: 'viimane muudatus',
  noParagraph: (n) => `Lõiku ${n} ei ole.`,
  paragraph: (n) => `Lõik ${n}.`,
  readingParagraph: (n) => `Loen lõiku ${n}.`,
  discarded: 'Loobusin. Midagi ei muutunud.',
  dropped: 'Loobusin. Midagi ei muutunud.',
  nothingToChoose: 'Pole midagi valida.',
  countToChoose: (n) => `Valikuid on ${n}.`,
  didNotFit: 'See ei sobinud dokumenti. Midagi ei muutunud.',
  couldNotTell: 'Ma ei saanud aru, millist kohta mõtled. Ütle teisiti.',
  placeNotFound: 'Ma ei leidnud seda kohta.',
  stoppedReading: 'Lõpetasin lugemise.',
  nothingRead: 'Praegu ma midagi ei loe.',

  sayWhichToRead: 'Ütle, millist lõiku lugeda.',
  sayWhichToDelete: 'Ütle, millist lõiku kustutada.',
  noParagraphOf: (n, total) => `Lõiku ${n} ei ole. Dokumendis on ${total} lõiku.`,
  paragraphDeleted: (n) => `Kustutan lõigu ${n}.`,

  browserDoing(command) {
    switch (command.kind) {
      case 'ping':
        return 'Kontrollin laiendust.'
      case 'newTab':
        return 'Avan uue vahelehe.'
      case 'closeTab':
        return 'Sulgen vahelehe.'
      case 'switchTab': {
        const to = command.to
        if (to === 'next') return 'Järgmine vaheleht.'
        if (to === 'previous') return 'Eelmine vaheleht.'
        return 'index' in to ? `Vaheleht ${to.index}.` : `Otsin vahelehte: ${to.query}.`
      }
      case 'goTo': {
        const place = placeOf(command.url)
        return place.search !== null ? `Otsin: ${place.search}` : `Avan: ${place.host}`
      }
      case 'history':
        return command.direction === 'back' ? 'Tagasi.' : 'Edasi.'
      case 'reload':
        return 'Laadin lehe uuesti.'
      case 'scroll':
        if (command.mode === 'stop') return 'Kerimine seis.'
        if (command.mode === 'slow') return command.direction === 'up' ? 'Kerin aeglaselt üles.' : 'Kerin aeglaselt alla.'
        return { down: 'Kerin alla.', up: 'Kerin üles.', top: 'Lehe algusesse.', bottom: 'Lehe lõppu.' }[command.direction]
      case 'showHints':
        return 'Näitan numbreid.'
      case 'hideHints':
        return 'Peidan numbrid.'
      case 'clickHint':
        return `Vajutan ${command.number}.`
      case 'openConversation':
        return `Avan vestluse: ${command.name}.`
      case 'insertText':
        return 'Kirjutan sõnumi.'
      case 'readBox':
        return 'Loen sõnumikasti.'
      case 'setText':
        return 'Kirjutan.'
      case 'pressSend':
        return 'Saadan.'
      case 'readPage':
        return 'Vaatan lehte.'
      case 'clickItem':
        return 'Vajutan.'
      case 'focusItem':
        return 'Valin kasti.'
      case 'hover':
        return 'Näitan valikuid.'
      case 'contextMenu':
        return 'Avan menüü.'
      case 'scrollTo':
        return 'Kerin selle juurde.'
      case 'siteSearch':
        return `Otsin siit: ${command.query}`
      case 'media':
        return command.seconds === undefined ? MEDIA_ET[command.action] : seekEt(command.action, command.seconds)
      case 'pressKey':
        return KEY_ET[command.key]
      case 'caret':
        return 'Liigutan kursorit.'
      case 'select':
        return 'Valin teksti.'
      case 'typeText':
        return 'Kirjutan siia.'
      case 'clearField':
        return 'Tühjendan kasti.'
      case 'arm':
        return command.on ? 'Kirjutan siia.' : 'Siia enam ei kirjuta.'
      case 'bar':
        return command.show ? 'Näitan riba.' : 'Peidan riba.'
      case 'zoom':
        return command.direction === 'in' ? 'Suurendan.' : command.direction === 'out' ? 'Vähendan.' : 'Tavaline suurus.'
      case 'openSettings':
        return command.section === 'andmed' ? 'Avan minu andmed.' : command.section === 'welcome' ? 'Avan alustamise.' : 'Avan seaded.'
      case 'openHelp': {
        const group = PHRASE_GROUPS.find((g) => g.id === command.group)
        return group ? `Avan abi: ${group.name}.` : 'Avan abi.'
      }
      case 'savedEntry':
        return ''
      case 'format':
        return FORMAT_ET[command.style]
      // ---------- mail (29.3) ----------
      case 'compose':
        return command.to ? `Uus kiri: ${command.to}.` : 'Uus kiri.'
      case 'composeTo':
        return `Uus kiri: ${command.address}.`
      case 'mailField':
        return command.field === 'subject' ? `Teema: ${command.text ?? ''}`.trim() : 'Lisan koopia.'
      // Round 8 (29.4.3): the engine says these itself, with the address.
      case 'savePlace':
        return `Salvestan koha „${command.noun}“.`
      case 'removePlace':
        return `Eemaldan koha „${command.noun}“.`
      // ---------- reading aloud (29.5) ----------
      case 'read':
        return command.what === 'continue' ? ET.read.onward : command.what === 'stop' ? ET.read.stopped : ET.read.now
    }
  },
  browserDone(command, title, hints) {
    switch (command.kind) {
      case 'newTab':
        return title ? `Uus vaheleht: ${title}.` : 'Uus vaheleht on avatud.'
      case 'closeTab':
        return 'Vaheleht on suletud.'
      case 'switchTab':
        return title ? `Vaheleht: ${title}.` : ET.browserDoing(command)
      case 'goTo':
        return title ? `Avatud: ${title}.` : ET.browserDoing(command)
      case 'history':
        return title ? `${command.direction === 'back' ? 'Tagasi' : 'Edasi'}: ${title}.` : ET.browserDoing(command)
      case 'reload':
        return 'Leht on uuesti laaditud.'
      case 'showHints':
        return hints === null ? 'Numbrid on näha. Ütle number.' : `Numbrid on näha (${hints}). Ütle number.`
      case 'hideHints':
        return 'Numbrid on peidetud.'
      case 'clickHint':
        return `Vajutasin ${command.number}.`
      case 'clickItem':
        return 'Vajutatud.'
      case 'focusItem':
      case 'arm':
        return command.kind === 'arm' && !command.on ? 'Siia enam ei kirjuta.' : 'Kast on valitud. Räägi.'
      case 'siteSearch':
        return `Otsisin: ${command.query}`
      case 'clearField':
        return 'Kast on tühi.'
      default:
        return ET.browserDoing(command)
    }
  },
  browserFailed(command, code) {
    // ---------- reading aloud (29.5) ----------
    if (command.kind === 'read' && code === 'not_allowed') return ET.read.noVoice
    if (command.kind === 'read' && code === 'not_found') return command.what === 'continue' ? ET.read.ended : ET.read.nothing
    if (command.kind === 'read' && code === 'failed') return ET.read.failed
    switch (code) {
      case 'no_extension':
        return 'Brauseri laiendus ei vasta. Paigalda Ütle laiendus ja laadi see leht uuesti.'
      case 'no_target':
        return 'Ei leidnud brauseriakent. Ava Chrome’is tavaline aken.'
      case 'not_found':
        if (command.kind === 'clickHint') return `Numbrit ${command.number} ei ole.`
        if (command.kind === 'switchTab') return 'Sellist vahelehte ei ole.'
        if (command.kind === 'openConversation') return `Vestlust „${command.name}“ ei leitud.`
        if (command.kind === 'insertText') return 'Sõnumikasti ei leitud.'
        if (command.kind === 'clickItem' || command.kind === 'focusItem' || command.kind === 'hover' || command.kind === 'contextMenu' || command.kind === 'scrollTo') return 'Seda ei ole enam lehel. Ütle uuesti.'
        if (command.kind === 'siteSearch') return 'Sellel lehel ei ole otsingut. Ütle „otsi googlest“.'
        if (command.kind === 'media') return 'Siin ei ole videot.'
        if (command.kind === 'clearField' || command.kind === 'arm') return 'Ühtegi kasti ei ole valitud. Ütle „näita numbreid“ ja number.'
        if (command.kind === 'caret' || command.kind === 'select') return 'Seda teksti kastis ei ole.'
        if (command.kind === 'typeText') return 'Ühtegi kasti ei ole valitud, kuhu kirjutada.'
        // mail (29.3)
        if (command.kind === 'compose' || command.kind === 'composeTo') return 'Uut kirja ei saanud avada. Ava Gmail ja ütle uuesti.'
        if (command.kind === 'mailField') return 'Siin ei ole avatud kirja. Ütle „uus meil“.'
        return 'Seda ei leitud.'
      case 'not_allowed':
        return 'Seda lehte ei saa Ütle juhtida.'
      case 'failed':
        return 'See ei õnnestunud.'
    }
  },

  draftStarted: (to) => (to ? `Uus sõnum. Saaja: ${to}.` : 'Uus sõnum. See läheb brauseris avatud sõnumikasti.'),
  draftAlreadyOpen: 'Üks sõnum on juba pooleli. Ütle „saada“ või „katkesta sõnum“.',
  draftEmpty: 'Sõnum on veel tühi.',
  draftTextSummary: 'Sõnumi tekst.',
  answerFirst: 'Ütle enne jah või ei.',
  confirmSend: (to, text) => (to ? `Saaja: ${to}. „${text}“ Kas saadan?` : `Avatud sõnumikasti: „${text}“ Kas saadan?`),
  sendYesOrNo: 'Kas saadan? Ütle jah või ei.',
  sendCancelled: 'Ei saatnud. Sõnum on alles.',
  sent: (to) => (to ? `Saadetud. Saaja: ${to}. Dokument on tagasi.` : 'Saadetud. Dokument on tagasi.'),
  sendFailed: (reason) => `Ei saatnud. ${reason} Sõnum on alles.`,
  draftDropped: 'Sõnum on katkestatud. Dokument on tagasi.',
  noDraft: 'Pooleli sõnumit ei ole.',
  browserTimedOut: 'Brauser ei vastanud õigel ajal.',
  sendTimedOut: 'Brauser ei vastanud õigel ajal. Sõnum võis minna või mitte: vaata vestlus üle, enne kui uuesti saadad.',

  inpage: {
    sleeping: 'Puhkan. Midagi ei kirjutata.',
    resting: 'Puhkan. Jätkamiseks ütle „ärka üles“.',
    pickField: 'Kuhu kirjutada? Ütle „näita numbreid“ ja siis kasti number või ava vestlus, näiteks „kirjuta Marile“.',
    sayWho: 'Kellele? Ütle näiteks „kirjuta Marile“.',
    nothingToSend: 'Sõnumikast on tühi, pole midagi saata.',
    boxEmpty: 'Sõnumikast on tühi.',
    boxNotFound: 'Sõnumikasti ei leitud.',
    notInText: (text) => `„${text}“ ei ole tekstis.`,
    replacing: (from, to) => `„${from}“ asemel „${to}“.`,
    deletingWord: 'Kustutan viimase sõna.',
    deletingSentence: 'Kustutan viimase lause.',
    deletingNamed: (word) => `Kustutan sõna „${word}“.`,
    clearing: 'Kustutan kõik.',
    newLine: 'Uus rida.',
    mark: (mark) => ({ '.': 'Punkt.', ',': 'Koma.', '?': 'Küsimärk.', '!': 'Hüüumärk.' })[mark] ?? mark,
    undoing: 'Võtan tagasi.',
    written: 'Tehtud.',
    conversationOpen: (name) => `Vestlus avatud: ${name}.`,
    sent: 'Saadetud.',
    notSent: (reason) => `Ei saatnud. ${reason}`,
    understood: (text) => `Sain aru: „${text}“.`,
    notUnderstood: 'Ei saanud aru. Ütle teisiti, näiteks „ava youtube“ või „keri alla“, või ütle „abi“.',
    thinking: 'Mõtlen…',
    modelOff: 'Vaba kõne mõistmine on väljas: serveril pole Anthropicu võtit. Käsud töötavad.',
    noPlaceToWrite: 'Siin pole kuhu kirjutada. Ütle „kirjuta siia“ kasti peal, „näita numbreid“ ja number, või ava vestlus.',
    catchingUp: 'Jõuan järele…',
    lateCommand: (say) => `Hiljem: see oli käsk „${say}“, teksti ei muutnud.`,
    spellDigits: 'Kirjutan numbritena.',
    spellWords: 'Kirjutan tavaliselt.',
    typedInto: (text) => `Kirjutasin: ${text} (ütle „edasi“ või „valmis“)`,
    thinkingLong: 'Mõtlen pikemalt…',
    tookTooLong: 'Võttis liiga kaua, katkestasin.',
    cancelled: 'Katkestatud.',
    keptWords: 'Pikk lause jäi kasti, käsku ei täitnud.',
    fieldUnverified: 'Abiline ei vastanud, välja ei kirjutanud.',
    insertedSaved: (text, name) => `Kirjutasin: ${text} (${name}). Ütle „valmis“ või „edasi“.`,
    whichSaved: (names) => (names.length <= 2 ? `Kumb: ${names.join(' või ')}?` : `Milline: ${names.slice(0, -1).join(', ')} või ${names.at(-1) ?? ''}?`),
    savedMissing: 'Seda pole enam salvestatud. Ütle „minu andmed“.',
    savedHint: (names) => ` Või ütle ${names.map((n) => `„${n}“`).join(' või ')}.`,
    entryGone: 'Minu andmete leht pole ees. Ütle „minu andmed“.',
    documentNoSend: 'Dokumendis ei saadeta.',
    reading: 'Loen ette.',
  },

  stillWorks: 'Jah, ei ja tagasivõtmine töötavad edasi.',
  unreachable: 'Abiline ei vasta.',
  tooSlow: 'Abiline mõtles liiga kaua.',
  unreadable: 'Abilise vastusest ei saanud aru.',
  assistantFailed: 'Abiline ei saanud hakkama.',
  assistantRejected: 'Abiline keeldus päringust.',
  couldNotWork: 'Ma ei saanud sellest aru. Midagi ei muutunud.',
  notSafe: 'Sellest ei tulnud ohutut muudatust. Midagi ei muutunud.',

  ui: {
    language: 'Keel',
    docName: 'protokoll-5-oktoober.docx',
    draftName: (to) => (to ? `Sõnum: ${to}` : 'Uus sõnum'),
    micTurnOff: 'Lülita mikrofon välja',
    micTurnOn: 'Lülita mikrofon sisse',
    voiceCheck: 'Hääletest',
    backToDocument: 'Tagasi dokumendi juurde',
    noticeDemo: 'See on salvestatud demo. Keegi ei räägi, read mängivad ise.',
    noticeRehearsal: 'Proov: vastused tulevad demo stsenaariumist, mitte mudelilt.',
    noticeServerDown: 'Server ei vasta. Käivita see käsuga npm run dev.',
    noticeNoSpeech: 'Selles brauseris pole kõnetuvastust. Kasuta Chrome’i või kirjuta.',
    noticeFakeBridge: 'Brauseri laiendus on asendatud võltsiga: käsud ei jõua päris brauserisse.',
    typeInstead: 'Kirjuta rääkimise asemel',
    say: 'Ütle',
    yes: 'Jah',
    no: 'Ei',
    microphone: 'Mikrofon',
    micListening: 'Kuulan',
    micNotListening: 'Ei kuula',
    youCanSay: 'Saad öelda',
    sayList: [
      ['Mida muuta', 'Muuda eelarve tähtaeg reedeks'],
      ['Jah, ei või ainult parandatud sõna', 'Mitte kolmapäev. Teisipäev.'],
      ['Lõigu number', 'Kuus'],
      ['Kuhu minna', 'Mine eelarve juurde. Järgmine. Algusesse.'],
      ['Mida ette lugeda', 'Loe lõik neli. Stopp.'],
      ['Viimase muudatuse tagasivõtmiseks', 'Võta tagasi'],
      ['Brauseris', 'Uus vaheleht. Ava messenger. Mine tagasi. Keri alla.'],
      ['Nupud lehel', 'Näita numbreid. Vajuta viis.'],
      ['Sõnum', 'Kirjuta Marile, et jõuan kell kolm. Saada.'],
      ['Rahu saamiseks', 'Ära kuula. Ärka üles.'],
    ],
    changes: 'Muudatused',
    undoHint: 'Viimase võtad tagasi sõnadega „võta tagasi“.',
    startAgain: 'Alusta uuesti näidisdokumendiga',
    document: 'Dokument',
    message: 'Sõnum',
    recipient: 'Saaja',
    noRecipient: 'brauseris avatud sõnumikast',
    emptyDraft: 'Sõnum on tühi. Ütle, mida kirjutada.',
  },

  check: {
    title: (language) => `Hääletest, ${language}`,
    intro: 'Loe iga rida valjult ette. Kui rida on kuuldud, süttib järgmine. Tulemus näitab, kui suure osa sõnadest tuvastaja valesti kirja pani.',
    stop: 'Stopp',
    start: 'Alusta',
    continue: 'Jätka',
    startOver: 'Alusta otsast',
    copy: 'Kopeeri tulemus',
    copied: 'Kopeeritud',
    listening: 'Kuulan.',
    right: 'õige',
    wrong: (n) => `${n} viga`,
    percentWrong: 'protsenti sõnadest valesti',
    ofWords: (errors, words, finished) => `: ${errors} sõna ${words}-st${finished ? '.' : ' seni.'}`,
    report: (language, errors, words, percent) => `Ütle hääletest, ${language}: ${errors} sõna ${words}-st valesti (${percent} protsenti).`,
    reportLine: (n, expected, heard, errors) => `${n}. oodatud „${expected}“, kuuldud „${heard}“, vigu ${errors}`,
    noSpeech: 'Selles brauseris pole kõnetuvastust. Kasuta Chrome’i.',
  },

  strip: {
    micLabel: 'Mikrofon sisse või välja',
    listening: 'Kuulan',
    notListening: 'Ei kuula',
    resting: 'Puhkan',
    sayPrompt: 'Räägi. Sõnad lähevad sõnumikasti.',
    modelUnreachable: 'Kõnemudel ei vasta. Käivita see arvutis käsuga npm run dev.',
    micBlocked: 'Mikrofon on keelatud. Luba see avanenud lehel.',
    permissionTitle: 'Ütle vajab mikrofoni',
    permissionAsk: 'Vajuta brauseri küsimuses „Luba“. See leht sulgub ise.',
    permissionDone: 'Mikrofon on lubatud. Leht sulgub.',
    permissionRetry: 'Proovi uuesti',
    // The new-tab page (21.3), ext lane.
    newTabTitle: 'Uus vaheleht',
    newTabHint: 'Vaata paanile üks sekund, et see avada. Või ütle „näita numbreid“ ja number.',
    hide: 'Peida',
    show: 'Näita',
    settings: 'Seaded',
    thinking: 'Mõtlen',
    // Round 9 (30.2): drawn from src/core/phrases.ts, the phrases marked example.
    examples: HELP_EXAMPLES,
    examplesLead: 'Ütle:',
    optionsTitle: 'Ütle seaded',
    optionsHelp: 'Vaata nupule üks sekund või ütle „näita numbreid“ ja siis numbri. Valik salvestub kohe.',
    optionsHelpEn: 'Rest your eyes on a button for one second, or say “show numbers” and then the number. A choice is saved at once.',
    barHeight: 'Riba kõrgus',
    barHeightEn: 'Bar height',
    barSmall: 'Väike',
    barNormal: 'Tavaline',
    barLarge: 'Suur',
    micSide: 'Mikrofon',
    micSideEn: 'Microphone side',
    micLeft: 'Vasakul',
    micRight: 'Paremal',
    startHidden: 'Riba alguses',
    startHiddenEn: 'Bar at start',
    startShown: 'Nähtav',
    startFolded: 'Peidetud',
    advanced: 'Täpsemalt',
    advancedEn: 'Advanced',
    asrUrl: 'Kõnemudeli aadress',
    utleUrl: 'Ütle arenduslehe aadress',
    save: 'Salvesta',
    saved: 'Salvestatud.',
    notAnAddress: (value) => `See ei ole täielik aadress: ${value}`,
    savedReload: 'Salvestatud. Uus kõnemudeli aadress hakkab kehtima pärast laienduse uuesti laadimist.',
    gazeOff: 'Vaata siia ja räägi',
    lagLine: (seconds) => `Kõne jääb maha ${seconds} s`,
    listenMode: 'Kuulamine',
    listenModeEn: 'Listening',
    listenToggle: 'Lülitiga',
    listenToggleEn: 'Toggle: a click or a one-second look turns it on and off',
    listenGaze: 'Vaatamisega',
    listenGazeEn: 'By looking: it listens while you look at the microphone',
    gazeTarget: 'Vaatamise sihtmärk',
    gazeTargetEn: 'Gaze target',
    gazeMic: 'Mikrofon',
    gazeMicEn: 'The microphone square',
    gazeBar: 'Kogu riba',
    gazeBarEn: 'The whole bar',
    speechEngine: 'Kõnemudel',
    speechEngineEn: 'Speech model',
    engineLocal: 'Arvutis (TalTech)',
    engineLocalEn: 'On this computer (TalTech)',
    engineSoniox: 'Soniox (pilves)',
    engineSonioxEn: 'Soniox (in the cloud)',
    engineNote: 'Soniox vajab võtit arendusserveris (SONIOX_API_KEY). Valik hakkab kehtima järgmisel sisselülitamisel.',
    engineNoteEn: 'Soniox needs a key on the dev server (SONIOX_API_KEY). The choice takes effect the next time listening starts.',
    myVoice: 'Minu hääl',
    myVoiceEn: 'My voice',
    teachVoice: 'Õpeta mu hääl',
    teachVoiceEn: 'Teach it my voice: speak for 8 seconds',
    onlyOwner: 'Kuula ainult mind',
    onlyOwnerEn: 'Listen only to me',
    everyone: 'Kuula kõiki',
    everyoneEn: 'Listen to everyone',
    voiceNote: '„Kuula ainult mind“ vajab õpitud häält ja häälemudelit arendusserveris (npm run model). Ilma mudelita jäetakse vahele ainult vaiksem kõne. Valik hakkab kehtima järgmisel sisselülitamisel.',
    voiceNoteEn: '"Listen only to me" needs the learnt voice and the speaker model on the dev server (npm run model). Without the model only fainter speech is skipped. The choice takes effect the next time listening starts.',
    enrolStart: (seconds) => `Räägi ${seconds} sekundit tavalisel häälel…`,
    enrolDone: 'Hääl on õpitud.',
    enrolFailed: 'Hääle õppimine ei õnnestunud.',
    foreign: 'Keegi teine rääkis, jätsin vahele.',
    foreignRetrain: 'Kui see olid sina, õpeta hääl uuesti seadetes.',
    teachScript: 'Õpeta mu hääl lausetega',
    teachScriptEn: 'Teach it my voice: read 12 short sentences aloud',
    teachFree: 'Õpeta vabalt rääkides',
    teachFreeEn: 'Or speak freely for 8 seconds',
    scriptStart: 'Loe see lause tavalisel häälel. Järgmine tuleb ise.',
    scriptStep: (at, total) => `${at} / ${total}`,
    scriptFinish: 'Valmis',
    scriptFinishEn: 'Done: keep what was read so far',
    enrolPhrasesDone: (phrases) => `Hääl on õpitud ${phrases} lausest.`,
    enrolFew: (phrases, enough) => `Hääl on õpitud ainult ${phrases} lausest. Vähemalt ${enough} on kindlam: õpeta uuesti, kui ma sind ära ei tunne.`,
    // The hosted server (round 6, HOST lane).
    serverTitle: 'Server',
    serverAddress: 'Serveri aadress',
    serverAddressHelp: 'Jäta tühjaks, kui server jookseb samas arvutis.',
    serverToken: 'Serveri võti',
    serverTest: 'Proovi ühendust',
    serverChecking: 'Proovin…',
    serverOk: (speech, understanding) => {
      const engines = [speech.local ? 'TalTechi kõnemudel' : '', speech.soniox ? 'Soniox' : ''].filter((x) => x !== '')
      return `Ühendus töötab: ${engines.length > 0 ? engines.join(' ja ') : 'kõnemudelit pole'}, mõistmine ${understanding ? 'sees' : 'väljas'}.`
    },
    serverUnreachable: 'Ei saa ühendust.',
    serverWrongToken: 'Vale võti.',
    serverProfile: (profile) => `Profiil: ${profile.name}, hääl ${profile.enrolled ? 'õpetatud' : 'õpetamata'}.`,
    badToken: 'Serveri võti on vale.',
    // ---------- the first run (30.1, ONBOARD lane) ----------
    serverDownLocal: 'Kõneserver ei vasta. Palu abilisel see käivitada (npm run dev).',
    serverDownHosted: 'Kõneserver ei vasta. Kontrolli internetiühendust või palu abilisel vaadata serverit.',
    serverBack: 'Server vastab jälle.',
    connConnected: 'Ühendatud',
    connConnecting: 'Ühendan',
    connDown: 'Server ei vasta',
    helpTitle: 'Mida saab öelda',
    helpHint: 'Vaata rühmale üks sekund, et see avada. Või ütle „näita numbreid“ ja number. „loe ette“ loeb avatud rühma ette.',
    askingFold: 'Riba on peidus, kuni leht küsib.',
  },

  andmed: {
    title: 'Minu andmed',
    titleEn: 'My details: an e-mail, a phone number or an ID code, saved once and put into any field by voice.',
    help: 'Salvesta e-post, telefon või isikukood üks kord. Ütle „lisa uus e-post“ või vaata nupule. Pärast ütle vormi väljal „minu e-post“.',
    helpEn: 'Say “add a new email” or rest your eyes on a button. Afterwards say “my email” in a form field.',
    empty: 'Veel pole midagi salvestatud.',
    sayLine: (phrases) => `Ütle: ${phrases.join(', ')}`,
    edit: 'Muuda',
    forget: 'Unusta',
    forgotten: (name) => `Unustasin: ${name}.`,
    add: (kind) => `Lisa ${({ email: 'e-post', tel: 'telefon', code: 'isikukood', number: 'number', text: 'muu' } as const)[kind]}`,
    kindName: (kind) => ({ email: 'e-post', tel: 'telefon', code: 'isikukood', number: 'number', text: 'muu' } as const)[kind],
    defaultName: (kind) => ({ email: 'minu e-post', tel: 'minu telefon', code: 'minu isikukood', number: 'minu number', text: 'minu tekst' } as const)[kind],
    formTitle: 'Klaviatuuriga (abiline)',
    formName: 'Nimi',
    formKind: 'Liik',
    formValue: 'Väärtus',
    formSave: 'Salvesta',
    formMissing: 'Nimi ja väärtus on vaja.',
    formSaved: (name) => `Salvestatud: ${name}.`,
    askKind: 'Mida salvestada? Ütle „e-post“, „telefon“, „isikukood“ või „muu“.',
    askName: 'Mis nimega? Ütle näiteks „töö e-post“.',
    nameTaken: (name) => `„${name}“ on juba olemas. Ütle teine nimi.`,
    stepValue: 'Ütle tähthaaval; „punkt“ on ., „ät“ on @; „valmis“ salvestab.',
    suffixHint: 'Lõpu jaoks ütle „gmail“, „hotmail“ või „mail punkt ee“.',
    now: (value, suffix) => `Praegu: ${value}${suffix}`,
    readBack: (spoken, suffix) => `Praegu: ${spoken}${suffix === '' ? '' : `, lõpp ${suffix}`}.`,
    nothingYet: 'Midagi pole veel. Ütle tähthaaval.',
    needAt: 'Aadressis pole @. Ütle „ät“ või „gmail“.',
    needDigit: 'Numbrit pole veel. Ütle numbrid.',
    savedOk: (name) => `Salvestatud: ${name}. Ütle vormi väljal „${name}“.`,
    abandoned: 'Katkestatud, midagi ei salvestatud.',
    stepTitle: 'Lisan häälega',
    suffixLabel: 'lõpp',
    done: 'Valmis',
    cancel: 'Katkesta',
  },
  // ---------- wake word and places (29.4) ----------
  wake: {
    prompt: (word) => `Kuulan. Alusta sõnaga „${word}“.`,
    closed: 'Dikteerimine lõpetatud.',
    listenWake: 'Äratussõnaga',
    listenWakeEn: 'Wake word: always listening, acts on what starts with the word',
    wordLabel: 'Äratussõna · Wake word',
    wordHelp: 'Üks või kaks sõna. Kõik, mis ei alga selle sõnaga, jäetakse vahele.',
    wordSave: 'Salvesta sõna',
    wordSaved: (word) => `Äratussõna on nüüd „${word}“.`,
    opening: (label) => `Avan: ${label}.`,
    missing: 'Seda kohta pole enam seadetes.',
    placesTitle: 'Minu kohad',
    placesTitleEn: 'My places: a word opens a site',
    placesHelp: 'Ütle näiteks „vaata uudiseid“, „pane raadio käima“ või „mis ilm on“. Oma koha lisamiseks ava leht ja ütle „lisa koht uudised“; eemaldamiseks „eemalda koht uudised“. Sinu rida asendab vaikimisi rea.',
    placeNoun: 'Sõna (nt uudised)',
    placeUrl: 'Aadress (nt postimees.ee)',
    placeAdd: 'Lisa koht',
    placeRemove: 'Eemalda',
    placeAdded: (noun) => `Koht „${noun}“ salvestatud.`,
    placeRemoved: (noun) => `Koht „${noun}“ eemaldatud.`,
    placeBad: 'Kirjuta sõna ja aadress (https://… või nimi.ee).',
    sayLine: (noun) => `Ütle: ava ${noun}`,
    placeSaved: (noun, host) => `Koht „${noun}“ salvestatud: ${host}`,
    placeAsk: 'Ütle, mis sõnaga seda kohta kutsuda.',
    placeAskRemove: 'Ütle, mis koht eemaldada.',
    placeNotSaved: 'Seda lehte ei saa kohaks salvestada.',
    placeNotThere: (noun) => `Kohta „${noun}“ pole.`,
  },
  // ---------- end of wake word and places ----------
  // ---------- reading aloud (29.5) ----------
  read: {
    now: 'Loen ette…',
    onward: 'Loen edasi…',
    stopped: 'Lugemine seis.',
    noVoice: "Selles brauseris pole eesti häält. Edge'is on.",
    skipped: 'Jätsin ühe lause vahele.',
    ended: 'Lugemine on lõppenud.',
    nothing: 'Siin pole midagi ette lugeda.',
    failed: 'Ette lugeda ei õnnestunud.',
    barTitle: 'Loe riba ette',
    barOn: 'Loe ette',
    barOff: 'Ära loe',
    barNote: "Riba uued read loetakse eesti häälega ette (Edge'is on see hääl). Kui riba räägib, mikrofon ei kuula.",
  },
  // ---------- the first run (30.1, ONBOARD lane) ----------
  welcome: {
    title: 'Alustamine',
    intro: 'Viis sammu. Abiline teeb need üks kord, siis saab Ütlet kasutada ainult häälega.',
    how: 'Vaata nupule üks sekund, et seda vajutada. Või ütle „näita numbreid“ ja number.',
    done: 'Tehtud',
    micTitle: 'Mikrofon',
    micBody: 'Ütle kuulab mikrofoni kogu brauseris. Vajuta brauseri küsimuses „Luba“.',
    micAsk: 'Luba mikrofon',
    micGranted: 'Mikrofon on lubatud.',
    micDenied: 'Mikrofon on keelatud. Luba see aadressiriba lukuikoonist ja vajuta „Proovi uuesti“.',
    serverTitle: 'Kõneserver',
    serverBody: 'Ütle saadab kõne serverisse, mis selle ära tunneb. Vali, kus server jookseb.',
    choiceLocal: 'Samas arvutis',
    choiceLocalNote: 'Server käivitatakse selles arvutis käsuga npm run dev.',
    choiceHosted: 'Teises arvutis',
    choiceHostedNote: 'Aadressi ja võtme annab see, kes serverit haldab.',
    hintLocal: 'Käivita server selles arvutis käsuga npm run dev.',
    hintHosted: 'Kontrolli internetiühendust ning aadressi ja võtit.',
    tryTitle: 'Proovi',
    tryBody: 'Vajuta mikrofoni ja ütle: tere',
    tryArm: 'Kirjuta siia',
    tryWaiting: 'Sõnad tulevad siia kasti.',
    tryWorks: 'Töötab.',
    voiceTitle: 'Hääl',
    voiceBody: 'Valikuline. Kui Ütle õpib su häält, kuuletub ta ainult sulle.',
    voiceDone: 'Hääl on õpetatud.',
    readyTitle: 'Valmis',
    readyBody: 'Ütle näiteks:',
    readyDone: 'Kõik on valmis.',
    help: 'Abi',
    menuWelcome: 'Alustamine',
    menuSettings: 'Seaded',
    menuHelp: 'Abi',
  },
}

const EN: Strings = {
  promptListening: 'Say what to change, or a paragraph number.',
  promptThinking: 'Working on it.',
  promptConfirming: 'Say yes or no, or only the word to change.',
  promptAsleep: 'Say wake up to continue.',
  promptReading: 'Say stop to end the reading.',
  promptChoosing: (count) => `Say a number from 1 to ${count}, or no.`,
  promptDraft: 'Say what to write. Say send when it is ready.',
  promptConfirmSend: 'Say yes or no.',
  promptSending: 'Sending.',

  waiting: 'Waiting for you to speak.',
  stillWorking: 'One moment, still working on the last one.',
  nothingToConfirm: 'Nothing to confirm.',
  noLongerFits: 'That no longer fits the document. Nothing changed.',
  saved: 'Done. Saved as a tracked change.',
  asleep: 'Asleep. The microphone is ignored.',
  listeningAgain: 'Listening.',
  alreadyListening: 'Already listening.',
  helpShown: 'Here is what you can say.',
  nothingToUndo: 'Nothing to undo.',
  undone: (what) => `Undone: ${what}`,
  lastEdit: 'the last edit',
  noParagraph: (n) => `There is no paragraph ${n}.`,
  paragraph: (n) => `Paragraph ${n}.`,
  readingParagraph: (n) => `Reading paragraph ${n}.`,
  discarded: 'Discarded. Nothing changed.',
  dropped: 'Dropped. Nothing changed.',
  nothingToChoose: 'Nothing to choose.',
  countToChoose: (n) => `There are ${n} to choose from.`,
  didNotFit: 'That did not fit the document. Nothing changed.',
  couldNotTell: 'I could not tell which part you meant. Say it another way.',
  placeNotFound: 'I could not find that place.',
  stoppedReading: 'Stopped reading.',
  nothingRead: 'Nothing is being read.',

  sayWhichToRead: 'Say which paragraph to read.',
  sayWhichToDelete: 'Say which paragraph to delete.',
  noParagraphOf: (n, total) => `There is no paragraph ${n}. The document has ${total}.`,
  paragraphDeleted: (n) => `Paragraph ${n} deleted.`,

  browserDoing(command) {
    switch (command.kind) {
      case 'ping':
        return 'Checking for the extension.'
      case 'newTab':
        return 'Opening a new tab.'
      case 'closeTab':
        return 'Closing the tab.'
      case 'switchTab': {
        const to = command.to
        if (to === 'next') return 'Next tab.'
        if (to === 'previous') return 'Previous tab.'
        return 'index' in to ? `Tab ${to.index}.` : `Looking for the tab: ${to.query}.`
      }
      case 'goTo': {
        const place = placeOf(command.url)
        return place.search !== null ? `Searching: ${place.search}` : `Opening ${place.host}`
      }
      case 'history':
        return command.direction === 'back' ? 'Back.' : 'Forward.'
      case 'reload':
        return 'Reloading the page.'
      case 'scroll':
        if (command.mode === 'stop') return 'Scrolling stopped.'
        if (command.mode === 'slow') return command.direction === 'up' ? 'Scrolling slowly up.' : 'Scrolling slowly down.'
        return { down: 'Scrolling down.', up: 'Scrolling up.', top: 'To the top of the page.', bottom: 'To the end of the page.' }[command.direction]
      case 'showHints':
        return 'Showing numbers.'
      case 'hideHints':
        return 'Hiding the numbers.'
      case 'clickHint':
        return `Clicking ${command.number}.`
      case 'openConversation':
        return `Opening the conversation with ${command.name}.`
      case 'insertText':
        return 'Writing the message.'
      case 'readBox':
        return 'Reading the message box.'
      case 'setText':
        return 'Writing.'
      case 'pressSend':
        return 'Sending.'
      case 'readPage':
        return 'Looking at the page.'
      case 'clickItem':
        return 'Clicking.'
      case 'focusItem':
        return 'Picking the field.'
      case 'hover':
        return 'Showing its options.'
      case 'contextMenu':
        return 'Opening the menu.'
      case 'scrollTo':
        return 'Scrolling to it.'
      case 'siteSearch':
        return `Searching here: ${command.query}`
      case 'media':
        return command.seconds === undefined ? MEDIA_EN[command.action] : seekEn(command.action, command.seconds)
      case 'pressKey':
        return KEY_EN[command.key]
      case 'caret':
        return 'Moving the caret.'
      case 'select':
        return 'Selecting text.'
      case 'typeText':
        return 'Typing here.'
      case 'clearField':
        return 'Clearing the field.'
      case 'arm':
        return command.on ? 'Writing here.' : 'Not writing here any more.'
      case 'bar':
        return command.show ? 'Showing the bar.' : 'Hiding the bar.'
      case 'zoom':
        return command.direction === 'in' ? 'Zooming in.' : command.direction === 'out' ? 'Zooming out.' : 'Normal size.'
      case 'openSettings':
        return command.section === 'andmed' ? 'Opening my details.' : command.section === 'welcome' ? 'Opening the setup guide.' : 'Opening the settings.'
      case 'openHelp': {
        const group = PHRASE_GROUPS.find((g) => g.id === command.group)
        return group ? `Opening help: ${group.nameEn}.` : 'Opening help.'
      }
      case 'savedEntry':
        return ''
      case 'format':
        return FORMAT_EN[command.style]
      // ---------- mail (29.3) ----------
      case 'compose':
        return command.to ? `New mail: ${command.to}.` : 'New mail.'
      case 'composeTo':
        return `New mail: ${command.address}.`
      case 'mailField':
        return command.field === 'subject' ? `Subject: ${command.text ?? ''}`.trim() : 'Adding a Cc.'
      // Round 8 (29.4.3): the engine says these itself, with the address.
      case 'savePlace':
        return `Saving the place "${command.noun}".`
      case 'removePlace':
        return `Removing the place "${command.noun}".`
      // ---------- reading aloud (29.5) ----------
      case 'read':
        return command.what === 'continue' ? EN.read.onward : command.what === 'stop' ? EN.read.stopped : EN.read.now
    }
  },
  browserDone(command, title, hints) {
    switch (command.kind) {
      case 'newTab':
        return title ? `New tab: ${title}.` : 'New tab open.'
      case 'closeTab':
        return 'Tab closed.'
      case 'switchTab':
        return title ? `Tab: ${title}.` : EN.browserDoing(command)
      case 'goTo':
        return title ? `Opened: ${title}.` : EN.browserDoing(command)
      case 'history':
        return title ? `${command.direction === 'back' ? 'Back' : 'Forward'}: ${title}.` : EN.browserDoing(command)
      case 'reload':
        return 'Page reloaded.'
      case 'showHints':
        return hints === null ? 'Numbers are showing. Say one.' : `${hints} numbers are showing. Say one.`
      case 'hideHints':
        return 'Numbers hidden.'
      case 'clickHint':
        return `Clicked ${command.number}.`
      case 'clickItem':
        return 'Clicked.'
      case 'focusItem':
      case 'arm':
        return command.kind === 'arm' && !command.on ? 'Not writing here any more.' : 'Field picked. Speak.'
      case 'siteSearch':
        return `Searched: ${command.query}`
      case 'clearField':
        return 'The field is empty.'
      default:
        return EN.browserDoing(command)
    }
  },
  browserFailed(command, code) {
    // ---------- reading aloud (29.5) ----------
    if (command.kind === 'read' && code === 'not_allowed') return EN.read.noVoice
    if (command.kind === 'read' && code === 'not_found') return command.what === 'continue' ? EN.read.ended : EN.read.nothing
    if (command.kind === 'read' && code === 'failed') return EN.read.failed
    switch (code) {
      case 'no_extension':
        return 'The browser extension is not answering. Install the Ütle extension and reload this page.'
      case 'no_target':
        return 'No browser window found. Open an ordinary Chrome window.'
      case 'not_found':
        if (command.kind === 'clickHint') return `There is no number ${command.number}.`
        if (command.kind === 'switchTab') return 'There is no such tab.'
        if (command.kind === 'openConversation') return `No conversation with ${command.name} was found.`
        if (command.kind === 'insertText') return 'No message box was found.'
        if (command.kind === 'clickItem' || command.kind === 'focusItem' || command.kind === 'hover' || command.kind === 'contextMenu' || command.kind === 'scrollTo') return 'That is no longer on the page. Say it again.'
        if (command.kind === 'siteSearch') return 'This page has no search. Say "search google for".'
        if (command.kind === 'media') return 'There is no video here.'
        if (command.kind === 'clearField' || command.kind === 'arm') return 'No field is picked. Say "show numbers" and a number.'
        if (command.kind === 'caret' || command.kind === 'select') return 'That text is not in the field.'
        if (command.kind === 'typeText') return 'No field is picked to write in.'
        // mail (29.3)
        if (command.kind === 'compose' || command.kind === 'composeTo') return 'Could not open a new mail. Open Gmail and say it again.'
        if (command.kind === 'mailField') return 'There is no open mail here. Say "new email".'
        return 'That was not found.'
      case 'not_allowed':
        return 'Ütle cannot control this page.'
      case 'failed':
        return 'That did not work.'
    }
  },

  draftStarted: (to) => (to ? `New message to ${to}.` : 'New message. It goes into the message box open in the browser.'),
  draftAlreadyOpen: 'A message is already open. Say send, or cancel the message.',
  draftEmpty: 'The message is still empty.',
  draftTextSummary: 'The message text.',
  answerFirst: 'Say yes or no first.',
  confirmSend: (to, text) => (to ? `To ${to}: "${text}" Send it?` : `Into the open message box: "${text}" Send it?`),
  sendYesOrNo: 'Send it? Say yes or no.',
  sendCancelled: 'Not sent. The message is still here.',
  sent: (to) => (to ? `Sent to ${to}. The document is back.` : 'Sent. The document is back.'),
  sendFailed: (reason) => `Not sent. ${reason} The message is still here.`,
  draftDropped: 'Message cancelled. The document is back.',
  noDraft: 'There is no message open.',
  browserTimedOut: 'The browser did not answer in time.',
  sendTimedOut: 'The browser did not answer in time. The message may or may not have gone: look at the conversation before you send it again.',

  inpage: {
    sleeping: 'Resting. Nothing will be typed.',
    resting: 'Resting. Say "wake up" to continue.',
    pickField: 'Where should it go? Say "show numbers" and the number of the box, or open a conversation, for example "message Mari".',
    sayWho: 'To whom? Say, for example, "message Mari".',
    nothingToSend: 'The message box is empty, there is nothing to send.',
    boxEmpty: 'The message box is empty.',
    boxNotFound: 'No message box was found.',
    notInText: (text) => `"${text}" is not in the text.`,
    replacing: (from, to) => `"${to}" instead of "${from}".`,
    deletingWord: 'Deleting the last word.',
    deletingSentence: 'Deleting the last sentence.',
    deletingNamed: (word) => `Deleting the word "${word}".`,
    clearing: 'Deleting everything.',
    newLine: 'New line.',
    mark: (mark) => ({ '.': 'Full stop.', ',': 'Comma.', '?': 'Question mark.', '!': 'Exclamation mark.' })[mark] ?? mark,
    undoing: 'Undoing.',
    written: 'Done.',
    conversationOpen: (name) => `Conversation open: ${name}.`,
    sent: 'Sent.',
    notSent: (reason) => `Not sent. ${reason}`,
    understood: (text) => `Understood: "${text}".`,
    notUnderstood: 'I did not understand. Say it another way, for example "open youtube" or "scroll down", or say "help".',
    thinking: 'Thinking…',
    modelOff: 'Free-form understanding is off: the server has no Anthropic key. Commands still work.',
    noPlaceToWrite: 'There is nowhere to write here. Say "write here" on a field, "show numbers" and a number, or open a conversation.',
    catchingUp: 'Catching up…',
    lateCommand: (say) => `Later: "${say}" was a command, text left as is.`,
    spellDigits: 'Writing as digits.',
    spellWords: 'Writing as words.',
    typedInto: (text) => `Typed: ${text} (say "next" or "done")`,
    thinkingLong: 'Thinking it through…',
    tookTooLong: 'It took too long, I stopped it.',
    cancelled: 'Cancelled.',
    keptWords: 'The long sentence stays in the box; no command was run.',
    fieldUnverified: 'The assistant did not answer; nothing was typed into the field.',
    insertedSaved: (text, name) => `Typed: ${text} (${name}). Say "done" or "next".`,
    whichSaved: (names) => (names.length <= 2 ? `Which one: ${names.join(' or ')}?` : `Which one: ${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}?`),
    savedMissing: 'That is no longer saved. Say "my details".',
    savedHint: (names) => ` Or say ${names.map((n) => `"${n}"`).join(' or ')}.`,
    entryGone: 'The My details page is not in front. Say "my details".',
    documentNoSend: 'Nothing is sent from a document.',
    reading: 'Reading it out.',
  },

  stillWorks: 'Yes, no and undo still work.',
  unreachable: 'The assistant is unreachable.',
  tooSlow: 'The assistant took too long.',
  unreadable: 'The assistant sent an answer I could not read.',
  assistantFailed: 'The assistant failed.',
  assistantRejected: 'The assistant rejected the request.',
  couldNotWork: 'I could not work that out. Nothing changed.',
  notSafe: 'I could not turn that into a safe edit. Nothing changed.',

  ui: {
    language: 'Language',
    docName: 'minutes-5-october.docx',
    draftName: (to) => (to ? `Message to ${to}` : 'New message'),
    micTurnOff: 'Turn the microphone off',
    micTurnOn: 'Turn the microphone on',
    voiceCheck: 'Voice check',
    backToDocument: 'Back to the document',
    noticeDemo: 'This is the scripted demo. Nobody is speaking; the lines play by themselves.',
    noticeRehearsal: 'Rehearsal: answers come from the demo script, not from a model.',
    noticeServerDown: 'The server is not answering. Start it with npm run dev.',
    noticeNoSpeech: 'This browser has no speech recognition. Use Chrome, or type.',
    noticeFakeBridge: 'The browser extension is replaced by a fake: commands do not reach a real browser.',
    typeInstead: 'Type instead of speaking',
    say: 'Say',
    yes: 'Yes',
    no: 'No',
    microphone: 'Microphone',
    micListening: 'Listening',
    micNotListening: 'Not listening',
    youCanSay: 'You can say',
    sayList: [
      ['What to change', 'Change the budget deadline to Friday'],
      ['Yes, no, or only the corrected word', 'Not Wednesday. Tuesday.'],
      ['A paragraph number', 'Six'],
      ['Where to go', 'Go to budget. Next. Top.'],
      ['What to read aloud', 'Read paragraph four. Stop.'],
      ['To take the last edit back', 'Undo'],
      ['In the browser', 'New tab. Open messenger. Page back. Scroll down.'],
      ['Buttons on a page', 'Show numbers. Click five.'],
      ['A message', 'Write to Mari that I will be there at three. Send.'],
      ['To be left alone', 'Stop listening. Wake up.'],
    ],
    changes: 'Changes',
    undoHint: 'Say undo to take the last one back.',
    startAgain: 'Start again with the sample document',
    document: 'Document',
    message: 'Message',
    recipient: 'To',
    noRecipient: 'the message box open in the browser',
    emptyDraft: 'The message is empty. Say what to write.',
  },

  check: {
    title: (language) => `Voice check, ${language}`,
    intro: 'Read each line aloud. The next line lights up when one has been heard. The score is the share of words the recogniser got wrong.',
    stop: 'Stop',
    start: 'Start',
    continue: 'Continue',
    startOver: 'Start over',
    copy: 'Copy the result',
    copied: 'Copied',
    listening: 'Listening.',
    right: 'right',
    wrong: (n) => `${n} wrong`,
    percentWrong: 'percent of words wrong',
    ofWords: (errors, words, finished) => `: ${errors} of ${words}${finished ? '.' : ' so far.'}`,
    report: (language, errors, words, percent) => `Ütle voice check, ${language}: ${errors} of ${words} words wrong (${percent} percent).`,
    reportLine: (n, expected, heard, errors) => `${n}. expected "${expected}" heard "${heard}" errors ${errors}`,
    noSpeech: 'This browser has no speech recognition. Use Chrome.',
  },

  strip: {
    micLabel: 'Microphone on or off',
    listening: 'Listening',
    notListening: 'Not listening',
    resting: 'Resting',
    sayPrompt: 'Speak. The words go into the message box.',
    modelUnreachable: 'The speech model is not answering. Start it on this computer with npm run dev.',
    micBlocked: 'The microphone is blocked. Allow it on the page that opened.',
    permissionTitle: 'Ütle needs the microphone',
    permissionAsk: 'Press “Allow” in the browser’s question. This page closes itself.',
    permissionDone: 'The microphone is allowed. This page is closing.',
    permissionRetry: 'Try again',
    // The new-tab page (21.3), ext lane.
    newTabTitle: 'New tab',
    newTabHint: 'Rest your eyes on a tile for one second to open it. Or say “show numbers” and a number.',
    hide: 'Hide',
    show: 'Show',
    settings: 'Settings',
    thinking: 'Thinking',
    examples: HELP_EXAMPLES_EN,
    examplesLead: 'Say:',
    optionsTitle: 'Ütle settings',
    optionsHelp: 'Rest your eyes on a button for one second, or say “show numbers” and then the number. A choice is saved at once.',
    optionsHelpEn: '',
    barHeight: 'Bar height',
    barHeightEn: '',
    barSmall: 'Small',
    barNormal: 'Normal',
    barLarge: 'Large',
    micSide: 'Microphone',
    micSideEn: '',
    micLeft: 'Left',
    micRight: 'Right',
    startHidden: 'Bar at start',
    startHiddenEn: '',
    startShown: 'Shown',
    startFolded: 'Folded',
    advanced: 'Advanced',
    advancedEn: '',
    asrUrl: 'Speech model address',
    utleUrl: 'Address of the Ütle development page',
    save: 'Save',
    saved: 'Saved.',
    notAnAddress: (value) => `Not a full address: ${value}`,
    savedReload: 'Saved. Reload the extension for a new speech address to take effect.',
    gazeOff: 'Look here and speak',
    lagLine: (seconds) => `Speech is ${seconds} s behind`,
    listenMode: 'Listening',
    listenModeEn: '',
    listenToggle: 'Toggle',
    listenToggleEn: 'A click or a one-second look turns it on and off',
    listenGaze: 'By looking',
    listenGazeEn: 'It listens while you look at the microphone',
    gazeTarget: 'Gaze target',
    gazeTargetEn: '',
    gazeMic: 'Microphone',
    gazeMicEn: 'The microphone square',
    gazeBar: 'The whole bar',
    gazeBarEn: 'The whole bar',
    speechEngine: 'Speech model',
    speechEngineEn: '',
    engineLocal: 'On this computer (TalTech)',
    engineLocalEn: 'On this computer (TalTech)',
    engineSoniox: 'Soniox (in the cloud)',
    engineSonioxEn: 'Soniox (in the cloud)',
    engineNote: 'Soniox needs a key on the dev server (SONIOX_API_KEY). The choice takes effect the next time listening starts.',
    engineNoteEn: '',
    myVoice: 'My voice',
    myVoiceEn: '',
    teachVoice: 'Teach it my voice',
    teachVoiceEn: 'Speak for 8 seconds',
    onlyOwner: 'Listen only to me',
    onlyOwnerEn: '',
    everyone: 'Listen to everyone',
    everyoneEn: '',
    voiceNote: '"Listen only to me" needs the learnt voice and the speaker model on the dev server (npm run model). Without the model only fainter speech is skipped. The choice takes effect the next time listening starts.',
    voiceNoteEn: '',
    enrolStart: (seconds) => `Speak for ${seconds} seconds in your usual voice…`,
    enrolDone: 'Your voice is learnt.',
    enrolFailed: 'Learning your voice did not work.',
    foreign: 'Someone else spoke; skipped it.',
    foreignRetrain: 'If that was you, teach it your voice again in the settings.',
    teachScript: 'Teach it my voice with sentences',
    teachScriptEn: 'Read 12 short sentences aloud',
    teachFree: 'Teach it by speaking freely',
    teachFreeEn: 'Speak for 8 seconds',
    scriptStart: 'Read this sentence in your usual voice. The next one comes by itself.',
    scriptStep: (at, total) => `${at} / ${total}`,
    scriptFinish: 'Done',
    scriptFinishEn: '',
    enrolPhrasesDone: (phrases) => `Your voice is learnt from ${phrases} sentences.`,
    enrolFew: (phrases, enough) => `Your voice is learnt from only ${phrases} sentences. ${enough} or more is surer: teach it again if it does not know you.`,
    // The hosted server (round 6, HOST lane).
    serverTitle: 'Server',
    serverAddress: 'Server address',
    serverAddressHelp: 'Leave empty when the server runs on this computer.',
    serverToken: 'Server token',
    serverTest: 'Test the connection',
    serverChecking: 'Testing…',
    serverOk: (speech, understanding) => {
      const engines = [speech.local ? "TalTech's speech model" : '', speech.soniox ? 'Soniox' : ''].filter((x) => x !== '')
      return `Connected: ${engines.length > 0 ? engines.join(' and ') : 'no speech model'}, understanding ${understanding ? 'on' : 'off'}.`
    },
    serverUnreachable: 'Cannot connect.',
    serverWrongToken: 'Wrong token.',
    serverProfile: (profile) => `Profile: ${profile.name}, voice ${profile.enrolled ? 'learnt' : 'not learnt yet'}.`,
    badToken: 'The server token is wrong.',
    // ---------- the first run (30.1, ONBOARD lane) ----------
    serverDownLocal: 'The speech server is not answering. Ask your helper to start it (npm run dev).',
    serverDownHosted: 'The speech server is not answering. Check the internet connection or ask your helper to look at the server.',
    serverBack: 'The server is answering again.',
    connConnected: 'Connected',
    connConnecting: 'Connecting',
    connDown: 'The server is not answering',
    helpTitle: 'What you can say',
    helpHint: 'Rest your eyes on a group for one second to open it. Or say “show numbers” and a number. “read aloud” reads the open group.',
    askingFold: 'The bar is hidden while the page is asking.',
  },

  andmed: {
    title: 'My details',
    titleEn: '',
    help: 'Save an e-mail, a phone number or an ID code once. Say “add a new email” or rest your eyes on a button. Afterwards say “my email” in a form field.',
    helpEn: '',
    empty: 'Nothing is saved yet.',
    sayLine: (phrases) => `Say: ${phrases.join(', ')}`,
    edit: 'Change',
    forget: 'Forget',
    forgotten: (name) => `Forgot: ${name}.`,
    add: (kind) => `Add ${({ email: 'e-mail', tel: 'phone', code: 'ID code', number: 'number', text: 'other' } as const)[kind]}`,
    kindName: (kind) => ({ email: 'e-mail', tel: 'phone', code: 'ID code', number: 'number', text: 'other' } as const)[kind],
    defaultName: (kind) => ({ email: 'minu e-post', tel: 'minu telefon', code: 'minu isikukood', number: 'minu number', text: 'minu tekst' } as const)[kind],
    formTitle: 'By keyboard (a helper)',
    formName: 'Name',
    formKind: 'Kind',
    formValue: 'Value',
    formSave: 'Save',
    formMissing: 'A name and a value are needed.',
    formSaved: (name) => `Saved: ${name}.`,
    askKind: 'What to save? Say "email", "phone", "ID code" or "other".',
    askName: 'Under what name? Say for example "work email".',
    nameTaken: (name) => `"${name}" exists already. Say another name.`,
    stepValue: 'Spell it letter by letter; "dot" is ., "at" is @; "done" saves.',
    suffixHint: 'For the ending say "gmail", "hotmail" or "mail dot ee".',
    now: (value, suffix) => `Now: ${value}${suffix}`,
    readBack: (spoken, suffix) => `Now: ${spoken}${suffix === '' ? '' : `, ending ${suffix}`}.`,
    nothingYet: 'Nothing yet. Spell it letter by letter.',
    needAt: 'The address has no @. Say "at" or "gmail".',
    needDigit: 'No digits yet. Say the numbers.',
    savedOk: (name) => `Saved: ${name}. Say "${name}" in a form field.`,
    abandoned: 'Cancelled, nothing was saved.',
    stepTitle: 'Adding by voice',
    suffixLabel: 'ending',
    done: 'Done',
    cancel: 'Cancel',
  },
  // ---------- wake word and places (29.4) ----------
  wake: {
    prompt: (word) => `Listening. Start with "${word}".`,
    closed: 'Dictation ended.',
    listenWake: 'Wake word',
    listenWakeEn: 'Always listening, acts on what starts with the word',
    wordLabel: 'Wake word',
    wordHelp: 'One or two words. Anything that does not start with it is skipped.',
    wordSave: 'Save the word',
    wordSaved: (word) => `The wake word is now "${word}".`,
    opening: (label) => `Opening ${label}.`,
    missing: 'That place is no longer in the settings.',
    placesTitle: 'My places',
    placesTitleEn: 'A word opens a site',
    placesHelp: 'Say "show the news", "open the radio" or "what is the weather". To add your own, open the page and say "save this place as news"; "remove place news" removes it. Your row replaces the default one.',
    placeNoun: 'Word (e.g. news)',
    placeUrl: 'Address (e.g. postimees.ee)',
    placeAdd: 'Add the place',
    placeRemove: 'Remove',
    placeAdded: (noun) => `Place "${noun}" saved.`,
    placeRemoved: (noun) => `Place "${noun}" removed.`,
    placeBad: 'Type a word and an address (https://… or name.ee).',
    sayLine: (noun) => `Say: open ${noun}`,
    placeSaved: (noun, host) => `Place "${noun}" saved: ${host}`,
    placeAsk: 'Say what word to call this place.',
    placeAskRemove: 'Say which place to remove.',
    placeNotSaved: 'This page cannot be saved as a place.',
    placeNotThere: (noun) => `There is no place "${noun}".`,
  },
  // ---------- end of wake word and places ----------
  // ---------- reading aloud (29.5) ----------
  read: {
    now: 'Reading…',
    onward: 'Reading on…',
    stopped: 'Reading stopped.',
    noVoice: 'This browser has no Estonian voice; Edge has one.',
    skipped: 'I skipped one sentence.',
    ended: 'Nothing more to read.',
    nothing: 'Nothing here to read.',
    failed: 'Could not read aloud.',
    barTitle: 'Read the bar aloud',
    barOn: 'Read aloud',
    barOff: 'Silent',
    barNote: 'New lines of the bar are read in an Estonian voice (Edge has one). While the bar speaks, the microphone does not listen.',
  },
  // ---------- the first run (30.1, ONBOARD lane) ----------
  welcome: {
    title: 'Getting started',
    intro: 'Five steps. A helper does them once; after that Ütle is used by voice alone.',
    how: 'Rest your eyes on a button for one second to press it. Or say “show numbers” and a number.',
    done: 'Done',
    micTitle: 'Microphone',
    micBody: 'Ütle listens to the microphone for the whole browser. Press “Allow” in the browser’s question.',
    micAsk: 'Allow the microphone',
    micGranted: 'The microphone is allowed.',
    micDenied: 'The microphone is blocked. Allow it from the lock icon in the address bar, then press “Try again”.',
    serverTitle: 'The speech server',
    serverBody: 'Ütle sends speech to a server that recognises it. Choose where the server runs.',
    choiceLocal: 'On this computer',
    choiceLocalNote: 'The server is started on this computer with npm run dev.',
    choiceHosted: 'On another computer',
    choiceHostedNote: 'The address and the token come from whoever runs the server.',
    hintLocal: 'Start the server on this computer with npm run dev.',
    hintHosted: 'Check the internet connection, the address and the token.',
    tryTitle: 'Try it',
    tryBody: 'Press the microphone and say: tere',
    tryArm: 'Write here',
    tryWaiting: 'The words appear in this box.',
    tryWorks: 'It works.',
    voiceTitle: 'Your voice',
    voiceBody: 'Optional. Once Ütle has learnt your voice, it obeys only you.',
    voiceDone: 'The voice is learnt.',
    readyTitle: 'Ready',
    readyBody: 'Say, for example:',
    readyDone: 'Everything is ready.',
    help: 'Help',
    menuWelcome: 'Getting started',
    menuSettings: 'Settings',
    menuHelp: 'Help',
  },
}

export const STRINGS: Record<Lang, Strings> = { et: ET, en: EN }
