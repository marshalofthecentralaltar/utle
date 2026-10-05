# Ütle

Ütle on Chrome'i laiendus inimestele, kes ei saa oma käsi kasutada. Eestikeelne kõne kirjutatakse
otse avatud veebilehe enda sõnumikasti (esmalt WhatsApp Web) ning häälkäsklustega saab lehte kerida,
vahelehti vahetada ja saite avada. Kõne tuvastab Tallinna Tehnikaülikooli keeletehnoloogia labori
mudel, mis töötab samas arvutis, nii et heli arvutist välja ei lähe. Tegemist on häkatoni
prototüübiga: seda ei ole veel proovinud inimene, kellele see on mõeldud, ega päris
pilgujälgimisseadmega. Paigaldamiseks on praegu vaja arendaja oskusi; juhend on allpool inglise
keeles.

## What it does

Ütle is a Chrome extension for people who cannot use their hands. A black bar sits at the bottom of
every web page, with one large microphone button. Click it, or rest an eye-tracker pointer on it for
one second, and Ütle listens. Estonian speech is typed into the site's own message box while you
speak. You correct it by voice ("mitte kolm, vaid neli", "kustuta viimane sõna", "võta tagasi") and
send it with "saada". The same voice scrolls the page, switches tabs, opens sites, and clicks
anything through numbered labels ("näita numbreid", then the number).

Nothing opens in a separate window. Ütle also replaces Chrome's new-tab page with the same bar and
large tiles for common sites, so the bar is there on an empty tab too.

Speech is recognised by TalTech's Estonian model, running on your own computer through a small local
server that you start with `npm run dev`.

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
- Built and tested on Windows 11 only.

Known faults: if you keep talking straight after a short command, the command word can show in the
box for a moment; the words arrive in small bursts, about every 0.6 seconds; Chrome's own pages
cannot show the bar (see below).

## Requirements

- Google Chrome on a computer.
- Node.js 22.12 or newer (Node 22 or 24). The test runner and the build tools need at least 22.12.
- Git.
- About 350 MB of disk space: the speech model is 156 MB, and the installed packages about 190 MB.
  Running the extension tests downloads a test browser on top of that.
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

3. Download the Estonian speech model (156 MB, into `models/`):

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

| Estonian | English | What happens |
|---|---|---|
| (anything else) | (anything else) | Typed into the message box. |
| saada, saada ära | send, send it | Sends what is in the box. |
| mitte kolm, vaid neli | not three but four | The last "kolm" in the box becomes "neli". |
| kolme asemel neli | | The same, for one or two words each. |
| asenda kolm sõnaga neli | replace three with four | The same. |
| kustuta viimane sõna | delete the last word | Removes the last word. |
| kustuta viimane lause | delete the last sentence | Removes the last sentence. |
| kustuta kõik | delete everything | Empties the box. |
| uus rida | new line | Adds a line break. |
| punkt, koma, küsimärk, hüüumärk | full stop, comma, question mark, exclamation mark | Said on its own: adds the mark. |
| võta tagasi | undo | Puts back the text from before the last change. |
| puhka, ära kuula | sleep, stop listening | Stops typing what it hears, until woken. |
| ärka üles | wake up | Starts again. |
| kirjuta Marile, ava vestlus Mariga | write to Mari, open chat with Mari | Opens the chat with Mari. |
| kirjuta Marile, et ma jõuan homme | tell Mari that I will come tomorrow | Opens the chat with Mari and writes the sentence. It does not send. |
| keri alla, keri üles | scroll down, scroll up | Scrolls the page. |
| lehe algusesse, lehe lõppu | scroll to the top, scroll to the bottom | Goes to the top or the end of the page. |
| järgmine vaheleht, eelmine vaheleht | next tab, previous tab | Switches tabs. |
| kolmas vaheleht | third tab | Goes to the third tab. |
| ava uus vaheleht | new tab | Opens a new tab. |
| sulge vaheleht | close tab | Closes the tab. |
| mine tagasi, mine edasi | page back, go forward | Goes back or forward a page. |
| laadi uuesti | reload | Reloads the page. |
| ava whatsapp, mine postimees.ee | open whatsapp, go to postimees.ee | Opens a known site or an address. |
| otsi ilm tallinnas | search weather in tallinn | Searches Google for the words. |
| näita numbreid | show numbers | Puts a number on everything clickable. |
| vajuta viis, or just "viis" while numbers show | click five | Clicks number five. |
| peida numbrid | hide numbers | Removes the numbers. |

Known site names: WhatsApp, Messenger, Facebook, Gmail, Google, YouTube, Postimees, Delfi, ERR,
LinkedIn, CV.ee, CV Keskus, Töötukassa. Estonian case endings are understood ("mine whatsappi"). A
short command that was misheard by one letter is usually still understood, and the bar says what it
took it to be. "Saada", "puhka", "ärka üles" and "võta tagasi" are never guessed.

The full rules are in `docs/ARCHITECTURE.md`, sections 20.3, 21.1 and 21.3.

## What it does not do

- It does not work outside Google Chrome, and does nothing outside web pages.
- The bar cannot appear on Chrome's own pages (settings, extensions, history, downloads), on the
  Chrome Web Store, on `view-source:` pages, in the built-in PDF viewer, or on other extensions'
  pages. Switching tabs and opening a site by voice still work from there.
- It cannot be installed from the Chrome Web Store, and it needs the local speech server running.
- Messenger support is a best guess that nobody has tried logged in.

## Privacy

- Audio never leaves the computer. The extension sends it only to the speech server on the same
  machine (`localhost`).
- Nothing you say or type is logged. The speech server logs only load times, connection counts and
  error codes.
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
second dev server on another port:

```
npx vite --port 5193 --strictPort
npx tsx extension/test/voice.ts
```

Run the two commands in separate terminals. `extension/README.md` describes the test options.

## Licence and credits

Ütle's code is under the MIT licence: see `LICENSE`.

Estonian speech recognition is not ours. The model `streaming-zipformer-large.et-en` was made by
Tanel Alumäe's Laboratory of Language Technology at Tallinn University of Technology (TalTech) and
is published under the MIT licence. Ütle runs it with sherpa-onnx (Apache-2.0). Everything else
that is not ours, and its licence, is listed in `THIRD-PARTY.md`.

The design and its history are in `docs/ARCHITECTURE.md`. What the product is, in plain words:
`docs/PRODUCT.md`.
