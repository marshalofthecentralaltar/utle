# Ütle extension

Speak Estonian; the words go into the message box of the page you are on (WhatsApp Web first,
Messenger, any page) while you speak, and the browser scrolls and switches tabs by voice. A strip at
the bottom of every page, and of the new-tab page, shows the microphone, the words heard, and what
was done. Nothing opens a separate window. Design: `docs/ARCHITECTURE.md` sections 21.2 and 21.3.

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

## After pulling a change

1. `npm run ext` in the repository root.
2. On `chrome://extensions`, press the reload arrow on the Ütle card.
3. Reload the tabs that were already open (or open them again), so they get the new strip.

## Grant the microphone (once, done by a helper)

1. Right after loading, a tab "Ütle vajab mikrofoni" opens by itself.
2. Chrome asks to use the microphone: press **Allow**.
3. The tab closes itself. That is all; it does not come back unless the permission is removed.
4. If it was refused, turning the microphone on opens the same tab again; press **Allow** there.

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
  "Mõtlen" appear while the model is asked what you meant, and a thin amber line under that says
  when the free-form understanding is off (no key, no server).
- A new tab is Ütle's own page: the same strip, big tiles for WhatsApp and the other known sites,
  and three example phrases that change every few seconds. Rest the eye-tracker pointer on a tile
  for one second (or click it) to open the site in that tab, or say `näita numbreid` and the
  number. Chrome may ask, once, whether to keep this changed new-tab page: choose **Keep it**.
- Settings (the **Seaded** control, or the extension's options page) are large buttons that a
  click or a one-second dwell toggles, saved at once: bar height (Väike 96 / Tavaline 128 / Suur
  192, `barHeight`), microphone side (`micSide`: Vasakul / Paremal), and whether the bar starts
  folded (`barHiddenDefault`). The speech-model and development-page addresses are under
  "Täpsemalt". The same strip is mounted there. (Numbering the buttons by voice needs the service
  worker to treat options.html like newtab.html; see HANDOFF.md.)
- What to say (the exact phrases come from `src/core/inpage.ts`, the core lane):
  - dictation: anything that is not a command is added to the message box;
  - `saada`: sends what is in the box;
  - corrections: `mitte kolm, vaid neli`, `kustuta viimane sõna`, `kustuta kõik`, `võta tagasi`;
  - browser: `keri alla`, `keri üles`, `järgmine vaheleht`, `eelmine vaheleht`, `näita numbreid`, `vajuta viis`;
  - the bar: `peida riba`, `näita riba`;
  - `puhka` stops typing, `ärka üles` resumes.
- The toolbar icon also turns listening on and off.
- When the speech model is not running, the strip says so in one amber line; start `npm run dev` and
  turn the microphone on again.

## Test

- `npx tsx extension/test/run.ts`: every browser command, including `readBox`, `setText`,
  `pressSend` and a WhatsApp stand-in page. Builds the extension first. Opens Chromium windows on
  screen for about a minute.
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

## Unverified

- WhatsApp Web with a chat open: the composer, the send button, the open chat's name, and whether
  a synthetic Enter sends. Each selector in `extension/src/sites.ts` says VERIFIED or UNVERIFIED;
  to fix one, change it there, `npm run ext`, reload the extension.
- Messenger: every selector is a best guess; nobody has tried it logged in.
- Whether the strip makes room on the real WhatsApp layout (tested on stand-ins built on `100%`
  and on `100vh` heights).
- Branded Google Chrome (tested in Playwright's bundled Chromium only), including how it asks about
  the replaced new-tab page, and a real microphone and voice (tested with recorded speech through a
  fake microphone).
- Live words on real WhatsApp: whether its composer takes the typed-at-the-end words as smoothly as
  the Lexical stand-in does.
- The development page at localhost (section 20) still works through `relay.js` as a harness.
