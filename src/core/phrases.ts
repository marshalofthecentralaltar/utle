/**
 * What can I say (docs/ARCHITECTURE.md 30.2): every phrase the product answers, grouped as the help
 * page shows them. This is the one source: extension/help.html renders it, the new-tab page rotates
 * its examples, scripts/phrases-doc.ts writes extension/README.md "What to say" from it, and
 * src/core/phrases.test.ts runs every Estonian form through the rule the entry names, so a phrase
 * that drifts from the rules fails the gate. Pure data.
 */

/** The rule that answers a phrase, as phrases.test.ts runs it. model: only the model understands it. */
export type PhraseRule = 'inpage' | 'browserIntent' | 'places' | 'placeVoice' | 'savedEntry' | 'readStop' | 'wake' | 'model'

/**
 * What is in front when the phrase is said: no box, a focused field he did not arm, an armed empty
 * message box, one with words in it, a one-line code / e-mail / phone field, a compose window's
 * field, a document, the numbered labels showing, an e-mail field with his saved values, Ütle
 * resting, or an empty box after "numbritena". For savedEntry: the voice entry of an e-mail on the settings page. For wake: the wake
 * word set, the window shut (or, for `open`, already open).
 */
export type PhraseContext = 'none' | 'focused' | 'empty' | 'text' | 'code' | 'email' | 'tel' | 'mail' | 'document' | 'hints' | 'saved' | 'asleep' | 'spelled' | 'entry' | 'wakeShut' | 'wakeOpen'

export interface Phrase {
  /** The Estonian forms; the first is shown large. Every one is tested. */
  readonly et: readonly string[]
  /** The English form, shown dim under. */
  readonly en: string
  /** One Estonian line: what happens. */
  readonly does: string
  /** The same line in English, for the README. */
  readonly doesEn: string
  readonly rule: PhraseRule
  /**
   * What the rule must produce: the kind of the first browser command, or for inpage sleep, wake,
   * cancel, speak, spell (how dictation is written changed), ask (left to the model), none; for
   * places goTo; for placeVoice save or remove; for savedEntry add, delete, read, save, cancel; for
   * readStop stop; for wake pass, open, close.
   */
  readonly expect: string
  /** Default none. */
  readonly context?: PhraseContext
  /** Shown among the new-tab page's rotating examples. */
  readonly example?: boolean
}

export interface PhraseGroup {
  /** The help page's hash: help.html#kerimine. */
  readonly id: string
  readonly name: string
  readonly nameEn: string
  /** The words after "abi" (or "help") that open the page at this group: "abi kerimine". */
  readonly say: readonly string[]
  /** One Estonian line under the name. */
  readonly intro: string
  /** The README's English paragraph under the group's table: how the phrases behave. */
  readonly noteEn: string
  readonly phrases: readonly Phrase[]
}

