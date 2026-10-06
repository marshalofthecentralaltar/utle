# Ütle

Ütle on Chrome'i laiendus inimestele, kes ei saa oma käsi kasutada. Eestikeelne kõne kirjutatakse
otse avatud veebilehe enda sõnumikasti (esmalt WhatsApp Web) ning häälkäsklustega saab lehte kerida,
vahelehti vahetada ja saite avada. Kõne tuvastab Tallinna Tehnikaülikooli keeletehnoloogia labori
mudel, mis töötab samas arvutis, nii et heli arvutist välja ei lähe. Tegemist on häkatoni
prototüübiga: seda ei ole veel proovinud inimene, kellele see on mõeldud, ega ole seda proovitud
päris pilgujälgimisseadmega. Paigaldamiseks on praegu vaja arendaja oskusi; juhend on allpool inglise
keeles.

## What it does

Ütle is a Chrome extension for people who cannot use their hands. A black bar sits at the bottom of
every web page, with one large microphone button. Click it, or rest an eye-tracker pointer on it for
one second, and Ütle listens. Estonian speech is typed into the site's own message box while you
speak. You correct it by voice ("mitte kolm, vaid neli", "kustuta viimane sõna", "võta tagasi") and
send it with "saada". You can edit inside the text too: move the caret between words, sentences and
lines, select, insert in the middle, delete letters. The same voice scrolls the page (a page, a
little, slowly, stop), switches tabs, opens sites, and clicks anything through numbered labels
("näita numbreid", then the number). What the fixed phrases do not cover is understood by meaning,
with a Claude model that sees the words and what is on the page (it needs a key on the local server).
Listening is a toggle, or, for an eye tracker, push-to-talk by looking: it listens while the pointer
rests on the microphone and delivers the words when it leaves.

