# Ütle extension

Speak Estonian; the words go into the message box of the page you are on (WhatsApp Web first,
Messenger, any page) while you speak, and the browser scrolls and switches tabs by voice. A strip at
the bottom of every page, and of the new-tab page, shows the microphone, the words heard, and what
was done. Nothing opens a separate window. Design: `docs/ARCHITECTURE.md` sections 21.2 and 21.3 (the strip and
live words), 22 (understanding by meaning), 23 (round 3: speed, push-to-talk by looking, sound-alike
commands, editing, Soniox), 24 (round 4: chains of goals, only your own voice, everything on the page) and 25
(round 5: numbers and form fields, care for the model and never stuck, the page's size) and 27
(round 6: a hosted server behind a token, the store zip).

## Build

From the repository root:

1. `npm ci` (once).
2. `npm run model` (once): downloads the Estonian speech model into `models/`, the speaker model
   (TitaNet small, 40 MB, round 7) for "Kuula ainult mind" into `models/speaker/`, and the speech
   detector (Silero VAD v5, 2.3 MB, round 7) into `models/vad/`. The last two are optional; a failure
   there is a warning. Pulled round 7 onto an older checkout? Run it again: both files are new.
3. `npm run ext`: bundles `extension/src/` into `extension/dist/`. Run it again after any change.

## Load

1. Start the speech model: `npm run dev` (it serves `ws://localhost:5173/api/asr`). Keep it running.
   Within a minute or two it prints `[asr] model loaded on a worker thread in N ms` (see "The dev
   server's log lines" below).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked**, choose the `extension/` folder (not `dist/`).
4. Right after loading, the welcome page **Alustamine** opens by itself (ARCHITECTURE 30.1). A
   helper walks its five cards, each a large button that takes a click or a 1 s dwell, Estonian
   first with English under it:
   1. **Mikrofon**: Chrome asks to use the microphone; press **Allow**. The card ticks.
   2. **Kõneserver**: **Samas arvutis** when `npm run dev` runs on this computer, or **Teises
      arvutis** with the server's address (`wss://…/api/asr`) and võti. **Proovi ühendust** says
      "Ühendus töötab" and the profile, "Vale võti." or "Ei saa ühendust." with what to do.
   3. **Proovi**: press the microphone on the bar and say "tere"; the word lands in the box and the
      card says "Töötab."
   4. **Hääl** (optional): **Õpeta mu hääl lausetega** opens the settings page at Minu hääl.
   5. **Valmis**: three phrases to start with, **Abi** and **Seaded**.
5. Pin the Ütle icon (puzzle piece, then the pin). Right-click it for **Alustamine**, **Seaded** and
   **Abi**. By voice, "ava juhend" or "alustamine" ("setup", "open the guide") opens the welcome page
   again.
6. If the server runs at another address, the welcome page's step 2 or the settings page's **Server**
   (see "Hosted server" below) sets it; it takes effect the next time listening is turned on.

## Soniox instead of the local model (optional)

Soniox is a hosted Estonian recogniser; the audio then leaves the laptop. It needs a key in the
environment of the terminal that runs `npm run dev`, never in a file: PowerShell
`$env:SONIOX_API_KEY="..."; npm run dev`, bash `SONIOX_API_KEY=... npm run dev`.
`curl localhost:5173/api/status` then shows `"speech":{"local":true,"soniox":true}`. On the settings
page choose **Kõnemudel: Soniox (pilves)**; the choice takes effect the next time listening is turned
on. `UTLE_ASR=soniox` in the same environment sends every connection to Soniox whatever the setting.
Without the key the bar says the speech model is not reachable and the server logs
`[soniox] SONIOX_API_KEY is not set`. Nobody has run this with a real key (see "Unverified").

## Only your own voice (round 4, strict since round 7, optional)

Background conversations are typed as if you said them. Two things stop that: push-to-talk by
looking (below), and the server knowing your voice. On the settings page, group **Minu hääl**:

1. **Õpeta mu hääl lausetega** (round 7): the page shows twelve short sentences one at a time, with
   "1 / 12" above. Read each aloud in your usual voice; the next one comes by itself when the server
   has heard it. **Valmis** keeps what was read so far. The server keeps one voice embedding per
   sentence and stores their mean in `models/speaker/owner.json` (never audio). The bar then says
   "Hääl on õpitud 12 lausest."; fewer than six sentences are kept too, and the bar says the profile
   is thin. What you read is neither typed nor run.
2. **Õpeta vabalt rääkides**: the round 4 way, kept as a fallback: speak normally for eight seconds.
3. **Kuula ainult mind**: from the next time listening starts, only what the server judges to be
   your voice is obeyed. Another voice, and an utterance it cannot judge (less than half a second of
   speech), are dropped, and the bar says "Keegi teine rääkis, jätsin vahele." for three seconds. At
   the third drop in a row it also says once "Kui see olid sina, õpeta hääl uuesti seadetes." Words
   a dropped voice typed as a preview are taken back. **Kuula kõiki** turns it off.

One-word commands ("jah", "saada", "üks") are often too short for the speaker model to recognise
you, so with **Kuula ainult mind** on they may be dropped as someone else's. That is the cost of not
letting a friend's words through; see HANDOFF 1g for the numbers.

Pulled round 7 over a profile from round 4? Teach your voice again: the old profile was made with
another speaker model, and until you do, the server cannot judge voices (everything is obeyed except
speech much fainter than yours was).

Without the speaker model the server logs `[asr] no speaker model (npm run model fetches it;
loudness only until then); …`, and "Kuula ainult mind" only skips speech clearly fainter than yours
was at enrolment: distance from the microphone, not the voice. The threshold is `OWNER_THRESHOLD`
in `server/speaker.ts`, measured on synthetic voices only (HANDOFF 1g).

### Recording yourself to set the threshold (UTLE_CAPTURE)

For calibration on your own machine only; the folder holds your voice and your words; delete it
after. Start the dev server with the variable set to a folder:

    $env:UTLE_CAPTURE="C:\temp\utle-voice"; npm run dev        (PowerShell)
    UTLE_CAPTURE=/tmp/utle-voice npm run dev                     (sh)

Each final is then written there as `<timestamp>-<speaker>-<score>.wav` (the speech the speaker
gate judged) and one line `<file>\t<score>\t<speaker>\t<heard text>` is appended to `log.tsv`.
Without the variable nothing is written and no text goes anywhere. Then put your clips in one
folder and the others' in another and run
`npx tsx scripts/speaker-calibrate.ts --owner <your folder> --other <their folder>`: it prints every
score and the best threshold. HANDOFF 1g has a ten-minute script.

## Hosted server (round 6)

For a computer where nothing may be installed, the server runs on a hosted machine and the extension
is told its address and a token. **The audio then leaves the computer**: say so to the user;
`docs/PRIVACY.md` is the plain-words version. Design: `docs/ARCHITECTURE.md` 27.

`npm run serve` is the production server: the same API as `npm run dev` without Vite, on `PORT`
(default 8787); `/healthz` answers `ok` for a health check and `/` answers `Ütle server`. With
`UTLE_TOKEN` set, every `/api` request needs `Authorization: Bearer <token>` and the speech socket
`?token=<token>` (the extension does both); `/api/status` then says `"auth":"on"`. Locally:
`PORT=8787 UTLE_TOKEN=some-long-secret npm run serve`.

Several people can share one server, each with their own voice profile (round 7):
`UTLE_TOKEN=ralf:<token 1>,mari:<token 2>`. Each token is a person; the settings page's
**Proovi ühendust** says whose profile the token is ("Profiil: ralf, hääl õpetatud" or
"õpetamata"), and "Õpeta mu hääl" writes that person's profile only. The profiles are kept in
`UTLE_DATA_DIR/profiles/` (one file per token, named by the first 16 hex digits of the token's
SHA-256); without `UTLE_DATA_DIR` they go to `models/speaker/profiles/`. With no `UTLE_TOKEN` at all
(the dev server) the one profile stays `models/speaker/owner.json`, as before.

Deploy on Railway: **`docs/DEPLOY.md`** has every command (`railway login`, the variables, the
volume at `/data`, `railway up`, the three checks). Then, on each computer, the Ütle settings page →
**Server**: address `wss://<domain>/api/asr`, that person's token, **Proovi ühendust**. "Vale võti"
is a wrong token; "Ei saa ühendust" is a wrong address or a server that is down. Right after a
deploy the first connection may wait while the model loads; the deploy log says
`[asr] model loaded on a worker thread in N ms` when it is ready.

`scripts/asr-client.ts <ws(s)://host/api/asr?token=…> <wav>` streams a recording to any server the
way the extension does and prints the partials, the finals and the time from the last speech to the
last final; `--enrol 2` first teaches the token's profile from the recording.

## Install on a locked computer

Two routes. Both need the speech server somewhere: on the same computer (`npm run dev`) or hosted
("Hosted server" above).

**A. Today: a helper loads the zip.** Works on any Chrome and on Microsoft Edge, nothing installed
but the browser.

1. Get `utle-0.4.0.zip` (`npm run ext:pack` writes it to `extension/out/`) onto the computer and
   unpack it into a folder that stays, for example `Documents\Ütle`. The extension is loaded from
   that folder every time Chrome starts; deleting the folder removes it.
2. Open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**.
3. **Load unpacked**, choose the folder (the one with `manifest.json` in it).
4. The welcome page **Alustamine** opens by itself: walk its five cards as in "Load" step 4,
   with the server's address and token in card 2.

Chrome may show a line about developer-mode extensions when it starts; it can be closed. An update
is the same steps with the new zip unpacked over the old folder, then the reload arrow on the Ütle
card.

**B. Once Ralf uploads to the Chrome Web Store** (unlisted): *(store link once published)*. Install
from the link; no developer mode. The welcome page opens the same way. The listing text and the
upload steps are in `docs/STORE.md`.

If the organisation's policy blocks Developer mode, the Chrome Web Store or extensions, nothing here
works without IT: they must allow this one extension (by its store id, once published) in the
Chrome policy. There is no way around that from the user's side.

## The store zip

`npm run ext:pack` builds the extension and writes `extension/out/utle-<version>.zip`: exactly
`manifest.json`, `options.html`, `offscreen.html`, `permission.html`, `newtab.html`,
`welcome.html`, `help.html`, `relay.js`, `dist/` and `icons/`, nothing else. Upload that in the
Chrome Web Store developer dashboard. Raise `version` in `extension/manifest.json` for every upload
(0.4.0 now). The icons are drawn by `npm run icons` (committed; run it only to change them).

- `docs/STORE.md`: everything the listing asks for (name, summary, description, category, single
  purpose, each permission's justification, data declarations, privacy policy URL, visibility
  Unlisted), Estonian first, and Ralf's upload checklist.
- `npx tsx scripts/store-shots.ts`: the five 1280×800 screenshots into `extension/store/`, from the
  stand-in pages and the extension's own pages (no real site). Run it again after a visible change.
- `npx tsx scripts/pack-check.ts`: unpacks the zip, loads it on a fresh profile, and checks that the
  welcome page opens and "abi" opens the help page (`docs/proof/r9-pack-welcome.png`).

## After pulling a change

1. `npm run ext` in the repository root.
2. On `chrome://extensions`, press the reload arrow on the Ütle card.
3. Reload the tabs that were already open (or open them again), so they get the new strip.

## Grant the microphone (once, done by a helper)

1. Step 1 of the welcome page asks as soon as it opens: press **Allow** in Chrome's question.
2. Refused: the card says how to allow it (the lock icon in the address bar) and shows **Proovi
   uuesti**.
3. If the permission is removed later, turning the microphone on opens the small "Ütle vajab
   mikrofoni" tab, which asks again and closes itself.

## The connection dot and the server-down lines (round 9, ARCHITECTURE 30.1)

A dot in the top-left corner of the microphone square: green **Ühendatud**, amber **Ühendan**, red
**Server ei vasta** (the word shows on hover). While listening, a lost or refused connection is
tried again after 1, 2, 4 and then every 5 s, and the bar says once "Kõneserver ei vasta. Palu
abilisel see käivitada (npm run dev)." (a local address) or "Kõneserver ei vasta. Kontrolli
internetiühendust või palu abilisel vaadata serverit." (a hosted one); a wrong token keeps "Serveri
võti on vale.". When the server answers again the microphone reopens by itself and the bar says
"Server vastab jälle." once.

## Use

- The strip sits at the bottom of every web page: near-black, ivory text, 128 px high by default.
  The big square is the microphone: click it, or rest the eye-tracker pointer on it for one second
  (an amber fill grows), to turn listening on or off. Green "Kuulan" = listening, hollow "Ei kuula"
  = off, amber outline "Puhkan" = resting.
- Right of the words are two small controls, also by click or one-second dwell: **Peida** folds
  the strip to a round microphone pill in the bottom-right corner (say `peida riba` for the same),
  **Seaded** opens the settings page. On the pill: click or dwell one second to turn listening on
  or off; the small **Näita** next to it, resting on the pill for two seconds, or `näita riba`
  brings the strip back.
- Open a chat in WhatsApp Web and speak: the words appear in the chat's message box as you say
  them, and are tidied when you stop (capital letter, full stop). Words that may be a command
  ("saa...", "keri...") are not typed; if they turn out not to be one, they appear then.
- The upper line of the strip always shows the words being heard, and keeps the last ones until you
  speak again. Under it, the amber line says what was understood or done; three pulsing dots and
  "Mõtlen" appear while the model is asked what you meant ("Mõtlen pikemalt…" for a long sentence or a
  chain, which the model reads whole and plans before it acts; from three seconds on the dots show the
  seconds, "Mõtlen… 7 s"), and a thin amber line under that says when the free-form understanding is off
  (no key, no server). Nothing waits forever: a step that takes more than 25 seconds is given up with
  "Võttis liiga kaua, katkestasin.", and `katkesta` (also `tühista kõik`, `lõpeta kõik`, `stopp kõik`,
  `cancel`) drops everything in flight at once with "Katkestatud.", whatever is in the box.
- A new tab is Ütle's own page: the same strip, big tiles for WhatsApp and the other known sites,
  and three example phrases that change every few seconds. Rest the eye-tracker pointer on a tile
  for one second (or click it) to open the site in that tab, or say `näita numbreid` and the
  number. Chrome may ask, once, whether to keep this changed new-tab page: choose **Keep it**.
- Settings (the **Seaded** control, or the extension's options page) are large buttons that a
  click or a one-second dwell toggles, saved at once: bar height (Väike 96 / Tavaline 128 / Suur
  192, `barHeight`), microphone side (`micSide`: Vasakul / Paremal), and whether the bar starts
  folded (`barHiddenDefault`), how listening is triggered (`listenMode`: Lülitiga / Vaatamisega /
  Äratussõnaga, the last with a field for the wake word, `wakeWord`, default "Ütle"),
  what the gaze rests on (`gazeTarget`: Mikrofon / Kogu riba, shown only for Vaatamisega) and the
  speech model (`speechEngine`: Arvutis (TalTech) / Soniox (pilves); Soniox needs `SONIOX_API_KEY`
  on the dev server and takes effect the next time listening starts), and since round 4 the group
  **Minu hääl**: the buttons **Õpeta mu hääl lausetega** and **Õpeta vabalt rääkides** (round 7;
  see "Only your own voice" above) and the
  choice **Kuula ainult mind** / **Kuula kõiki** (`onlyOwner`, default off; takes effect the next
  time listening starts). The speech-model and
  development-page addresses are under "Täpsemalt". The same strip is mounted there, and `näita numbreid`
  numbers its buttons: say the number to press one (round 9, ARCHITECTURE 30.2.5).
- **Push-to-talk by looking** (`listenMode: gaze`): the microphone square, or the whole bar when
  the gaze target is Kogu riba, listens while the eye-tracker pointer rests on it. It starts after
  250 ms on the target (a pass-through does nothing) and stops 600 ms after the pointer leaves
  (jitter does not cut a sentence); on the stop the words said so far are delivered at once. Off,
  the square reads "Vaata siia ja räägi"; the whole bar as target shows a green inner outline while
  it listens and an amber fill that drains during the 600 ms grace. A click on the target does
  nothing in this mode. The folded pill is a gaze target too (resting on it for two seconds no
  longer unfolds the bar in this mode; use **Näita**). When a page swallows the pointer-leave
  event, a one-second poll of the pointer's last position ends listening instead.
- **Wake word** (`listenMode: wake`, round 8, ARCHITECTURE 29.4.1): listening starts by itself when
  the browser starts and when the mode or the word is set, and stays on; the microphone button still
  turns it off. Only what starts with the wake word is acted on: "Ütle, keri alla". Everything else
  is shown on the strip's upper line and goes nowhere (not typed, not sent to the model). Dictating:
  "Ütle, tulen kell viis" into an armed box types it and opens the dictation window, shown as a small
  amber disc on the microphone; while it is open, sentences need no word. It closes after 20 s with
  nothing said, on `aitab` / `see on kõik` / `that's all`, or after `saada`. "Ütle" alone opens it too.
  The word is matched by sound ("ütel", "Ütle," pass; "ütlesin", "ütles" do not) and must be first.
- **Minu kohad** (round 8, 29.4.2): `vaata uudiseid`, `näita uudiseid`, `ava uudised`, `pane raadio
  käima`, `ava raadio`, `mis ilm on`, `näita ilma`, `ava mu mail`, `ava meil`, `vaata videoid` open
  your place for that word (not while a message box is armed: there the words are typed). Defaults:
  uudised → Postimees, raadio → Vikerraadio's live page (otse.err.ee), ilm → Ilmateenistus, mail →
  Gmail, kalender → Google Kalender, kaart → Google Maps, video → YouTube; no bank. The model is told
  only the words and may answer one of them in other phrasings; it never sees an address. Another
  station once the radio page is open: `vajuta Raadio 2` or the numbers, as on any page. To add your
  own by voice, open the page and say `lisa koht uudised` (or `salvesta see koht uudised`, `see on mu
  uudised`, `save this place as news`): the address of the tab in front is saved under that word and
  the strip says so. `lisa koht` alone asks for the word; say it next. `eemalda koht uudised` removes
  one. The settings page's **Minu kohad** section lists them; a helper can also type a word and an
  address (`postimees.ee`) and press **Lisa koht**; **Eemalda** removes one. Stored under `places`.
- When the speech server falls behind by more than one second, a thin dim line under the amber
  one says "Kõne jääb maha N s" until it has caught up. While a chain of goals runs (below) a
  line in the same place says where it is: "2/4 · ava Karini viimane sõnum".
- What to say: every phrase, grouped, is in "What to say" below, generated from `src/core/phrases.ts`; in the
  product, say `abi` (or `mida ma öelda saan`, `help`) and the help page opens; `abi kerimine` opens one group.
- The toolbar icon also turns listening on and off.
- When the speech model is not running, the strip says so in one amber line; start `npm run dev` and
  turn the microphone on again.

### Dokumendis (round 8, ARCHITECTURE 29.2)

A box is a document when it is Google Docs, a textarea or rich editor holding over 500 characters, or
a rich editor with headings, lists or paragraphs of its own (never a chat's message box, nor a box with
a send button beside it). There a pause of up to 20 seconds does not end the sentence: the next words
continue it with a small letter; after a longer pause the sentence gets its full stop and a new one
starts. Only `punkt` (and `küsimärk`, `hüüumärk`) and `uus lõik` break a sentence. One-word words such as
`välja`, `sulge`, `edasi`, `tagasi`, `paus` are typed, not obeyed. Nothing you say is taken back by the
model's check; it is asked only when you start with a command word (`vali`, `tee`, `muuda`, `loe`,
`kustuta`, `ava`, `mine`, `kirjuta` …), and then before anything is typed. `saada` sends nothing:
"Dokumendis ei saadeta." Formatting works in any armed rich editor: `paksuks` / `tee paksuks`,
`kaldkirja`, `allajoonitud`, `pealkirjaks`, `tavaline tekst`, `loendiks`, `uus lõik` (English `bold`,
`italic`, `underline`, `heading`, `normal text`, `bulleted list`, `new paragraph`); select first with
`vali see lause`, `vali lõik`, `vali viimased kolm sõna`, `vali sõna X`. On Google Docs they are Docs'
own shortcuts (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Alt+1, Ctrl+Alt+0, Ctrl+Shift+8, Enter twice), tested on
a stand-in only. A plain textarea has no bold or italics and says so. `loe viimane lause ette` reads the
last sentence of the box aloud, `loe see ette` the whole box (the microphone may hear the voice until
the reading pause of the READ lane lands).
### Lugemine: reading aloud (round 8, ARCHITECTURE 29.5)

Say `loe ette` (also `loe lehte ette`, `read the page`) and Ütle reads the article of the page in
front aloud: its headline and paragraphs, without the menus, the sidebar, the footer, the cookie
banner or the bar itself, sentence by sentence. A subscriber teaser (a short list of selling points
next to a Telli button, as on postimees.ee) is not read, and a sentence that repeats the one before
it (err.ee's lead opens with the headline) is said once (30.4). `loe see ette` reads the armed message box (the
page when no box is armed), `loe valitud ette` the selected text, `loe edasi` goes on from the next
sentence after a stop, and `lõpeta lugemine` stops; while it reads, `stopp` and `aitab` stop the
reading too, before anything else, and so do `paus` and `peata`. The microphone keeps listening
while it reads, so you can say `stopp` over the voice; every other word heard meanwhile (the voice
itself, mostly) is dropped and never shown or typed. Pressing the bar's microphone or the toolbar
icon also stops a reading and leaves listening as it was. The amber line says "Loen ette…" while
it reads.

The voice is the browser's own Estonian voice. **Chrome has none today**; **Microsoft Edge has two**
(Microsoft Anu and Kert, natural network voices) when its online voices are on, which they are in an
everyday Edge (they need the internet; the text goes to Microsoft's speech service). Load the
extension into Edge the same way (`edge://extensions`, developer mode, Load unpacked). Where no
Estonian voice exists nothing is read and the bar says "Selles brauseris pole eesti häält. Edge'is
on."; Ütle never reads Estonian with an English voice. A sentence the voice fails on is tried once
more and then skipped ("Jätsin ühe lause vahele.").

**Loe riba ette** (settings page, the last group, off by default): when on, every new amber line of
the bar is spoken too, so a person who cannot read the strip hears "Kirjutasin: …"; lines of 200
characters or more, the live words and anything while an article is being read are not. The
microphone does not listen while a bar line is spoken (a second or two).

To check it by ear (not done by the tests, whose Chromium has no Estonian voice): in Edge, open a news
article, turn listening on, say `loe ette`, then press the microphone after a sentence or two, then
say `loe edasi`.

## What to say

<!-- phrases:start: generated by `npx tsx scripts/phrases-doc.ts` from src/core/phrases.ts; edit the source, not this -->

Generated from `src/core/phrases.ts`, the one source of the phrases: the help page (`extension/help.html`, say `abi`) shows it, the new-tab page rotates its examples, and `src/core/phrases.test.ts` runs every Estonian form below through the rule it names (`src/core/inpage.ts`, `src/core/browserIntent.ts`, `src/core/places.ts`, `src/core/savedEntry.ts`, `src/core/reading.ts`, `src/core/wake.ts`), so a phrase that drifts fails `npm run check`. 240 Estonian forms in 113 entries and 14 groups. The full tables are `docs/ARCHITECTURE.md` 21.1, 22, 23.4 and 30.2. Anything that is not a command is typed into the message box; what no fixed phrase covers goes to the model with what is on the page.

### Sõnumid (Messages)

Help page: `help.html#sonumid`, or say `abi sõnumid`.

| Estonian | English | What happens |
|---|---|---|
| `tulen homme kell viis` | (anything that is not a command) | Typed into the message box. |
| `kirjuta Marile`, `ava vestlus Mariga` | write to Mari, open chat with Mari | Opens the chat with Mari. |
| `kirjuta Marile, et jõuan kell viis` | tell Mari that I arrive at five | Opens the chat with Mari and writes the sentence. It does not send. |
| `saada`, `saada ära`, `saadake`, `saadame` | send, send it | Sends what is in the box. |
| `mine whatsappi, siis ava Karini viimane sõnum` | go to whatsapp, then open Karin's last message | A chain: the goals are done one after the other (needs the model). |

Words that may be a command ("saa...", "keri...") are not typed until they turn out not to be one. What the fixed phrases do not recognise goes to the model with what is on the page ("uus leht", "vajuta Mari", "pane vaiksemaks"); it needs `ANTHROPIC_API_KEY` on the server. Almost every dictation under 60 words is checked by the model after it is typed; the words stay unless the model says they were a command. Chains: say `siis`, `ja siis`, `ja`, `ning`, `seejärel` or `pärast seda` between goals; after a joining word Ütle waits 2.5 s for the rest, and a part that starts with `siis` within 2.5 s goes on from the last words. At most 16 page steps and 90 s in all, four steps and 15 s per goal; the strip shows "2/4 · …". Any other utterance stops the chain; a plain `saada` waits behind it. A message ("kirjuta et tulen homme") is never split. `saada` is never guessed from a misheard word: "sada" and "saata" are typed.

### Parandamine (Corrections)

Help page: `help.html#parandamine`, or say `abi parandamine`.

| Estonian | English | What happens |
|---|---|---|
| `mitte kolm, vaid neli`, `kolme asemel neli` | not three but four | The last "kolm" in the box becomes "neli". |
| `kustuta viimane sõna` | delete the last word | Removes the last word. |
| `kustuta viimane lause` | delete the last sentence | Removes the last sentence. |
| `kustuta kõik`, `katkesta sõnum` | delete everything | Empties the box. |
| `uus rida` | new line | Adds a line break. |
| `punkt`, `koma` | full stop, comma | Adds the mark. |
| `võta tagasi`, `tagasi` | undo | Puts back the text from before the last change. |
| `kustuta täht`, `kustuta kolm tähte`, `kustuta valitud` | delete a letter, delete three letters | Backspace, once or the number of times said; the selection. |
| `kustuta ees` | delete ahead | The Delete key. |
| `kustuta sõna homme` | delete the word homme | Selects the word and deletes it. |
| `tee uuesti` | redo | Redo. |

`tagasi` alone undoes while there are words in the box, and goes back a page otherwise. `võta tagasi` is the whole-box undo. `kustuta sõna homme` and the keys work at the caret in the box in front; a word that is not in the box goes to the model instead (it may be a section of the page).

### Tekstis liikumine (Moving in the text)

Help page: `help.html#tekstis`, or say `abi tekstis liikumine`.

| Estonian | English | What happens |
|---|---|---|
| `mine algusesse`, `mine lõppu` | go to the start, go to the end | The caret to the start or the end of the text. |
| `rea algusesse`, `rea lõppu` | start of the line, end of the line | The caret to the start or the end of the line. |
| `lause algusesse`, `lause lõppu` | start of the sentence, end of the sentence | The caret to the start or the end of the sentence. |
| `sõna tagasi`, `kolm sõna edasi` | word back, three words forward | The caret by words. |
| `mine sõna homme ette`, `mine sõna homme taha`, `pärast sõna homme`, `mine kooli juurde` | go before homme, go after homme | The caret before or after the word named. |
| `vali kõik`, `vali see sõna`, `vali see lause`, `vali see rida` | select all, select the sentence | Selects everything, the word, the sentence or the line. |
| `vali viimane sõna`, `vali viimane lause`, `vali sõna homme`, `vali homme` | select the last word, select homme | Selects the last word, the last sentence or the word named. |
| `kirjuta siia vahele kell viis`, `lisa siia kell viis`, `sisesta kell viis` | insert hello | Types at the caret. |
| `vasakule`, `paremale kolm korda`, `üks rida üles`, `kaks rida alla` | arrow left, right three times, line up | The arrow keys, once or the number of times said. |
| `järgmine väli` | next field | Tab, and arms the field it lands in. |

These work in the box in front, armed or focused. A space and a capital are added as the place needs when typing at the caret. `järgmine väli` (Tab) arms the field it lands in. A word that is not in the box goes to the model instead. On Google Docs only the keys and typing work (its editor is a canvas with no text to find in): `sõna tagasi`, `rea algusesse`, `kustuta täht`, `tee uuesti`, `kirjuta siia vahele …`; `võta tagasi` there needs the model to answer `pressKey Undo`. Tested on `fixtures/essay.html`, never on Docs itself.

### Vormid (Forms)

Help page: `help.html#vormid`, or say `abi vormid`.

| Estonian | English | What happens |
|---|---|---|
| `kirjuta siia` | write here | Makes the focused field the place the words go. |
| `kolm üheksa null kaks üks null null null null null üks`, `kakskümmend kolm` | three nine zero two | Into a code, phone or number field: typed as digits. |
| `ralf punkt sepp ät gmail punkt com` | ralf dot sepp at gmail dot com | Into an e-mail field: ralf.sepp@gmail.com. |
| `ät`, `sidekriips`, `alakriips`, `pluss` | at, hyphen, underscore, plus | The marks @ - _ and +; "punkt" is a dot inside the address. |
| `bee`, `ess`, `suur a` | letters by name | Letters by their names; "suur a" is a capital. |
| `pluss kolm seitse kaks viis viis viis` | plus three seven two | Into a phone field: +372555. |
| `numbritena` | as digits | Writes everything as digits until told otherwise. |
| `tavaliselt` | normally | Back to ordinary writing. |
| `kirjuta kood 3902` | type code 3902 | One value as a code, without the model. |
| `sisesta e-post ralf ät gmail punkt com`, `kirjuta telefon viis viis viis` | enter email …, type phone … | Names the kind for one utterance. |
| `valmis`, `olen valmis`, `edasi` | done, next | In a form field: the next field. |
| `kinnita`, `logi sisse`, `sisesta` | submit, log in | In a form field: submits the form, as Enter would. |

Click the field (or `näita numbreid` and its number, or `kirjuta siia`), then say the digits one by one. The field's own type says what it is for (e-post, telefon, isikukood, PIN, summa); into a one-line field nothing is typed live: the words are checked first, then the field is filled whole and the bar reads it back, "Kirjutasin: 39021000001 (ütle „edasi“ või „valmis“)", a PIN as dots. `valmis` and `edasi` go to the next field and `kinnita` submits only in a one-line field he armed. A code said in two breaths joins up without a space. Tested on `fixtures/login.html`, a Smart-ID-like page, not on the real one.

### Kerimine (Scrolling)

Help page: `help.html#kerimine`, or say `abi kerimine`.

| Estonian | English | What happens |
|---|---|---|
| `keri alla`, `keri üles` | scroll down, scroll up | Scrolls most of a screen, smoothly. |
| `keri natuke alla`, `natuke üles`, `veidi alla` | scroll down a little | A third of a screen. |
| `keri aeglaselt alla`, `keri tasa üles`, `aeglaselt alla` | scroll down slowly | A steady slow scroll until stopped. |
| `stopp`, `seis`, `aitab`, `lõpeta`, `lõpeta kerimine`, `kerimine seis` | stop | Stops the scroll. |
| `lehe algusesse`, `lehe lõppu` | scroll to the top, scroll to the bottom | Goes to the top or the end of the page. |
| `keri ala`, `geri alla` | (heard the Estonian way) | A command misheard by a sound is still understood. |

`keri alla` and `keri üles` move 80% of the view, smoothly; `natuke` a third; `aeglaselt` a steady 90 px/s until stopped. While there are words in the box a one-word `aitab` is typed (it is a reply); `lõpeta kerimine` always stops. `keri edasi` and `keri tagasi` skip in the video. A command heard the Estonian way is still understood, and the amber line says what it took it to be ("Sain aru: „keri alla“").

### Vahelehed ja saidid (Tabs and sites)

Help page: `help.html#vahelehed`, or say `abi vahelehed ja saidid`.

| Estonian | English | What happens |
|---|---|---|
| `ava youtube`, `ava whatsapp`, `mine whatsappi`, `mine youtube'i` | open youtube, go to whatsapp | Opens a known site. |
| `ava juutuba`, `mine guugel`, `aga whatsapp`, `ava vatsap` | (heard the Estonian way) | Also when the name is heard the Estonian way. |
| `mine postimees.ee` | go to postimees.ee | Opens an address. |
| `otsi kassivideod` | search for cat videos | Searches on the site in front, or Google. |
| `otsi googlest ilm` | search google for weather | Searches Google. |
| `järgmine vaheleht`, `eelmine vaheleht`, `kolmas vaheleht` | next tab, previous tab, third tab | Switches tabs. |
| `uus leht` | new page | Opens a new tab. |
| `sulge` | close | Closes this tab. |
| `mine tagasi`, `mine edasi` | page back, go forward | The page history. |
| `laadi uuesti` | reload | Reloads the page. |
| `näita numbreid` | show numbers | Puts a number on everything clickable. |
| `vajuta viis` | click five | Clicks number five. |
| `viis`, `kolm` | five | With the numbers showing: clicks that number. |
| `peida numbrid` | hide numbers | Hides the numbers. |
| `tühjenda otsing` | clear the search | Empties the search box. |
| `sulge aken`, `välja`, `enter` | close the window, escape, enter | The Escape or Enter key. |
| `suurenda`, `tee suuremaks`, `suurem kiri`, `suumi sisse` | zoom in, make it bigger, larger text | Zooms in one step, kept per site. |
| `vähenda`, `tee väiksemaks`, `väiksem kiri`, `suumi välja` | zoom out, make it smaller | Zooms out one step. |
| `tavaline suurus`, `algne suurus`, `suumi tagasi` | normal size, reset zoom | Back to 100 %. |
| `peida riba`, `näita riba` | hide the bar, show the bar | Folds the bar to a small pill, and back. |
| `ava seaded`, `seaded` | open settings | Opens the settings page. |

Known site names: WhatsApp, Messenger, Facebook, Gmail, Google, YouTube, Postimees, Delfi, ERR, LinkedIn, CV.ee, CV Keskus, Töötukassa, with case endings (`mine whatsappi`, `youtube'i`) and as an Estonian ear spells them (`ava juutuba`, `mine guugel`, `ava vatsap`). Never guessed: sending, resting, waking, undo. `otsi` uses the site's own search, Google when it has none. The zoom is Chrome's own tab zoom (steps 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300 %), so it sticks for the site, and the bar zooms with the page. With the numbers showing, a number alone presses it.

### Video (Video)

Help page: `help.html#video`, or say `abi video`.

| Estonian | English | What happens |
|---|---|---|
| `mängi`, `paus` | play, pause | Plays or pauses the video. |
| `vaiksemaks`, `valjemaks` | volume down, volume up | The volume. |
| `täisekraan` | full screen | Full screen. |
| `keri edasi`, `keri tagasi` | skip forward, skip back | Skips 10 s in the video. |
| `keri edasi üks minut`, `keri kaks minutit tagasi`, `keri tagasi pool minutit`, `keri edasi poolteist minutit`, `keri edasi 30 sekundit` | skip back thirty seconds | Skips by the amount said. |

Bare `keri edasi` and `keri tagasi` skip 10 s; an amount can be said in minutes or seconds.

### Meil (E-mail)

Help page: `help.html#meil`, or say `abi meil`.

| Estonian | English | What happens |
|---|---|---|
| `kirjuta meil Marile`, `kirjuta kiri Marile`, `saada meil Jaanile`, `write an email to Mari` | write an email to Mari | Opens a new message with Mari in To; the body is ready for your words. |
| `kirjuta meil Marile, et tulen homme` | email Mari that I will come tomorrow | Writes the body too. |
| `uus meil` | new email | Opens an empty message with To ready. |
| `teema Koosolek` | subject Meeting | Writes the subject. |
| `lisa koopia`, `lisa koopia Jaanile` | add a copy | Opens Cc. |
| `kirjuta talle meil`, `võta see meiliaadress siit lehelt ja kirjuta talle, et tulen homme` | write to the address on this page | A new mail to an address the page shows (needs the model). |

Off Gmail a new mail opens Gmail's compose page in a new tab first. In the message, `valmis` or `järgmine väli` moves To, Cc, Subject, body in turn, and `saada` clicks Send (never Enter, which is a new line in a mail). `teema` and `lisa koopia` act only in the message: anywhere else a sentence that begins with "teema" is typed. What you say into To or Cc is written as an address ("ät", "punkt"). The e-mail addresses and phone numbers a page shows are read off it (at most 20), so `kirjuta talle meil` opens a new mail to that address; the model may only pick an address the page shows. Tested on `fixtures/gmail.html` and `fixtures/cv.html`; the Gmail selectors are unverified on real Gmail.

### Dokument (Document)

Help page: `help.html#dokument`, or say `abi dokument`.

| Estonian | English | What happens |
|---|---|---|
| `paksuks`, `tee paksuks`, `kaldkirja`, `allajoonitud` | bold, italic, underline | Formats the selection. |
| `pealkirjaks`, `tavaline tekst` | heading, normal text | The paragraph as a heading, or back to text. |
| `loendiks`, `uus lõik` | bulleted list, new paragraph | A list, or a new paragraph. |
| `vali lõik`, `vali viimased kolm sõna` | select the paragraph, select the last three words | Selects the paragraph or the last words. |
| `küsimärk`, `hüüumärk` | question mark, exclamation mark | Ends the sentence with the mark. |
| `loe viimane lause ette`, `loe see ette` | read the last sentence, read this | Reads the last sentence, or the whole box, aloud. |
| `saada` | send | Sends nothing: "Dokumendis ei saadeta." |

A box is a document when it is Google Docs, a textarea or rich editor holding over 500 characters, or a rich editor with headings, lists or paragraphs of its own (never a chat's message box). There a pause of up to 20 seconds does not end the sentence. Only `punkt`, `küsimärk`, `hüüumärk` and `uus lõik` break a sentence. One-word words such as `välja`, `sulge`, `edasi`, `tagasi`, `paus` are typed, not obeyed; the model is asked only when you start with a command word (`vali`, `tee`, `muuda`, `loe`, `kustuta`, `ava`, `mine`, `kirjuta` …). On Google Docs the formats are Docs' own shortcuts, tested on a stand-in only. A plain textarea has no bold or italics and says so.

### Lugemine (Reading aloud)

Help page: `help.html#lugemine`, or say `abi lugemine`.

| Estonian | English | What happens |
|---|---|---|
| `loe ette`, `loe lehte ette` | read the page | Reads the article of the page aloud. |
| `loe see ette` | read this | Reads the armed box, the page when no box is armed. |
| `loe valitud ette` | read the selection | Reads the selected text. |
| `loe edasi` | continue reading | Goes on from the next sentence after a stop. |
| `lõpeta lugemine` | stop reading | Stops the reading. |
| `stopp`, `aitab`, `paus`, `peata` | stop | While it reads: stops the reading first. |

The article is its headline and paragraphs, without the menus, the sidebar, the footer, the cookie banner or the bar. The microphone keeps listening while it reads, so you can say `stopp` over the voice; every other word heard meanwhile is dropped. Pressing the bar's microphone or the toolbar icon also stops a reading. The voice is the browser's own Estonian voice: Chrome has none today, Microsoft Edge has two (Anu and Kert) when its online voices are on. Where no Estonian voice exists nothing is read and the bar says so; Ütle never reads Estonian with an English voice.

### Minu andmed (My details)

Help page: `help.html#minu-andmed`, or say `abi minu andmed`.

| Estonian | English | What happens |
|---|---|---|
| `minu andmed`, `ava minu andmed` | my details | Opens the settings page at Minu andmed. |
| `lisa uus e-post`, `salvesta mu telefon`, `lisa uus isikukood` | add a new email, save my phone | Opens Minu andmed with the voice entry started. |
| `r`, `a`, `ell`, `punkt`, `ät` | letters, one at a time | In the entry: a letter or a mark at a time. |
| `gmail`, `mail punkt ee` | gmail | In the entry: adds the ending. |
| `kustuta`, `kustuta kõik` | delete, delete everything | In the entry: removes the last letter, or all. |
| `loe ette` | read it back | In the entry: reads it back letter by letter on the bar. |
| `valmis` | done | In the entry: saves it. |
| `katkesta` | cancel | In the entry: leaves without saving. |
| `minu e-post`, `mu meil`, `kirjuta mu telefon`, `sisesta minu isikukood` | my email, my phone | In a field: the saved value is typed whole. |

Kept in `chrome.storage.local` (key `savedValues`) on this computer only; the model is told the names, never the values. The first e-mail is called "minu e-post"; a second one of the same kind asks for a name first ("töö e-post"). With two saved and no name the bar asks "Kumb?"; answer with the name, a word of it or `esimene` / `teine`. Spelling: `punkt` is ., `ät` is @, `kriips` is -, `alakriips` is _; numbers become digits; `gmail`, `hotmail`, `outlook`, `icloud`, `yahoo`, `mail punkt ee` add the ending, `oma lõpp` takes it off. An e-mail without @ is not saved. No passwords: a password field is never filled from here.

### Minu kohad (My places)

Help page: `help.html#minu-kohad`, or say `abi minu kohad`.

| Estonian | English | What happens |
|---|---|---|
| `vaata uudiseid`, `näita uudiseid`, `ava uudised` | show the news | Opens your news place. |
| `pane raadio käima`, `ava raadio` | put the radio on | Opens your radio place. |
| `mis ilm on`, `näita ilma` | what's the weather | Opens your weather place. |
| `ava mu mail`, `ava meil`, `vaata videoid` | open my mail, watch videos | Opens your mail or video place. |
| `lisa koht uudised`, `salvesta see koht uudised`, `see on mu uudised` | save this place as news | Saves the tab in front under that word. |
| `lisa koht` | save this place | Asks for the word; say it next. |
| `eemalda koht uudised` | remove the place news | Removes the place. |

Not while a message box is armed: there the words are typed. Defaults: uudised → Postimees, raadio → Vikerraadio's live page, ilm → Ilmateenistus, mail → Gmail, kalender → Google Kalender, kaart → Google Maps, video → YouTube; no bank. The model is told only the words and never sees an address. To save your own, open the page and say `lisa koht uudised`: the address of the tab in front is saved under that word. The settings page's **Minu kohad** section lists them; a helper can type a word and an address there. Stored under `places`.

### Hääl (Listening)

Help page: `help.html#haal`, or say `abi hääl`.

| Estonian | English | What happens |
|---|---|---|
| `puhka`, `ära kuula` | sleep, stop listening | Stops typing what it hears, until woken. |
| `ärka üles` | wake up | Starts again. |
| `katkesta`, `tühista kõik`, `lõpeta kõik`, `stopp kõik` | cancel | Stops everything in flight at once. |
| `Ütle, keri alla` | Ütle, scroll down | With the wake word: the command starts with the word. |
| `Ütle` | Ütle | The word alone opens a 20 s window. |
| `aitab`, `see on kõik` | that's all | Closes the window. |

`katkesta` drops everything in flight at once (the chain, the question to the model, the queued words) with "Katkestatud."; it works while resting too and is never typed. With the wake word (settings, **Kuulamine: Äratussõnaga**) only what starts with the word is acted on; "Ütle" alone opens a 20 s window in which sentences need no word, closed by `aitab`, `see on kõik` or `saada`. The word is matched by sound and must be first. Push-to-talk by looking needs nothing said: look at the microphone (or the whole bar) and speak.

### Abi (Help)

Help page: `help.html#abi`, or say `abi abi`.

| Estonian | English | What happens |
|---|---|---|
| `abi`, `mida ma öelda saan`, `mida ma saan öelda`, `näita käske` | help, what can I say | Opens the help page. |
| `abi kerimine`, `abi vormid`, `abi minu andmed` | help scrolling | Opens the help page at that group. |

Rules only, never the model. With words in the armed box a one-word `abi` is typed ("Abi!" is a message). `loe ette` on the help page reads the open group. The page is `extension/help.html`; `help.html#kerimine` opens a group.

<!-- phrases:end -->

## Minu andmed: an e-mail, a phone number, an ID code (round 6)

Spelling an address letter by letter every time is hard work. Save it once; afterwards say its name in
any field. ARCHITECTURE 26 is the spec.

**Saving it.** Say `minu andmed` (or `ava minu andmed`, `ava seaded` for the whole page) from any page:
the settings page opens at the **Minu andmed** section. Say `lisa uus e-post` (or `salvesta mu telefon`,
`lisa uus isikukood`, English `add a new email`, `save my phone`) and the page opens with the voice
entry already started:

- spell it one utterance at a time: `r`, `a`, `ell`, `f`, `punkt`, `tee`, `a`, `emm`, `m`. A whole
  stretch in one breath works too (`ralf punkt tamm`). `punkt` is ., `ät` is @, `kriips` is -,
  `alakriips` is _; numbers become digits. Each letter shows as a chip.
- for the ending say `gmail` (@gmail.com), `hotmail`, `outlook`, `icloud`, `yahoo` or `mail punkt ee`
  (@mail.ee): it shows as a dashed chip and is added when you save. `oma lõpp` takes it off.
- `kustuta` removes the last letter, `kustuta kõik` starts over, `loe ette` reads it back letter by
  letter on the bar.
- `valmis` saves it; `katkesta` leaves without saving. An e-mail without @ is not saved (the bar says
  what is missing).
- the first e-mail is called "minu e-post" (the first phone "minu telefon", the first ID code "minu
  isikukood"); a second one of the same kind asks for a name first ("töö e-post").

Tom can do the same by keyboard in the form under the list (name, kind, value, **Salvesta**). Each saved
item has **Muuda** and **Unusta**, and under it what to say ("Ütle: minu e-post, mu meil"). The buttons
are dwellable like the rest of the page.

**Using it.** In a field (after `kirjuta siia`, a label number, or `valmis` from the field before) say
`minu e-post`, `mu meil`, `pane mu email sinna`, `kirjuta mu telefon`, `sisesta minu isikukood`, `my email`.
The value is typed whole at once, no model asked, and the bar reads it back: "Kirjutasin:
ralf.tamm@gmail.com (minu e-post). Ütle „valmis“ või „edasi“." With two e-mails saved and no name the
bar asks "Kumb: minu e-post või töö e-post?"; answer with the name, a word of it (`töö`) or `esimene` /
`teine`. When a field you arm has a saved value of its kind, the bar says so: "Kast on valitud.
Räägi. Või ütle „minu e-post“." Free phrasing goes to the model, which knows the names (never the values)
and may pick the field first: `täida telefon`, `sisesta see gmaili aadress`.

**Where it is kept.** `chrome.storage.local`, key `savedValues`, on this computer only. The model is
told the names; the values never leave the machine and are never in a log line. No passwords: a
password field is never filled from here.

## The dev server's log lines

`npm run dev` logs counts and reasons only, never words or audio. What to look for:

- `[asr] model loaded on a worker thread in N ms`: the model decodes on its own thread, so a slow
  model answer or a busy page never delays speech. This needs Node 22.18 or newer (it runs the
  `.ts` worker file as is). On an older Node the line is `[asr] decode worker could not start;
  decoding on the server thread` and then `[asr] model loaded on the server thread in N ms`: it
  still works, with a bounded backlog.
- `[asr] local recogniser unavailable: model_missing`: run `npm run model`.
- `[asr] connection opened on the worker (1 open)` when the microphone is turned on, and
  `[asr] connection closed, code N: X s received, Y s dropped (0 open)` when it is turned off. A
  dropped count above 0 means the server fell behind and threw old audio away; the bar showed
  "Kõne jääb maha N s" while it did.
- `[intent] kind=command done=true plan=2 care=careful ms=1800`: one answer of the model (`care` is quick or careful, round 5; `plan` is how many goals
  it left for later, round 4); `[intent] error=upstream_rejected` with no key.
- `[asr] vad model loaded` (round 7): the speech detector is in front of the decoder, so room noise
  is never decoded into words. `[asr] no vad model`: `npm run model` has not fetched it; every frame
  is decoded, as before round 7.
- `[asr] final judged owner 0.712 (only owner on)`: each final's verdict and score, never its words.
- `[asr] speaker model loaded; owner's voice learnt` once the model and the profile are there
  (round 4); `[asr] no speaker model (npm run model fetches it; loudness only until then); owner's
  voice not learnt yet` when neither is. The two halves vary on their own. Nothing says whose
  voice an utterance was; the close line counts the finals of other voices.
- `[soniox] connecting`, `[soniox] session open`, `[soniox] browser closed, code 1000`; with no key
  `[soniox] SONIOX_API_KEY is not set; the Soniox engine is unavailable`.

## What the page tells the model (`readPage`)

The model only knows what `readPage` reports, so `extension/src/page.ts` reads the page the way an
accessibility tree would, on any site, without site-specific paths:

- **Names.** Each item's text is, in order: `aria-labelledby`, `aria-label` (when the label only
  spells out the visible text, the visible text), a field's `<label>` (`for=` or wrapping), its
  placeholder, its title, an image's alt, the first line of visible text, `title`, an inner image's
  alt or svg title, and for a link without text the heading or title of its card. Whitespace is
  collapsed, 60 characters at most. On WhatsApp a chat row's name is its title span.
- **One item per card.** Links to the same address (a video's thumbnail, title and duration badge)
  are one item, named by the best of them. Links to `/watch?v=` or `/shorts/`, or holding a
  `<video>`, have the role `video`; the playing video itself is `video` "praegune video".
- **Dialogs first.** Inside an open dialog (`role=dialog`, `aria-modal`, `<dialog open>`) or a cookie
  banner (a fixed or absolute layer over a fifth of the screen whose text says cookie, küpsis,
  nõustu, accept or consent), items come first and their text begins with `[dialog] `. Elements the
  layer covers are not listed, so the model sees the banner and little else until it is dismissed.
  When nothing outside the banner is reachable (delfi.ee's popup on a full-screen overlay, err.ee's
  modal), the items below the fold and the main video are left out too (30.4).
- **Below the fold.** Up to 30 items within one screen below the fold follow the visible ones, their
  text beginning with `[allpool] `. `clickItem` and `focusItem` scroll such an item to the middle
  of the screen first. The numbers (`showHints`) label only the visible items, and the ids agree:
  the `[allpool] ` ids continue after the last number.
- **Markers.** The page's `h1` is an item of role `other`, `[pealkiri] …`; on a messaging site the
  open chat's name is `[vestlus] …`. Both come last.
- **Too many.** With more than 120 visible candidates the page keeps dialog items, then prefers
  items with text, in the main content (`main`, `[role=main]`, `#content`, `#primary`, `article`)
  over header, sidebar and footer, and larger over smaller; the kept items are then in reading order.
- **Clicking.** `clickItem` and `clickHint` send the pointer sequence and a click, then watch 400 ms
  for a reaction (address or title changed, focus moved, a dialog opened or closed, the element's
  `aria-pressed`, `aria-expanded`, `aria-selected`, `aria-checked` or class changed, the element or
  its surroundings mutated, or a burst of 20 nodes anywhere). With no reaction they focus the element
  and send Enter, then Space; a link that still did nothing is followed by its address.
- **The box.** The armed field wins, then the focused field, then the site's composer, then the
  lowest text field; except that a focused search field gives way to a visible site composer
  (WhatsApp focuses its chat search by itself). A field the user really clicks or tabs into
  (a trusted pointerdown, or a trusted Tab followed by focus) is armed as if by "kirjuta siia"
  (`watchTrustedClicks` in `box.ts`, called by `page.ts`; the strip should call it too so a click
  before the first command counts). Focus the page sets by script arms nothing.
- **Scrolling.** `scroll` moves the largest scrollable container under the middle of the screen,
  then the next one, then the document; when nothing moved it answers `failed`, so the model can do
  something else.
- **Text items (round 4).** After the actionable items and the markers come the things he may refer
  to that are not clickable, role `text`: on a messaging site the open chat's messages as
  `[sõnum] …` (his own as `[sõnum] mina: …`, so "Karini viimane sõnum" is the last one without
  `mina:`), then headings `h1` to `h3`, list items and paragraphs of 12 to 160 characters. Visible
  only, deduplicated by text, top to bottom, 60 characters each, at most 40, and at most 150 items
  in all. Over the cap a chat keeps the bottom-most (the latest messages), any other page the
  top-most. Text inside or around a clickable thing is not repeated (it is that thing's name), nor
  is the `h1` that is already `[pealkiri]`. The numbers never label text items; their ids continue
  after the actionable ids. A message container (and WhatsApp's `role=row` around it) is not an
  actionable item, so a chat is not listed twice; a control inside a message (the hover arrow, a
  link) still is. The message selectors are `messageRows`, `messageText`, `messageMenu` and
  `messageMine` in `sites.ts`; the arrow named by `messageMenu` is listed as the button
  `sõnumi menüü`.
- **hover, contextMenu, scrollTo (round 4).** `hover {id}` rests the pointer on an item: `pointerover`,
  `mouseover`, `pointerenter` and `mouseenter` on the element and each ancestor, then `pointermove`
  and `mousemove` at its centre, repeated every 200 ms for 3 s, so a control that shows on hover
  only (WhatsApp's message arrow, YouTube's card menu, Gmail's row actions) is still there when the
  page is read again and clicked. The next `hover` on an unrelated element sends the leave events to
  the old one. `contextMenu {id}` is a right click at the centre (`pointerdown` and `mousedown` with
  button 2, then `contextmenu`, bubbling and cancelable), for sites whose actions live in their own
  context menu. `scrollTo {id}` scrolls the item to the middle of its pane and waits 200 ms. All three
  take a text item as well as an actionable one; an id that is gone answers `not_found`. Every click
  (`clickItem`, `clickHint`) now starts with the hover sequence, so a control that needs hover state
  reacts; `clickItem` on a text item is a click at its centre with no fallbacks (on WhatsApp it
  selects the message). The events land on the element at the item's centre (a message's text
  span), as a real pointer's would, and bubble from there.
- **Unverified on real WhatsApp.** The message selectors in `sites.ts` (`messageRows`,
  `messageText`, `messageMenu`, `messageMine`) are guesses from WhatsApp Web's DOM of earlier
  builds, marked UNVERIFIED 2026-10-06; so is whether its arrow shows on synthetic `mouseover`
  (React tracks hover through `mouseover`/`mouseout`, which is what is sent). If the demo shows no
  `[sõnum]` items or no `sõnumi menüü` after a hover, those four lines are the place to fix. The
  stand-in `extension/test/fixtures/whatsapp.html` has the guessed structure: a `role=row` per
  message, `div[data-id].message-in|out`, the text in `span.selectable-text.copyable-text`, an
  arrow `div[role=button][aria-label="Context menu"]` shown on hover, a menu (Vasta, Edasta,
  Kustuta sõnum), a confirmation dialog with `div[role=button]`s (Kustuta minu jaoks, Kustuta kõigi
  jaoks, Tühista), and a `contextmenu` handler that opens the same menu.

## Test

- `npx tsx extension/test/run.ts`: every browser command, including `readBox`, `setText`,
  `pressSend`, the M7 page commands (`readPage`, `clickItem`, `focusItem`, `siteSearch`, `media`,
  `pressKey`, `clearField`, `arm`, `bar`), the round 3 scroll modes (a page is 80% of the view, a little
  a third, slow about 90 px/s until `stop`) and the editing commands (`caret`, `select`, `typeText`,
  the editing keys) on `fixtures/essay.html` (the same three paragraphs as a contenteditable and as
  a textarea), on a YouTube-like stand-in (`fixtures/video.html`: a cookie
  banner, ten video cards with thumbnail, title and channel links, some below the fold, an
  `aria-labelledby` button, a tile that reacts to Enter only), a Gmail-like compose window
  (`fixtures/gmail.html`: `role=dialog`, fields named by `<label for>`, a send button), a Smart-ID-like
  login (`fixtures/login.html`, round 5: one-line fields of every kind, Isikukood, Telefon, E-post, Summa,
  PIN1 and a textarea; each field's kind read back, the converted values typed, Tab on, Enter submits
  once), the tab zoom (round 5: 100 to 110, 125, 150 and back, the strip keeping its CSS size) and a
  WhatsApp stand-in page. Builds the extension first. Opens Chromium windows on screen for about a
  minute. The Messenger stand-in is served on the IPv6 loopback; where `[::1]` is unreachable (some
  containers) that part prints SKIP. Without a screen: `xvfb-run -a -s "-screen 0 1600x1000x24" npx tsx extension/test/run.ts`.
- `npx tsx extension/test/voice.ts`: by voice with no person. Needs `npx vite --port 5193 --strictPort`
  running (another port: `UTLE_PORT=5194` for both). A fake microphone plays Estonian recordings
  (`scripts/fixtures/et-dictate-send-16k.wav`, `et-scroll-tab-16k.wav`, `et-numbers-one-16k.wav`)
  into the real recogniser; the extension is built with a stand-in for the step logic
  (`extension/test/standin.ts`). It prints the box text every 100 ms and the time from the end of
  speech to the first and the final words in the box. `UTLE_ONLY=dictate|scroll|newtab` runs one part.
- `npx tsx extension/test/voice.ts baseline`: the same dictation timing as the extension behaved
  before live words (no previews, 700 ms hold), for comparison.
- `npx tsx extension/test/voice.ts down`: with the dev server stopped; start it when the test says so.

## Where the strip cannot be

Chrome lets no extension draw on these, so the strip is absent and voice commands there answer that
the page is not allowed: `chrome://` pages other than the new tab (settings, extensions, history,
downloads), the Chrome Web Store (`chromewebstore.google.com`), `view-source:` pages, the built-in
PDF viewer, and other extensions' pages. Switching tabs and going to a site by voice still work
from them. If another extension also replaces the new-tab page, Chrome uses only one of them.
Ütle's own pages (the new tab, the settings page) carry the strip, so the settings can be changed by
voice or by dwell. On Google Docs the strip is there, but the document is a canvas: dictation and the
keys reach it, the whole-box repairs and "find a word" do not (see "What to say").

## Unverified

- WhatsApp Web with a chat open: the composer, the send button, the open chat's name, and whether
  a synthetic Enter sends. Each selector in `extension/src/sites.ts` says VERIFIED or UNVERIFIED;
  to fix one, change it there, `npm run ext`, reload the extension.
- Messenger: every selector is a best guess; nobody has tried it logged in.
- YouTube and Google (M7): the search-field selectors in `SEARCH_FIELDS` and `#movie_player` holding
  the `<video>` were seen on the real public pages on 2026-10-27 (`scripts/real-pages.ts`,
  `docs/proof/r9-real-pages.md`); a search was not typed there (read only). Still unverified: the
  player shortcuts `media` sends to `#movie_player` (k, m, f, arrows, j, l), not tried by voice; the
  element API is the fallback either way. `fullscreen` needs a user gesture Chrome may not grant to
  an injected script; it then answers failed. The mobile site (`m.youtube.com`) was not opened.
- The unknown-site composer rule (a textarea or contenteditable with a send, post, comment or reply
  button in its form or within 200 px) is tested on stand-ins only.
- What `readPage` makes of the real Gmail and WhatsApp pages (names, one item per card, the items
  below the fold, the click fallbacks) is tested on the stand-ins above, not on the sites. Seen on
  the real public pages on 2026-10-27 (ARCHITECTURE 30.4): the cookie banner listed first on
  youtube.com, google.ee, postimees.ee, delfi.ee, err.ee, ilmateenistus.ee and otse.err.ee, the item
  counts there, and `loe ette` on one article each of postimees.ee, delfi.ee and err.ee. Not seen:
  the click fallbacks on those sites (only a consent button was clicked, by Playwright), YouTube
  logged in, any page at another window size than 1280 x 900.
- The strip covers the bottom 128 px of the screen, and a page's own fixed layer there stays under
  it: on youtube.com and ilmateenistus.ee the consent button sits under the strip (2026-10-27), so a
  pointer or dwell cannot click it. `readPage` still lists it as `[dialog] …`; a click on it by voice
  was not tried on the real page.
- Whether the strip makes room on the real WhatsApp layout (tested on stand-ins built on `100%`
  and on `100vh` heights).
- Branded Google Chrome (tested in Playwright's bundled Chromium only), including how it asks about
  the replaced new-tab page, and a real microphone and voice (tested with recorded speech through a
  fake microphone).
- Live words on real WhatsApp: whether its composer takes the typed-at-the-end words as smoothly as
  the Lexical stand-in does.
- The development page at localhost (section 20) still works through `relay.js` as a harness.
- Round 3, all of it: nothing below has been tried with a real voice.
  - Push-to-talk by looking with a real eye tracker: the 250 ms arming and 600 ms grace are unit
    tested with fake clocks and chosen by reasoning, not measured against a tracker's jitter; whether
    a page swallows the pointer-leave event so that the one-second poll is what ends listening.
  - Soniox: no key was available. The field names in `server/soniox.ts` come from Soniox's client
    source, not from a session; `server/soniox.test.ts` proves the mapping against a scripted Soniox.
  - Google Docs: the editor selectors (`iframe.docs-texteventtarget-iframe`) and its key habits are
    from knowledge of its markup; nothing was run on docs.google.com.
  - The decode worker on the laptop's Node: Node 22.18 or newer runs the `.ts` worker; an older one
    logs the fallback line and decodes on the server thread. The worker was run here against a fake
    addon and against the real addon without the model files, not with the model.
  - The bounded backlog under real load (screen recording, a model call in flight): tested with a
    fake slow decoder.
  - The sound-alike rows (`juutuba`, `aga whatsapp`, `saadake`): from the owner's report, not from
    recordings of his voice.
- Round 4, all of it: nothing below has been tried with a real voice or on a real site.
  - Chains with a real voice: whether the recogniser hears "siis" after a pause as "siis", and
    whether 2.5 s is the right wait; the chain itself is tested with fakes in the engine and with the
    real model against fake pages in the eval.
  - The speaker model on a real voice: round 7's `OWNER_THRESHOLD` (0.54) is measured on synthetic
    Estonian voices only (HANDOFF 1g); re-pick it with UTLE_CAPTURE and `scripts/speaker-calibrate.ts`.
  - The WhatsApp and Messenger message selectors (`messageRows`, `messageText`, `messageMenu`,
    `messageMine` in `sites.ts`), every one marked UNVERIFIED 2026-10-06.
  - Hover on real sites: whether WhatsApp's arrow, YouTube's card menu and Gmail's row actions
    show on the synthetic pointer events (tested on stand-ins that react to `mouseover`).
  - The delete-for-everyone chain end to end on real WhatsApp: it runs on the stand-in only.
- Round 5, all of it: nothing below has been tried with a real voice or on a real site.
  - The real Smart-ID login page and real bank forms: how their fields are marked up (so which kind
    `fieldKindOf` gives them), whether their scripts accept a value set by `setText` and a synthetic
    Enter, and whether `valmis` lands where a real Tab would. Proven on `fixtures/login.html` only.
  - The conversions on a real voice: how the recogniser writes `ät`, `punkt`, `pluss`, a string of digits
    said one by one, and a letter name such as `ess`; the tables in `src/core/spelling.ts` come from
    reasoning about its output, not from recordings.
  - The latency of a careful ask (a sentence of eight words or more, or a chain) on the real model with
    effort high: expected a few seconds, capped at 12 s on the server and 14 s in the engine, never
    measured. `npx tsx scripts/intent-eval.ts` prints the care per ask.
  - Whether the recogniser hears `katkesta` as one word, and how the 25 s watchdog feels in use.
  - Zoom on a real site: whether the site's own layout and the strip stay usable at 200 % and above.