export const PHRASE_GROUPS: readonly PhraseGroup[] = [
  {
    id: 'sonumid',
    name: 'Sõnumid',
    nameEn: 'Messages',
    say: ['sõnumid', 'sõnum', 'sõnumite', 'messages'],
    intro: 'Räägi ja sõnad tulevad vestluse kasti. Mis on käsk, seda kasti ei kirjutata.',
    noteEn:
      'Words that may be a command ("saa...", "keri...") are not typed until they turn out not to be one. What the fixed phrases do not recognise goes to the model with what is on the page ("uus leht", "vajuta Mari", "pane vaiksemaks"); it needs `ANTHROPIC_API_KEY` on the server. Almost every dictation under 60 words is checked by the model after it is typed; the words stay unless the model says they were a command. Chains: say `siis`, `ja siis`, `ja`, `ning`, `seejärel` or `pärast seda` between goals; after a joining word Ütle waits 2.5 s for the rest, and a part that starts with `siis` within 2.5 s goes on from the last words. At most 16 page steps and 90 s in all, four steps and 15 s per goal; the strip shows "2/4 · …". Any other utterance stops the chain; a plain `saada` waits behind it. A message ("kirjuta et tulen homme") is never split. `saada` is never guessed from a misheard word: "sada" and "saata" are typed.',
    phrases: [
      { et: ['tulen homme kell viis'], en: '(anything that is not a command)', does: 'Mis pole käsk, kirjutatakse vestluse kasti.', doesEn: 'Typed into the message box.', rule: 'inpage', expect: 'setText', context: 'empty' },
      { et: ['kirjuta Marile', 'ava vestlus Mariga'], en: 'write to Mari, open chat with Mari', does: 'Avab vestluse Mariga.', doesEn: 'Opens the chat with Mari.', rule: 'inpage', expect: 'openConversation' },
      { et: ['kirjuta Marile, et jõuan kell viis'], en: 'tell Mari that I arrive at five', does: 'Avab vestluse Mariga ja kirjutab lause kasti. Ei saada.', doesEn: 'Opens the chat with Mari and writes the sentence. It does not send.', rule: 'inpage', expect: 'openConversation', example: true },
      { et: ['saada', 'saada ära', 'saadake', 'saadame'], en: 'send, send it', does: 'Saadab, mis kastis on.', doesEn: 'Sends what is in the box.', rule: 'inpage', expect: 'pressSend', context: 'text' },
      { et: ['mine whatsappi, siis ava Karini viimane sõnum'], en: "go to whatsapp, then open Karin's last message", does: 'Mitu sammu järjest; ütle „siis“ nende vahel. Vajab mudelit.', doesEn: 'A chain: the goals are done one after the other (needs the model).', rule: 'model', expect: 'ask' },
    ],
  },
  {
    id: 'parandamine',
    name: 'Parandamine',
    nameEn: 'Corrections',
    say: ['parandamine', 'parandus', 'parandused', 'corrections'],
    intro: 'Paranda kasti sõnu häälega, enne kui saadad.',
    noteEn:
      '`tagasi` alone undoes while there are words in the box, and goes back a page otherwise. `võta tagasi` is the whole-box undo. `kustuta sõna homme` and the keys work at the caret in the box in front; a word that is not in the box goes to the model instead (it may be a section of the page).',
    phrases: [
      { et: ['mitte kolm, vaid neli', 'kolme asemel neli'], en: 'not three but four', does: 'Viimane „kolm“ kastis muutub „neljaks“.', doesEn: 'The last "kolm" in the box becomes "neli".', rule: 'inpage', expect: 'setText', context: 'text' },
      { et: ['kustuta viimane sõna'], en: 'delete the last word', does: 'Kustutab viimase sõna.', doesEn: 'Removes the last word.', rule: 'inpage', expect: 'setText', context: 'text' },
      { et: ['kustuta viimane lause'], en: 'delete the last sentence', does: 'Kustutab viimase lause.', doesEn: 'Removes the last sentence.', rule: 'inpage', expect: 'setText', context: 'text' },
      { et: ['kustuta kõik', 'katkesta sõnum'], en: 'delete everything', does: 'Tühjendab kasti.', doesEn: 'Empties the box.', rule: 'inpage', expect: 'setText', context: 'text' },
      { et: ['uus rida'], en: 'new line', does: 'Alustab kastis uut rida.', doesEn: 'Adds a line break.', rule: 'inpage', expect: 'setText', context: 'text' },
      { et: ['punkt', 'koma'], en: 'full stop, comma', does: 'Lisab punkti või koma.', doesEn: 'Adds the mark.', rule: 'inpage', expect: 'setText', context: 'text' },
      { et: ['võta tagasi', 'tagasi'], en: 'undo', does: 'Paneb tagasi teksti, mis oli enne viimast muudatust.', doesEn: 'Puts back the text from before the last change.', rule: 'inpage', expect: 'setText', context: 'text' },
      { et: ['kustuta täht', 'kustuta kolm tähte', 'kustuta valitud'], en: 'delete a letter, delete three letters', does: 'Kustutab tähti kursori eest või valitud teksti.', doesEn: 'Backspace, once or the number of times said; the selection.', rule: 'inpage', expect: 'pressKey', context: 'text' },
      { et: ['kustuta ees'], en: 'delete ahead', does: 'Kustutab tähe kursori järel.', doesEn: 'The Delete key.', rule: 'inpage', expect: 'pressKey', context: 'text' },
      { et: ['kustuta sõna homme'], en: 'delete the word homme', does: 'Kustutab kastist sõna „homme“.', doesEn: 'Selects the word and deletes it.', rule: 'inpage', expect: 'select', context: 'text' },
      { et: ['tee uuesti'], en: 'redo', does: 'Teeb tagasi võetud muudatuse uuesti.', doesEn: 'Redo.', rule: 'inpage', expect: 'pressKey', context: 'text' },
    ],
  },
  {
    id: 'tekstis',
    name: 'Tekstis liikumine',
    nameEn: 'Moving in the text',
    say: ['tekstis liikumine', 'liikumine', 'tekst', 'kursor', 'editing'],
    intro: 'Liiguta kursorit, vali sõnu ja kirjuta keset teksti.',
    noteEn:
      'These work in the box in front, armed or focused. A space and a capital are added as the place needs when typing at the caret. `järgmine väli` (Tab) arms the field it lands in. A word that is not in the box goes to the model instead. On Google Docs only the keys and typing work (its editor is a canvas with no text to find in): `sõna tagasi`, `rea algusesse`, `kustuta täht`, `tee uuesti`, `kirjuta siia vahele …`; `võta tagasi` there needs the model to answer `pressKey Undo`. Tested on `fixtures/essay.html`, never on Docs itself.',
    phrases: [
      { et: ['mine algusesse', 'mine lõppu'], en: 'go to the start, go to the end', does: 'Viib kursori teksti algusesse või lõppu.', doesEn: 'The caret to the start or the end of the text.', rule: 'inpage', expect: 'caret', context: 'text' },
      { et: ['rea algusesse', 'rea lõppu'], en: 'start of the line, end of the line', does: 'Viib kursori rea algusesse või lõppu.', doesEn: 'The caret to the start or the end of the line.', rule: 'inpage', expect: 'caret', context: 'text' },
      { et: ['lause algusesse', 'lause lõppu'], en: 'start of the sentence, end of the sentence', does: 'Viib kursori lause algusesse või lõppu.', doesEn: 'The caret to the start or the end of the sentence.', rule: 'inpage', expect: 'caret', context: 'text' },
      { et: ['sõna tagasi', 'kolm sõna edasi'], en: 'word back, three words forward', does: 'Liigutab kursorit sõnade kaupa.', doesEn: 'The caret by words.', rule: 'inpage', expect: 'caret', context: 'text' },
      { et: ['mine sõna homme ette', 'mine sõna homme taha', 'pärast sõna homme', 'mine kooli juurde'], en: 'go before homme, go after homme', does: 'Viib kursori nimetatud sõna ette või taha.', doesEn: 'The caret before or after the word named.', rule: 'inpage', expect: 'caret', context: 'text' },
      { et: ['vali kõik', 'vali see sõna', 'vali see lause', 'vali see rida'], en: 'select all, select the sentence', does: 'Valib kogu teksti, sõna, lause või rea.', doesEn: 'Selects everything, the word, the sentence or the line.', rule: 'inpage', expect: 'select', context: 'text' },
      { et: ['vali viimane sõna', 'vali viimane lause', 'vali sõna homme', 'vali homme'], en: 'select the last word, select homme', does: 'Valib viimase sõna, viimase lause või nimetatud sõna.', doesEn: 'Selects the last word, the last sentence or the word named.', rule: 'inpage', expect: 'select', context: 'text' },
      { et: ['kirjuta siia vahele kell viis', 'lisa siia kell viis', 'sisesta kell viis'], en: 'insert hello', does: 'Kirjutab sõnad kursori kohale.', doesEn: 'Types at the caret.', rule: 'inpage', expect: 'typeText', context: 'text' },
      { et: ['vasakule', 'paremale kolm korda', 'üks rida üles', 'kaks rida alla'], en: 'arrow left, right three times, line up', does: 'Noole klahvid, üks või mitu korda.', doesEn: 'The arrow keys, once or the number of times said.', rule: 'inpage', expect: 'pressKey', context: 'text' },
      { et: ['järgmine väli'], en: 'next field', does: 'Liigub järgmisse välja ja valib selle.', doesEn: 'Tab, and arms the field it lands in.', rule: 'inpage', expect: 'pressKey', context: 'text' },
    ],
  },
  {
    id: 'vormid',
    name: 'Vormid',
    nameEn: 'Forms',
    say: ['vormid', 'vorm', 'väljad', 'väli', 'forms'],
    intro: 'Isikukood, telefon, e-post või PIN häälega, number numbri haaval.',
    noteEn:
      'Click the field (or `näita numbreid` and its number, or `kirjuta siia`), then say the digits one by one. The field\'s own type says what it is for (e-post, telefon, isikukood, PIN, summa); into a one-line field nothing is typed live: the words are checked first, then the field is filled whole and the bar reads it back, "Kirjutasin: 39021000001 (ütle „edasi“ või „valmis“)", a PIN as dots. `valmis` and `edasi` go to the next field and `kinnita` submits only in a one-line field he armed. A code said in two breaths joins up without a space. Tested on `fixtures/login.html`, a Smart-ID-like page, not on the real one.',
    phrases: [
      { et: ['kirjuta siia'], en: 'write here', does: 'Teeb fookuses välja kohaks, kuhu sõnad lähevad.', doesEn: 'Makes the focused field the place the words go.', rule: 'inpage', expect: 'arm', context: 'focused' },
      { et: ['kolm üheksa null kaks üks null null null null null üks', 'kakskümmend kolm'], en: 'three nine zero two', does: 'Koodi väljale tulevad numbrid: 39021000001, 23.', doesEn: 'Into a code, phone or number field: typed as digits.', rule: 'inpage', expect: 'setText', context: 'code' },
      { et: ['ralf punkt sepp ät gmail punkt com'], en: 'ralf dot sepp at gmail dot com', does: 'E-posti väljale tuleb ralf.sepp@gmail.com.', doesEn: 'Into an e-mail field: ralf.sepp@gmail.com.', rule: 'inpage', expect: 'setText', context: 'email' },
      { et: ['ät', 'sidekriips', 'alakriips', 'pluss'], en: 'at, hyphen, underscore, plus', does: 'Märgid @ - _ ja +; „punkt“ on punkt aadressi sees.', doesEn: 'The marks @ - _ and +; "punkt" is a dot inside the address.', rule: 'inpage', expect: 'setText', context: 'email' },
      { et: ['bee', 'ess', 'suur a'], en: 'letters by name', does: 'Tähed nime järgi; „suur a“ on suur täht.', doesEn: 'Letters by their names; "suur a" is a capital.', rule: 'inpage', expect: 'setText', context: 'email' },
      { et: ['pluss kolm seitse kaks viis viis viis'], en: 'plus three seven two', does: 'Telefoni väljale tuleb +372555.', doesEn: 'Into a phone field: +372555.', rule: 'inpage', expect: 'setText', context: 'tel' },
      { et: ['numbritena'], en: 'as digits', does: 'Kirjutab kõik numbritena, kuni ütled „tavaliselt“.', doesEn: 'Writes everything as digits until told otherwise.', rule: 'inpage', expect: 'spell', context: 'empty' },
      { et: ['tavaliselt'], en: 'normally', does: 'Kirjutab jälle tavaliselt.', doesEn: 'Back to ordinary writing.', rule: 'inpage', expect: 'spell', context: 'spelled' },
      { et: ['kirjuta kood 3902'], en: 'type code 3902', does: 'Kirjutab ühe väärtuse koodina, mudelit küsimata.', doesEn: 'One value as a code, without the model.', rule: 'inpage', expect: 'setText', context: 'code' },
      { et: ['sisesta e-post ralf ät gmail punkt com', 'kirjuta telefon viis viis viis'], en: 'enter email …, type phone …', does: 'Nimetab ühe korra, mis liiki väärtus tuleb.', doesEn: 'Names the kind for one utterance.', rule: 'inpage', expect: 'setText', context: 'email' },
      { et: ['valmis', 'olen valmis', 'edasi'], en: 'done, next', does: 'Vormi väljal: järgmine väli.', doesEn: 'In a form field: the next field.', rule: 'inpage', expect: 'pressKey', context: 'code' },
      { et: ['kinnita', 'logi sisse', 'sisesta'], en: 'submit, log in', does: 'Vormi väljal: saadab vormi nagu Enter.', doesEn: 'In a form field: submits the form, as Enter would.', rule: 'inpage', expect: 'pressKey', context: 'code' },
    ],
  },
  {
    id: 'kerimine',
    name: 'Kerimine',
    nameEn: 'Scrolling',
    say: ['kerimine', 'kerimise', 'keri', 'scrolling'],
    intro: 'Liiguta lehte üles ja alla.',
    noteEn:
      '`keri alla` and `keri üles` move 80% of the view, smoothly; `natuke` a third; `aeglaselt` a steady 90 px/s until stopped. While there are words in the box a one-word `aitab` is typed (it is a reply); `lõpeta kerimine` always stops. `keri edasi` and `keri tagasi` skip in the video. A command heard the Estonian way is still understood, and the amber line says what it took it to be ("Sain aru: „keri alla“").',
    phrases: [
      { et: ['keri alla', 'keri üles'], en: 'scroll down, scroll up', does: 'Kerib lehte peaaegu ekraani võrra.', doesEn: 'Scrolls most of a screen, smoothly.', rule: 'inpage', expect: 'scroll', example: true },
      { et: ['keri natuke alla', 'natuke üles', 'veidi alla'], en: 'scroll down a little', does: 'Kerib kolmandiku ekraani võrra.', doesEn: 'A third of a screen.', rule: 'inpage', expect: 'scroll' },
      { et: ['keri aeglaselt alla', 'keri tasa üles', 'aeglaselt alla'], en: 'scroll down slowly', does: 'Kerib aeglaselt, kuni ütled „stopp“.', doesEn: 'A steady slow scroll until stopped.', rule: 'inpage', expect: 'scroll' },
      { et: ['stopp', 'seis', 'aitab', 'lõpeta', 'lõpeta kerimine', 'kerimine seis'], en: 'stop', does: 'Peatab kerimise.', doesEn: 'Stops the scroll.', rule: 'inpage', expect: 'scroll' },
      { et: ['lehe algusesse', 'lehe lõppu'], en: 'scroll to the top, scroll to the bottom', does: 'Lehe algusesse või lõppu.', doesEn: 'Goes to the top or the end of the page.', rule: 'inpage', expect: 'scroll' },
      { et: ['keri ala', 'geri alla'], en: '(heard the Estonian way)', does: 'Ka valesti kuuldud käsk saab aru; riba ütleb, mida ta mõistis.', doesEn: 'A command misheard by a sound is still understood.', rule: 'inpage', expect: 'scroll' },
    ],
  },
  {
    id: 'vahelehed',
    name: 'Vahelehed ja saidid',
    nameEn: 'Tabs and sites',
    say: ['vahelehed ja saidid', 'vahelehed', 'vaheleht', 'saidid', 'sait', 'tabs', 'sites'],
    intro: 'Ava saite, vaheta vahelehti ja vajuta nuppe numbri järgi.',
    noteEn:
      'Known site names: WhatsApp, Messenger, Facebook, Gmail, Google, YouTube, Postimees, Delfi, ERR, LinkedIn, CV.ee, CV Keskus, Töötukassa, with case endings (`mine whatsappi`, `youtube\'i`) and as an Estonian ear spells them (`ava juutuba`, `mine guugel`, `ava vatsap`). Never guessed: sending, resting, waking, undo. `otsi` uses the site\'s own search, Google when it has none. The zoom is Chrome\'s own tab zoom (steps 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300 %), so it sticks for the site, and the bar zooms with the page. With the numbers showing, a number alone presses it.',
    phrases: [
      { et: ['ava youtube', 'ava whatsapp', 'mine whatsappi', "mine youtube'i"], en: 'open youtube, go to whatsapp', does: 'Avab tuntud saidi.', doesEn: 'Opens a known site.', rule: 'browserIntent', expect: 'goTo', example: true },
      { et: ['ava juutuba', 'mine guugel', 'aga whatsapp', 'ava vatsap'], en: '(heard the Estonian way)', does: 'Ka nii, nagu eesti kõrv nime kuuleb.', doesEn: 'Also when the name is heard the Estonian way.', rule: 'inpage', expect: 'goTo' },
      { et: ['mine postimees.ee'], en: 'go to postimees.ee', does: 'Avab aadressi.', doesEn: 'Opens an address.', rule: 'browserIntent', expect: 'goTo' },
      { et: ['otsi kassivideod'], en: 'search for cat videos', does: 'Otsib ees oleval saidil, muidu Google’ist.', doesEn: 'Searches on the site in front, or Google.', rule: 'browserIntent', expect: 'siteSearch', example: true },
      { et: ['otsi googlest ilm'], en: 'search google for weather', does: 'Otsib Google’ist.', doesEn: 'Searches Google.', rule: 'browserIntent', expect: 'goTo' },
      { et: ['järgmine vaheleht', 'eelmine vaheleht', 'kolmas vaheleht'], en: 'next tab, previous tab, third tab', does: 'Vahetab vahelehte.', doesEn: 'Switches tabs.', rule: 'browserIntent', expect: 'switchTab' },
      { et: ['uus leht'], en: 'new page', does: 'Avab uue vahelehe.', doesEn: 'Opens a new tab.', rule: 'browserIntent', expect: 'newTab', example: true },
      { et: ['sulge'], en: 'close', does: 'Sulgeb selle vahelehe.', doesEn: 'Closes this tab.', rule: 'browserIntent', expect: 'closeTab' },
      { et: ['mine tagasi', 'mine edasi'], en: 'page back, go forward', does: 'Eelmine või järgmine leht.', doesEn: 'The page history.', rule: 'browserIntent', expect: 'history' },
      { et: ['laadi uuesti'], en: 'reload', does: 'Laadib lehe uuesti.', doesEn: 'Reloads the page.', rule: 'browserIntent', expect: 'reload' },
      { et: ['näita numbreid'], en: 'show numbers', does: 'Paneb kõigele, mida saab vajutada, numbri.', doesEn: 'Puts a number on everything clickable.', rule: 'browserIntent', expect: 'showHints', example: true },
      { et: ['vajuta viis'], en: 'click five', does: 'Vajutab numbrit viis.', doesEn: 'Clicks number five.', rule: 'browserIntent', expect: 'clickHint' },
      { et: ['viis', 'kolm'], en: 'five', does: 'Kui numbrid on näha, vajutab selle numbri.', doesEn: 'With the numbers showing: clicks that number.', rule: 'inpage', expect: 'clickHint', context: 'hints' },
      { et: ['peida numbrid'], en: 'hide numbers', does: 'Peidab numbrid.', doesEn: 'Hides the numbers.', rule: 'browserIntent', expect: 'hideHints' },
      { et: ['tühjenda otsing'], en: 'clear the search', does: 'Tühjendab otsingukasti.', doesEn: 'Empties the search box.', rule: 'browserIntent', expect: 'clearField' },
      { et: ['sulge aken', 'välja', 'enter'], en: 'close the window, escape, enter', does: 'Escape või Enter klahv.', doesEn: 'The Escape or Enter key.', rule: 'browserIntent', expect: 'pressKey' },
      { et: ['suurenda', 'tee suuremaks', 'suurem kiri', 'suumi sisse'], en: 'zoom in, make it bigger, larger text', does: 'Teeb lehe ühe sammu suuremaks.', doesEn: 'Zooms in one step, kept per site.', rule: 'browserIntent', expect: 'zoom' },
      { et: ['vähenda', 'tee väiksemaks', 'väiksem kiri', 'suumi välja'], en: 'zoom out, make it smaller', does: 'Teeb lehe ühe sammu väiksemaks.', doesEn: 'Zooms out one step.', rule: 'browserIntent', expect: 'zoom' },
      { et: ['tavaline suurus', 'algne suurus', 'suumi tagasi'], en: 'normal size, reset zoom', does: 'Lehe tavaline suurus.', doesEn: 'Back to 100 %.', rule: 'browserIntent', expect: 'zoom' },
      { et: ['peida riba', 'näita riba'], en: 'hide the bar, show the bar', does: 'Teeb riba väikeseks nupuks ja tagasi.', doesEn: 'Folds the bar to a small pill, and back.', rule: 'browserIntent', expect: 'bar', example: true },
      { et: ['ava seaded', 'seaded'], en: 'open settings', does: 'Avab seadete lehe.', doesEn: 'Opens the settings page.', rule: 'browserIntent', expect: 'openSettings' },
    ],
  },
  {
    id: 'video',
    name: 'Video',
    nameEn: 'Video',
    say: ['video', 'videod', 'videot'],
    intro: 'Lehe video: mängi, peata, keri ja muuda heli.',
    noteEn: 'Bare `keri edasi` and `keri tagasi` skip 10 s; an amount can be said in minutes or seconds.',
    phrases: [
      { et: ['mängi', 'paus'], en: 'play, pause', does: 'Paneb video mängima või peatab selle.', doesEn: 'Plays or pauses the video.', rule: 'browserIntent', expect: 'media' },
      { et: ['vaiksemaks', 'valjemaks'], en: 'volume down, volume up', does: 'Heli vaiksemaks või valjemaks.', doesEn: 'The volume.', rule: 'browserIntent', expect: 'media' },
      { et: ['täisekraan'], en: 'full screen', does: 'Video üle kogu ekraani.', doesEn: 'Full screen.', rule: 'browserIntent', expect: 'media' },
      { et: ['keri edasi', 'keri tagasi'], en: 'skip forward, skip back', does: 'Hüppab videos 10 sekundit edasi või tagasi.', doesEn: 'Skips 10 s in the video.', rule: 'browserIntent', expect: 'media' },
      { et: ['keri edasi üks minut', 'keri kaks minutit tagasi', 'keri tagasi pool minutit', 'keri edasi poolteist minutit', 'keri edasi 30 sekundit'], en: 'skip back thirty seconds', does: 'Hüppab videos nii palju, kui ütled.', doesEn: 'Skips by the amount said.', rule: 'browserIntent', expect: 'media' },
    ],
  },
  {
    id: 'meil',
    name: 'Meil',
    nameEn: 'E-mail',
    say: ['meil', 'meili', 'e-kiri', 'kirjad', 'email'],
    intro: 'Kirjuta e-kirja Gmailis häälega.',
    noteEn:
      'Off Gmail a new mail opens Gmail\'s compose page in a new tab first. In the message, `valmis` or `järgmine väli` moves To, Cc, Subject, body in turn, and `saada` clicks Send (never Enter, which is a new line in a mail). `teema` and `lisa koopia` act only in the message: anywhere else a sentence that begins with "teema" is typed. What you say into To or Cc is written as an address ("ät", "punkt"). The e-mail addresses and phone numbers a page shows are read off it (at most 20), so `kirjuta talle meil` opens a new mail to that address; the model may only pick an address the page shows. Tested on `fixtures/gmail.html` and `fixtures/cv.html`; the Gmail selectors are unverified on real Gmail.',
    phrases: [
      { et: ['kirjuta meil Marile', 'kirjuta kiri Marile', 'saada meil Jaanile', 'write an email to Mari'], en: 'write an email to Mari', does: 'Avab uue kirja, saajaks Mari.', doesEn: 'Opens a new message with Mari in To; the body is ready for your words.', rule: 'inpage', expect: 'compose' },
      { et: ['kirjuta meil Marile, et tulen homme'], en: 'email Mari that I will come tomorrow', does: 'Uus kiri Marile, sõnad juba sees.', doesEn: 'Writes the body too.', rule: 'inpage', expect: 'compose' },
      { et: ['uus meil'], en: 'new email', does: 'Avab tühja kirja.', doesEn: 'Opens an empty message with To ready.', rule: 'inpage', expect: 'compose' },
      { et: ['teema Koosolek'], en: 'subject Meeting', does: 'Kirjutab kirja teema.', doesEn: 'Writes the subject.', rule: 'inpage', expect: 'mailField', context: 'mail' },
      { et: ['lisa koopia', 'lisa koopia Jaanile'], en: 'add a copy', does: 'Avab koopia välja.', doesEn: 'Opens Cc.', rule: 'inpage', expect: 'mailField', context: 'mail' },
      { et: ['kirjuta talle meil', 'võta see meiliaadress siit lehelt ja kirjuta talle, et tulen homme'], en: 'write to the address on this page', does: 'Uus kiri aadressile, mis lehel on. Vajab mudelit.', doesEn: 'A new mail to an address the page shows (needs the model).', rule: 'model', expect: 'ask' },
    ],
  },
  {
    id: 'dokument',
    name: 'Dokument',
    nameEn: 'Document',
    say: ['dokument', 'dokumendid', 'dokumendis', 'document'],
    intro: 'Pikas tekstis või Google Docsis: lause ei katke pausi peale.',
    noteEn:
      'A box is a document when it is Google Docs, a textarea or rich editor holding over 500 characters, or a rich editor with headings, lists or paragraphs of its own (never a chat\'s message box). There a pause of up to 20 seconds does not end the sentence. Only `punkt`, `küsimärk`, `hüüumärk` and `uus lõik` break a sentence. One-word words such as `välja`, `sulge`, `edasi`, `tagasi`, `paus` are typed, not obeyed; the model is asked only when you start with a command word (`vali`, `tee`, `muuda`, `loe`, `kustuta`, `ava`, `mine`, `kirjuta` …). On Google Docs the formats are Docs\' own shortcuts, tested on a stand-in only. A plain textarea has no bold or italics and says so.',
    phrases: [
      { et: ['paksuks', 'tee paksuks', 'kaldkirja', 'allajoonitud'], en: 'bold, italic, underline', does: 'Valitud tekst paksuks, kaldkirja või allajoonituks.', doesEn: 'Formats the selection.', rule: 'inpage', expect: 'format', context: 'document' },
      { et: ['pealkirjaks', 'tavaline tekst'], en: 'heading, normal text', does: 'Lõik pealkirjaks või tagasi tavaliseks tekstiks.', doesEn: 'The paragraph as a heading, or back to text.', rule: 'inpage', expect: 'format', context: 'document' },
      { et: ['loendiks', 'uus lõik'], en: 'bulleted list, new paragraph', does: 'Lõik loendiks või uus lõik.', doesEn: 'A list, or a new paragraph.', rule: 'inpage', expect: 'format', context: 'document' },
      { et: ['vali lõik', 'vali viimased kolm sõna'], en: 'select the paragraph, select the last three words', does: 'Valib lõigu või viimased sõnad.', doesEn: 'Selects the paragraph or the last words.', rule: 'inpage', expect: 'select', context: 'document' },
      { et: ['küsimärk', 'hüüumärk'], en: 'question mark, exclamation mark', does: 'Lõpetab lause küsi- või hüüumärgiga.', doesEn: 'Ends the sentence with the mark.', rule: 'inpage', expect: 'setText', context: 'document' },
      { et: ['loe viimane lause ette', 'loe see ette'], en: 'read the last sentence, read this', does: 'Loeb viimase lause või kogu kasti ette.', doesEn: 'Reads the last sentence, or the whole box, aloud.', rule: 'inpage', expect: 'speak', context: 'document' },
      { et: ['saada'], en: 'send', does: 'Dokumendis ei saadeta midagi.', doesEn: 'Sends nothing: "Dokumendis ei saadeta."', rule: 'inpage', expect: 'none', context: 'document' },
    ],
  },
  {
    id: 'lugemine',
    name: 'Lugemine',
    nameEn: 'Reading aloud',
    say: ['lugemine', 'ettelugemine', 'loe', 'reading'],
    intro: 'Ütle loeb lehe artikli ette, lause haaval.',
    noteEn:
      'The article is its headline and paragraphs, without the menus, the sidebar, the footer, the cookie banner or the bar. The microphone keeps listening while it reads, so you can say `stopp` over the voice; every other word heard meanwhile is dropped. Pressing the bar\'s microphone or the toolbar icon also stops a reading. The voice is the browser\'s own Estonian voice: Chrome has none today, Microsoft Edge has two (Anu and Kert) when its online voices are on. Where no Estonian voice exists nothing is read and the bar says so; Ütle never reads Estonian with an English voice.',
    phrases: [
      { et: ['loe ette', 'loe lehte ette'], en: 'read the page', does: 'Loeb lehe artikli ette.', doesEn: 'Reads the article of the page aloud.', rule: 'inpage', expect: 'read', example: true },
      { et: ['loe see ette'], en: 'read this', does: 'Loeb kasti ette, kui seal on sõnu; muidu lehe.', doesEn: 'Reads the armed box, the page when no box is armed.', rule: 'inpage', expect: 'read' },
      { et: ['loe valitud ette'], en: 'read the selection', does: 'Loeb valitud teksti ette.', doesEn: 'Reads the selected text.', rule: 'inpage', expect: 'read' },
      { et: ['loe edasi'], en: 'continue reading', does: 'Jätkab järgmisest lausest.', doesEn: 'Goes on from the next sentence after a stop.', rule: 'inpage', expect: 'read' },
      { et: ['lõpeta lugemine'], en: 'stop reading', does: 'Lõpetab lugemise.', doesEn: 'Stops the reading.', rule: 'inpage', expect: 'read' },
      { et: ['stopp', 'aitab', 'paus', 'peata'], en: 'stop', does: 'Lugemise ajal peatab lugemise enne kõike muud.', doesEn: 'While it reads: stops the reading first.', rule: 'readStop', expect: 'stop' },
    ],
  },
  {
    id: 'minu-andmed',
    name: 'Minu andmed',
    nameEn: 'My details',
    say: ['minu andmed', 'andmed', 'my details'],
    intro: 'Salvesta e-post, telefon või isikukood üks kord, siis ütle välja nimi.',
    noteEn:
      'Kept in `chrome.storage.local` (key `savedValues`) on this computer only; the model is told the names, never the values. The first e-mail is called "minu e-post"; a second one of the same kind asks for a name first ("töö e-post"). With two saved and no name the bar asks "Kumb?"; answer with the name, a word of it or `esimene` / `teine`. Spelling: `punkt` is ., `ät` is @, `kriips` is -, `alakriips` is _; numbers become digits; `gmail`, `hotmail`, `outlook`, `icloud`, `yahoo`, `mail punkt ee` add the ending, `oma lõpp` takes it off. An e-mail without @ is not saved. No passwords: a password field is never filled from here.',
    phrases: [
      { et: ['minu andmed', 'ava minu andmed'], en: 'my details', does: 'Avab seadete lehe Minu andmed osa.', doesEn: 'Opens the settings page at Minu andmed.', rule: 'inpage', expect: 'openSettings' },
      { et: ['lisa uus e-post', 'salvesta mu telefon', 'lisa uus isikukood'], en: 'add a new email, save my phone', does: 'Avab Minu andmed ja alustab häälega sisestamist.', doesEn: 'Opens Minu andmed with the voice entry started.', rule: 'inpage', expect: 'openSettings' },
      { et: ['r', 'a', 'ell', 'punkt', 'ät'], en: 'letters, one at a time', does: 'Sisestamisel: täht või märk korraga.', doesEn: 'In the entry: a letter or a mark at a time.', rule: 'savedEntry', expect: 'add', context: 'entry' },
      { et: ['gmail', 'mail punkt ee'], en: 'gmail', does: 'Sisestamisel: lisab lõpu @gmail.com või @mail.ee.', doesEn: 'In the entry: adds the ending.', rule: 'savedEntry', expect: 'add', context: 'entry' },
      { et: ['kustuta', 'kustuta kõik'], en: 'delete, delete everything', does: 'Sisestamisel: kustutab viimase tähe või kõik.', doesEn: 'In the entry: removes the last letter, or all.', rule: 'savedEntry', expect: 'delete', context: 'entry' },
      { et: ['loe ette'], en: 'read it back', does: 'Sisestamisel: loeb sisestatu tähthaaval ribale.', doesEn: 'In the entry: reads it back letter by letter on the bar.', rule: 'savedEntry', expect: 'read', context: 'entry' },
      { et: ['valmis'], en: 'done', does: 'Sisestamisel: salvestab.', doesEn: 'In the entry: saves it.', rule: 'savedEntry', expect: 'save', context: 'entry' },
      { et: ['katkesta'], en: 'cancel', does: 'Sisestamisel: lahkub salvestamata.', doesEn: 'In the entry: leaves without saving.', rule: 'savedEntry', expect: 'cancel', context: 'entry' },
      { et: ['minu e-post', 'mu meil', 'kirjuta mu telefon', 'sisesta minu isikukood'], en: 'my email, my phone', does: 'Väljal: kirjutab salvestatud väärtuse korraga.', doesEn: 'In a field: the saved value is typed whole.', rule: 'inpage', expect: 'setText', context: 'saved' },
    ],
  },
  {
    id: 'minu-kohad',
    name: 'Minu kohad',
    nameEn: 'My places',
    say: ['minu kohad', 'kohad', 'koht', 'my places'],
    intro: 'Sinu kohad sõnaga: uudised, raadio, ilm, meil, kalender, kaart, video.',
    noteEn:
      'Not while a message box is armed: there the words are typed. Defaults: uudised → Postimees, raadio → Vikerraadio\'s live page, ilm → Ilmateenistus, mail → Gmail, kalender → Google Kalender, kaart → Google Maps, video → YouTube; no bank. The model is told only the words and never sees an address. To save your own, open the page and say `lisa koht uudised`: the address of the tab in front is saved under that word. The settings page\'s **Minu kohad** section lists them; a helper can type a word and an address there. Stored under `places`.',
    phrases: [
      { et: ['vaata uudiseid', 'näita uudiseid', 'ava uudised'], en: 'show the news', does: 'Avab sinu uudiste lehe.', doesEn: 'Opens your news place.', rule: 'places', expect: 'goTo' },
      { et: ['pane raadio käima', 'ava raadio'], en: 'put the radio on', does: 'Avab sinu raadio.', doesEn: 'Opens your radio place.', rule: 'places', expect: 'goTo' },
      { et: ['mis ilm on', 'näita ilma'], en: "what's the weather", does: 'Avab ilma lehe.', doesEn: 'Opens your weather place.', rule: 'places', expect: 'goTo' },
      { et: ['ava mu mail', 'ava meil', 'vaata videoid'], en: 'open my mail, watch videos', does: 'Avab sinu meili või videod.', doesEn: 'Opens your mail or video place.', rule: 'places', expect: 'goTo' },
      { et: ['lisa koht uudised', 'salvesta see koht uudised', 'see on mu uudised'], en: 'save this place as news', does: 'Salvestab ees oleva lehe sõna „uudised“ alla.', doesEn: 'Saves the tab in front under that word.', rule: 'placeVoice', expect: 'save' },
      { et: ['lisa koht'], en: 'save this place', does: 'Küsib, mis sõna alla lehe salvestada.', doesEn: 'Asks for the word; say it next.', rule: 'placeVoice', expect: 'save' },
      { et: ['eemalda koht uudised'], en: 'remove the place news', does: 'Eemaldab koha.', doesEn: 'Removes the place.', rule: 'placeVoice', expect: 'remove' },
    ],
  },
  {
    id: 'haal',
    name: 'Hääl',
    nameEn: 'Listening',
    say: ['hääl', 'kuulamine', 'kuula', 'listening'],
    intro: 'Millal Ütle kuulab ja kuidas teda peatada.',
    noteEn:
      '`katkesta` drops everything in flight at once (the chain, the question to the model, the queued words) with "Katkestatud."; it works while resting too and is never typed. With the wake word (settings, **Kuulamine: Äratussõnaga**) only what starts with the word is acted on; "Ütle" alone opens a 20 s window in which sentences need no word, closed by `aitab`, `see on kõik` or `saada`. The word is matched by sound and must be first. Push-to-talk by looking needs nothing said: look at the microphone (or the whole bar) and speak.',
    phrases: [
      { et: ['puhka', 'ära kuula'], en: 'sleep, stop listening', does: 'Ütle ei kirjuta midagi, kuni äratad.', doesEn: 'Stops typing what it hears, until woken.', rule: 'inpage', expect: 'sleep' },
      { et: ['ärka üles'], en: 'wake up', does: 'Ütle kuulab jälle.', doesEn: 'Starts again.', rule: 'inpage', expect: 'wake', context: 'asleep' },
      { et: ['katkesta', 'tühista kõik', 'lõpeta kõik', 'stopp kõik'], en: 'cancel', does: 'Peatab kõik, mis pooleli on.', doesEn: 'Stops everything in flight at once.', rule: 'inpage', expect: 'cancel' },
      { et: ['Ütle, keri alla'], en: 'Ütle, scroll down', does: 'Äratussõnaga: käsk algab sõnaga „Ütle“.', doesEn: 'With the wake word: the command starts with the word.', rule: 'wake', expect: 'pass', context: 'wakeShut' },
      { et: ['Ütle'], en: 'Ütle', does: 'Äratussõna üksi: 20 sekundit võib rääkida ilma selleta.', doesEn: 'The word alone opens a 20 s window.', rule: 'wake', expect: 'open', context: 'wakeShut' },
      { et: ['aitab', 'see on kõik'], en: "that's all", does: 'Sulgeb äratussõna akna.', doesEn: 'Closes the window.', rule: 'wake', expect: 'close', context: 'wakeOpen' },
    ],
  },
  {
    id: 'abi',
    name: 'Abi',
    nameEn: 'Help',
    say: ['abi', 'help'],
    intro: 'See leht. Ütle „abi“ ja rühma nimi, et avada see rühm.',
    noteEn:
      'Rules only, never the model. With words in the armed box a one-word `abi` is typed ("Abi!" is a message). `loe ette` on the help page reads the open group. The page is `extension/help.html`; `help.html#kerimine` opens a group.',
    phrases: [
      { et: ['abi', 'mida ma öelda saan', 'mida ma saan öelda', 'näita käske'], en: 'help, what can I say', does: 'Avab selle lehe.', doesEn: 'Opens the help page.', rule: 'browserIntent', expect: 'openHelp', example: true },
      { et: ['abi kerimine', 'abi vormid', 'abi minu andmed'], en: 'help scrolling', does: 'Avab selle lehe nimetatud rühma juures.', doesEn: 'Opens the help page at that group.', rule: 'browserIntent', expect: 'openHelp' },
    ],
  },
]