Since 6 October one breath may hold a chain of things to do ("mine whatsappi, siis ava Karini viimane
sõnum, siis kustuta see kõigi jaoks"), done one after the other with the bar showing where it is;
the server can learn your voice so that, with "Kuula ainult mind" on, other people's speech is
skipped; and the model sees the messages, headings and paragraphs on the page too, can rest the
pointer on one so its hidden controls appear, and can open its menu.

Since the afternoon of 6 October forms work by voice: an ID code, a phone number, an e-mail address
or a PIN said as words ("kolm üheksa null kaks", "ralf punkt sepp ät gmail punkt com") is typed as
digits and characters into a one-line field, read back by the bar, and "valmis" moves to the next
field, "kinnita" submits. A long sentence or a chain makes the model think longer before it acts,
a short command stays quick, nothing can wait more than 25 seconds, and "katkesta" stops everything
at once. "Suurenda" and "vähenda" zoom the page.

Nothing opens in a separate window. Ütle also replaces Chrome's new-tab page with the same bar and
large tiles for common sites, so the bar is there on an empty tab too.

Speech is recognised by TalTech's Estonian model, running on your own computer through a small local
server that you start with `npm run dev`. Soniox, a hosted recogniser, can be chosen instead on the
settings page when a `SONIOX_API_KEY` is set on that server; audio then leaves the computer.

Built at the NewWorkTech Inclusive Digital Innovation Hackathon, TalTech Mektory, Tallinn, 5 and 6
October 2026.

## Status

This is a hackathon prototype.

- Dictating and sending a message has been done on real WhatsApp Web, with the first version, by the
  developer and one team member, both with ordinary voices.
- Typing the words while you speak, and the new-tab page, have been tested only with recorded
  speech in the Chromium browser that the tests use. They have not yet been tried on real WhatsApp
  or in Google Chrome.
- It has not been tried with the voice of the person it is for, or with a real eye tracker.
- Messenger has never been tried on the real site.
- Everything from the night of 5 October (editing inside the text, push-to-talk by looking, sound-alike
  commands, slow scrolling, Soniox, the speech server that never falls behind) is proven with recorded
  speech, stand-in pages and unit tests only. Google Docs has not been tried on the real site; Soniox
  has not been tried with a key.
- Everything from 6 October (chains of goals, only your own voice, the messages and hover on the
  page) is proven on stand-in pages and with fakes only: no real voice, no real site, and the
  speaker model never run on an Estonian voice. The WhatsApp message selectors are guesses.
- Everything from the afternoon of 6 October (forms by voice, the model's care, the 25-second limit
  and "katkesta", zoom) is proven on stand-in pages only: a Smart-ID-like test page, not the real
  one; no real bank form; the conversions never heard from a real voice.
- Built and tested on Windows 11 only.

Known faults: if you keep talking straight after a short command, the command word can show in the
box for a moment; the words arrive in small bursts, about every 0.6 seconds; Chrome's own pages
cannot show the bar (see below).

## Requirements

- Google Chrome on a computer.
- Node.js 22.18 or newer (Node 22 or 24). The build tools need at least 22.12; from 22.18 the speech
  server decodes on its own thread (it runs a `.ts` worker file as is). On 22.12 to 22.17 it still
  works, decoding on the server thread, and logs `decode worker could not start`.
- Git.
- About 380 MB of disk space: the speech model is 156 MB, the optional speaker model 29 MB, and the
  installed packages about 190 MB. Running the extension tests downloads a test browser on top of that.
- A microphone.

## Install

Every step is run from a terminal. Steps 1 to 5 are done once.

1. Get the code:

   ```
   git clone <repository address> utle
   cd utle
   ```

2. Install the packages:

   ```
   npm ci
   ```

3. Download the Estonian speech model (156 MB, into `models/`) and the small speaker model for
   "Kuula ainult mind" (29 MB, into `models/speaker/`; a failure there is only a warning):

   ```
   npm run model
   ```

4. Build the extension (into `extension/dist/`):

   ```
   npm run ext
   ```

5. Load it in Chrome:
   1. Open `chrome://extensions`.
   2. Turn on **Developer mode** (top right).
   3. Press **Load unpacked** and choose the `extension` folder inside `utle` (not `extension/dist`).
   4. A tab "Ütle vajab mikrofoni" opens by itself. When Chrome asks to use the microphone, press
      **Allow**. The tab closes itself.
   5. Pin the Ütle icon: the puzzle piece in the toolbar, then the pin.
   6. Open a new tab. If Chrome asks whether to keep the changed new-tab page, choose **Keep it**.

6. Start the speech server, and keep this terminal open whenever you use Ütle:

   ```
   npm run dev
   ```

   It serves the speech model at `ws://localhost:5173/api/asr`. If it is not running, the bar says so
   in one red line.

7. Open WhatsApp Web, open a chat, turn the microphone on in the bar, and speak.

If the speech server runs at another address, set it under **Details**, then **Extension options**
on the Ütle card in `chrome://extensions`, then reload the extension.

## Update

```
git pull
npm ci
npm run ext
```

Then on `chrome://extensions` press the reload arrow on the Ütle card, and reload the tabs that were
already open. `npm run model` skips files it already has, so it only needs running again if the
model changes.

## What to say

Anything that is not a command is typed into the message box. Commands are matched on the whole
utterance, in Estonian or English, whatever was said before. The bar's own lines are in Estonian.
What no fixed phrase covers ("uus leht", "vajuta Mari", "pane vaiksemaks") is understood by meaning
when the local server has an `ANTHROPIC_API_KEY`. The full list, with the English forms, is in
`extension/README.md` ("What to say"); the rules are `docs/ARCHITECTURE.md` 21.1, 22, 23, 24 and 25.

| Estonian | English | What happens |
|---|---|---|
| (anything else) | (anything else) | Typed into the message box. |
| saada, saada ära, saadake | send, send it | Sends what is in the box. |
| mitte kolm, vaid neli; kolme asemel neli | not three but four | The last "kolm" in the box becomes "neli". |
| kustuta viimane sõna, kustuta viimane lause, kustuta kõik | delete the last word, the last sentence, everything | Removes it. |
| uus rida; punkt, koma | new line; full stop, comma | Adds a line break or the mark. |
| võta tagasi | undo | Puts back the text from before the last change. |
| mine algusesse, lause lõppu, sõna tagasi, kolm sõna edasi, mine sõna homme ette | go to the start, end of the sentence, word back, go before homme | Moves the caret inside the text. |
| vali kõik, vali see lause, vali homme | select all, select the sentence, select homme | Selects inside the text. |
| kirjuta siia vahele kell viis | insert at five | Types at the caret. |
| kolm üheksa null kaks; ralf punkt sepp ät gmail punkt com | three nine zero two; ralf dot sepp at gmail dot com | Into a code, phone, e-mail or PIN field: typed as 3902, ralf.sepp@gmail.com. The bar reads the field back. |
| valmis, edasi; kinnita, logi sisse | done, next; submit, log in | In a form field: the next field; submit the form. |
| numbritena; tavaliselt; kirjuta kood 3902 | as digits; normally; type code 3902 | Writes everything as digits until told otherwise; one value as a code. |
| katkesta | cancel | Stops everything in flight at once. |
| suurenda, vähenda, tavaline suurus | zoom in, zoom out, normal size | The page's size, kept per site. |
| kustuta täht, kustuta kolm tähte, kustuta sõna homme, vasakule, tee uuesti | delete a letter, delete three letters, delete the word homme, arrow left, redo | The editing keys. |
| puhka, ära kuula | sleep, stop listening | Stops typing what it hears, until woken. |
| ärka üles | wake up | Starts again. |
| kirjuta Marile, ava vestlus Mariga | write to Mari, open chat with Mari | Opens the chat with Mari. |
| kirjuta Marile, et ma jõuan homme | tell Mari that I will come tomorrow | Opens the chat with Mari and writes the sentence. It does not send. |
| mine whatsappi, siis ava Karini viimane sõnum, siis kustuta see kõigi jaoks | go to whatsapp, then open Karin's last message, then delete it for everyone | A chain: the goals are done one after the other (needs the model). Say "siis" or "ja siis" between them; a pause is fine. |
| keri alla, keri üles | scroll down, scroll up | Scrolls most of a screen, smoothly. |
| keri natuke alla, keri aeglaselt alla, stopp | scroll down a little, scroll down slowly, stop | A third of a screen; a steady slow scroll; stop it. |
| lehe algusesse, lehe lõppu | scroll to the top, scroll to the bottom | Goes to the top or the end of the page. |
| järgmine vaheleht, eelmine vaheleht, kolmas vaheleht | next tab, previous tab, third tab | Switches tabs. |
| uus leht, sulge | new page, close | Opens a new tab; closes this one. |
| mine tagasi, mine edasi, laadi uuesti | page back, go forward, reload | The page history; reload. |
| ava whatsapp, mine postimees.ee, ava juutuba | open whatsapp, go to postimees.ee | Opens a known site or an address, also when the name is heard the Estonian way. |
| otsi kassivideod | search for cat videos | Searches on the site in front, or Google. |
| näita numbreid; vajuta viis, or just "viis" | show numbers; click five | Puts a number on everything clickable; clicks number five. |
| kirjuta siia | write here | Makes the focused field the place the words go. |
| mängi, paus, vaiksemaks, täisekraan | play, pause, volume down, full screen | The video on the page. |
| peida riba, näita riba | hide the bar, show the bar | Folds the bar to a small pill, and back. |

Known site names: WhatsApp, Messenger, Facebook, Gmail, Google, YouTube, Postimees, Delfi, ERR,
LinkedIn, CV.ee, CV Keskus, Töötukassa. Estonian case endings are understood ("mine whatsappi"), and
so are the names as an Estonian ear spells them ("juutuba", "guugel", "vatsap"). A short command that
was misheard by a letter or by a sound ("aga whatsapp", "keri ala") is usually still understood, and
the bar says what it took it to be. "Saada", "puhka", "ärka üles" and "võta tagasi" are never guessed.

## What it does not do

- It does not work outside Google Chrome, and does nothing outside web pages.
- The bar cannot appear on Chrome's own pages (settings, extensions, history, downloads), on the
  Chrome Web Store, on `view-source:` pages, in the built-in PDF viewer, or on other extensions'
  pages. Switching tabs and opening a site by voice still work from there.
- It cannot be installed from the Chrome Web Store, and it needs the local speech server running.
- Messenger support is a best guess that nobody has tried logged in.

## Privacy

- Audio never leaves the computer with the default speech model. The extension sends it only to the
  speech server on the same machine (`localhost`). The one exception is chosen on purpose: with
  Soniox selected on the settings page and a `SONIOX_API_KEY` on that server, the server forwards the
  audio to Soniox.
- The free-form understanding sends the words you said and what is on the page (addresses, titles,
  the visible buttons and links, the message box text) to Anthropic's API when the server has an
  `ANTHROPIC_API_KEY`; never the audio. Without the key, the fixed phrases still work.
- Nothing you say or type is logged. The speech server prints only how long the model took to load,
  why it cannot recognise if the model is missing, a line when a connection opens or closes (with the
  number of open connections and the close code), and "decode failed" if decoding fails.
- No account and no key are needed for the extension.
- The development page at `http://localhost:5173` (the original document editor, kept for
  development) is different: if the local model is missing it falls back to Chrome's own speech
  recognition, which Google runs on its servers, and its document edits send the document text to
  Anthropic's API when an `ANTHROPIC_API_KEY` is set. The extension uses neither.

## Tests

```
npm run check
```

runs the type check, lint, the unit tests and both builds. It needs neither the model nor a
browser.

The extension tests drive a real Chromium window for about a minute. The first time, install the
test browser:

```
npx playwright install chromium
npx tsx extension/test/run.ts
```

The voice test plays recorded Estonian through the real speech model, so it needs the model and a
second dev server on another port. `UTLE_REAL=1` builds the extension with the real command logic;
without it the test uses a simplified stand-in and does not test the product. In one terminal:

```
npx vite --port 5193 --strictPort
```

In a second terminal, in PowerShell (the usual Windows terminal):

```
$env:UTLE_REAL=1; npx tsx extension/test/voice.ts
```

or in bash (macOS, Linux, Git Bash):

```
UTLE_REAL=1 npx tsx extension/test/voice.ts
```

`extension/README.md` describes the test options.

## Licence and credits

Ütle's code is under the MIT licence: see `LICENSE`.

Estonian speech recognition is not ours. The model `streaming-zipformer-large.et-en` was made by
Tanel Alumäe's Laboratory of Language Technology at Tallinn University of Technology (TalTech) and
is published under the MIT licence. Ütle runs it with sherpa-onnx (Apache-2.0). Everything else
that is not ours, and its licence, is listed in `THIRD-PARTY.md`.

The design and its history are in `docs/ARCHITECTURE.md`. What the product is, in plain words:
`docs/PRODUCT.md`.
