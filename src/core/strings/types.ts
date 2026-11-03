import type { BrowserCommand, BrowserFailure } from '../../browser/protocol.ts'
import type { SavedKind } from '../saved.ts'

/**
 * Every line a person can read in Ütle, in one table keyed by language, so a native speaker
 * proofreads one file. Estonian is the default (docs/ARCHITECTURE.md section 20.3).
 */
export type Lang = 'et' | 'en'

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
  /** `message` is the page's failure message (lane EXIT: a search field behind an open dialog names its buttons there). */
  browserFailed(command: BrowserCommand, code: BrowserFailure, message?: string): string

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
    /** Round 10 (33.4): a timed slow scroll ran its time out. */
    scrollEnded: string
    /** A long sentence typed into the box was judged a single command: the words stay, nothing runs. */
    keptWords: string
    /** A single-line field waits for the model; it did not answer, so nothing was typed. */
    fieldUnverified: string
    // Round 6 (Minu andmed, 26.2): a saved value typed, which one, gone, the hint, the settings page not in front.
    /** "Kirjutasin: X (minu e-post). Ütle „valmis“, „edasi“ või „vale“." */
    insertedSaved(text: string, name: string): string
    /** Round 11 (F5, 26.8): a saved contact's address typed into To: the name first. */
    insertedContact(name: string, address: string): string
    /** Round 11 (F5): a new mail opened to a saved contact. */
    contactMail(name: string, address: string): string
    /** Round 11 (F5): "vale" in a read-back: the field is cleared and the next utterance is spelled. */
    wrongCleared: string
    /** "Kumb: a või b?" (two), "Milline: a, b või c?" (more). */
    whichSaved(names: readonly string[]): string
    /** Round 10 (#5, 34.4): the tie: "Kumb: 1 Ava, 2 Ava kiri?". */
    whichItem(names: readonly string[]): string
    /** Round 10 (#5, 34.3): added to the line when a site opened beside a login in progress. */
    beside: string
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
    barSmall: string
    barNormal: string
    barLarge: string
    micSide: string
    micSideEn: string
    micLeft: string
    micRight: string
    startHidden: string
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
    // The owner's voice (round 4, VOICE lane).
    /** The group on the options page. */
    myVoice: string
    myVoiceEn: string
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
    // Round 10 (ARCHITECTURE 31.5): an utterance denied for any reason but another voice.
    voiceUnverified: string
    /** insufficient_audio: too little speech to check the voice. */
    voiceTooShort: string
    /** model_unavailable: the voice cannot be checked right now (no speaker model, or a speech engine without one). */
    voiceUnsupported: string
    /** Round 11 (F1, 31.5): profile_missing: no voice is taught yet; never the retrain line. */
    voiceNoProfile: string
    /** Round 11 (F1): with voiceNoProfile, where to teach it: the bar's settings button (voice cannot open it while the gate drops everything). */
    voiceNoProfileHow: string
    /** Round 11 (F1): model_mismatch: the voice was taught with another model and must be taught again. */
    voiceMismatch: string
    /** Round 11 (F1, 31.7): he chose only-my-voice, but no voice is ready yet: the wish is kept, every voice is heard. */
    guardWaiting: string
    // Round 10 (31.7): onboarding and readiness.
    /** A read phrase was not counted: why, and to read it again. Round 11 (F2): slow, the computer is behind: wait, nothing is lost. */
    phraseProblem: Record<'too_short' | 'too_quiet' | 'clipped' | 'model_error' | 'slow', string>
    /** An enrolment replaced nothing: why; the old voice stays. */
    enrolFailedWhy: Record<'too_few_phrases' | 'too_little_speech' | 'held_out_failed' | 'write_failed' | 'model_unavailable', string>
    /** An enrolment passed the held-out check. */
    enrolVerified(phrases: number, held: number): string
    /** Whether only-owner protects right now; only `ready` says it does. */
    readiness: Record<'ready' | 'no_profile' | 'needs_retraining' | 'model_unavailable' | 'model_mismatch', string>
    /** "Proovi minu häält": the answer. */
    voiceTest: Record<'recognised' | 'not_recognised' | 'too_short' | 'noisy' | 'unavailable', string>
    /** What to say for the voice test. */
    voiceTestSay: string
    voiceDeleted: string
    voiceDeleteFailed: string
    /** The settings page: delete the voice. */
    deleteVoice: string
    deleteVoiceEn: string
    /** The settings page: run the voice test. */
    testVoice: string
    testVoiceEn: string
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
    serverOk(speech: { local: boolean }, understanding: boolean): string
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
    /** Round 10 (32.1): ACTIVE ended ("aitab", the bare word, or 20 s of silence): back to waiting for the word. */
    passive(word: string): string
    /** Round 10 (32.1): the bare word woke it: ACTIVE, every final is his. */
    active: string
    /** Round 10 (32.1, 32.3): finals not meant for Ütle (PASSIVE, or the addressee check said ignore), counted quietly. */
    notForMe(count: number): string
    /** Round 10 (32.2): wake mode with a hosted server or a cloud recogniser would send the room's audio away: it does not start. */
    uploadsOff: string
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
    // Round 10 (31.7): the voice first: the phrases, the test, the choice.
    voiceStart: string
    voiceFinish: string
    voiceStep(at: number, of: number): string
    testTitle: string
    testBody: string
    testStart: string
    guardTitle: string
    guardBody: string
    guardOn: string
    guardOnSub: string
    guardAll: string
    guardAllSub: string
    guardOnDone: string
    guardAllDone: string
    readyTitle: string
    readyBody: string
    readyDone: string
    help: string
    menuWelcome: string
    menuSettings: string
    menuHelp: string
  }
}