/** The group a word names, after "abi" or "help": "kerimine", "minu andmed". */
export function helpGroupOf(words: string): PhraseGroup | undefined {
  const w = words.trim().toLocaleLowerCase('et').replace(/\s+/gu, ' ')
  return PHRASE_GROUPS.find((g) => g.say.includes(w) || g.id === w)
}

/** The group a hash opens ("#kerimine"); the first group for none or an unknown one. */
export function helpGroupForHash(hash: string): PhraseGroup {
  const id = decodeURIComponent(hash.replace(/^#/u, '')).toLocaleLowerCase('et')
  const first = PHRASE_GROUPS[0]
  if (first === undefined) throw new Error('PHRASE_GROUPS is empty')
  return PHRASE_GROUPS.find((g) => g.id === id) ?? first
}

/** The new-tab page's rotating examples, each in „…“, in the order of the groups. */
export const HELP_EXAMPLES: readonly string[] = PHRASE_GROUPS.flatMap((g) => g.phrases.filter((p) => p.example === true).map((p) => `„${p.et[0] ?? ''}“`))

/** The same examples in English, in “…”. */
export const HELP_EXAMPLES_EN: readonly string[] = PHRASE_GROUPS.flatMap((g) => g.phrases.filter((p) => p.example === true).map((p) => `“${p.en.split(',')[0] ?? p.en}”`))

/** Words a meaning may start with that keep their capital after the colon. */
const PROPER: ReadonlySet<string> = new Set(['Ütle', 'Escape', 'Google', 'Gmail'])

/** The Estonian forms as said: „keri alla“ või „keri üles“; three or more with commas. */
export function phraseSaid(phrase: Phrase): string {
  const forms = phrase.et.map((f) => `„${f}“`)
  return forms.length <= 1 ? (forms[0] ?? '') : `${forms.slice(0, -1).join(', ')} või ${forms.at(-1) ?? ''}`
}

/** The meaning as it follows a colon: a small first letter unless it is a name. */
export function phraseDoes(phrase: Phrase): string {
  const head = phrase.does.split(' ')[0] ?? ''
  return PROPER.has(head) ? phrase.does : phrase.does.charAt(0).toLocaleLowerCase('et') + phrase.does.slice(1)
}

/** One sentence for reading a phrase aloud: „keri alla“ või „keri üles“: kerib lehte peaaegu ekraani võrra. */
export function phraseSentence(phrase: Phrase): string {
  const said = phraseSaid(phrase)
  return `${said}: ${phraseDoes(phrase)}`
}

/** How many Estonian forms the source holds. */
export function phraseFormCount(): number {
  return PHRASE_GROUPS.reduce((n, g) => n + g.phrases.reduce((m, p) => m + p.et.length, 0), 0)
}
