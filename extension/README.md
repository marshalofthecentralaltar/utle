# Ütle extension

Speak Estonian; the words go into the message box of the page you are on (WhatsApp Web first,
Messenger, any page), and the browser scrolls and switches tabs by voice. A strip at the bottom of
every page shows the microphone, the words heard, and what was done. Nothing opens a separate
window. Design: `docs/ARCHITECTURE.md` section 21.2.

## Build

From the repository root:

1. `npm ci` (once).
2. `npm run model` (once): downloads the Estonian speech model into `models/`.
3. `npm run ext`: bundles `extension/src/` into `extension/dist/`. Run it again after any change.

## Load

1. Start the speech model: `npm run dev` (it serves `ws://localhost:5173/api/asr`). Keep it running.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked**, choose the `extension/` folder (not `dist/`).
4. Pin the Ütle icon (puzzle piece, then the pin).
5. If the speech model runs at another address, set it under **Details → Extension options**, then
   reload the extension.

## Grant the microphone (once, done by a helper)

1. Right after loading, a tab "Ütle vajab mikrofoni" opens by itself.
2. Chrome asks to use the microphone: press **Allow**.
3. The tab closes itself. That is all; it does not come back unless the permission is removed.
4. If it was refused, turning the microphone on opens the same tab again; press **Allow** there.

## Use

- The strip sits at the bottom of every web page. The big square on the left is the microphone:
  click it, or rest the eye-tracker pointer on it for one second (a yellow fill grows), to turn
  listening on or off. Green "Kuulan" = listening, hollow "Ei kuula" = off, blue "Puhkan" = resting.
- Open a chat in WhatsApp Web and speak: the words go into the chat's message box.
- What to say (the exact phrases come from `src/core/inpage.ts`, the core lane):
  - dictation: anything that is not a command is added to the message box;
  - `saada`: sends what is in the box;
  - corrections: `mitte kolm, vaid neli`, `kustuta viimane sõna`, `kustuta kõik`, `võta tagasi`;
  - browser: `keri alla`, `keri üles`, `järgmine vaheleht`, `eelmine vaheleht`, `näita numbreid`, `vajuta viis`;
  - `puhka` stops typing, `ärka üles` resumes.
- The toolbar icon also turns listening on and off.
- When the speech model is not running, the strip says so in one red line; start `npm run dev` and
  turn the microphone on again.

## Test

- `npx tsx extension/test/run.ts`: every browser command, including `readBox`, `setText`,
  `pressSend` and a WhatsApp stand-in page. Builds the extension first. Opens Chromium windows on
  screen for about a minute.
- `npx tsx extension/test/voice.ts`: by voice with no person. Needs `npx vite --port 5193 --strictPort`
  running. A fake microphone plays Estonian recordings (`scripts/fixtures/et-dictate-send-16k.wav`,
  `et-scroll-tab-16k.wav`) into the real recogniser; the extension is built with a stand-in for the
  step logic (`extension/test/standin.ts`).
- `npx tsx extension/test/voice.ts down`: with the dev server stopped; start it when the test says so.

## Unverified

- WhatsApp Web with a chat open: the composer, the send button, the open chat's name, and whether
  a synthetic Enter sends. Each selector in `extension/src/sites.ts` says VERIFIED or UNVERIFIED;
  to fix one, change it there, `npm run ext`, reload the extension.
- Messenger: every selector is a best guess; nobody has tried it logged in.
- Whether the strip makes room on the real WhatsApp layout (tested on stand-ins built on `100%`
  and on `100vh` heights).
- Branded Google Chrome (tested in Playwright's bundled Chromium only), and a real microphone and
  voice (tested with recorded speech through a fake microphone).
- The development page at localhost (section 20) still works through `relay.js` as a harness.
