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
  folded (`barHiddenDefault`), how listening is triggered (`listenMode`: Lülitiga / Vaatamisega),
  what the gaze rests on (`gazeTarget`: Mikrofon / Kogu riba, shown only for Vaatamisega) and the
  speech model (`speechEngine`: Arvutis (TalTech) / Soniox (pilves); Soniox needs `SONIOX_API_KEY`
  on the dev server and takes effect the next time listening starts). The speech-model and
  development-page addresses are under "Täpsemalt". The same strip is mounted there. (Numbering the
  buttons by voice needs the service worker to treat options.html like newtab.html; see HANDOFF.md.)
- **Push-to-talk by looking** (`listenMode: gaze`): the microphone square, or the whole bar when
  the gaze target is Kogu riba, listens while the eye-tracker pointer rests on it. It starts after
  250 ms on the target (a pass-through does nothing) and stops 600 ms after the pointer leaves
  (jitter does not cut a sentence); on the stop the words said so far are delivered at once. Off,
  the square reads "Vaata siia ja räägi"; the whole bar as target shows a green inner outline while
  it listens and an amber fill that drains during the 600 ms grace. A click on the target does
  nothing in this mode. The folded pill is a gaze target too (resting on it for two seconds no
  longer unfolds the bar in this mode; use **Näita**). When a page swallows the pointer-leave
  event, a one-second poll of the pointer's last position ends listening instead.
- When the speech server falls behind by more than two seconds, a thin dim line under the amber
  one says "Kõne jääb maha N s" until it has caught up.
- What to say (the exact phrases come from `src/core/inpage.ts`, the core lane):
  - dictation: anything that is not a command is added to the message box;
  - `saada`: sends what is in the box;
  - corrections: `mitte kolm, vaid neli`, `kustuta viimane sõna`, `kustuta kõik`, `võta tagasi`;
  - editing inside the text (round 3; the box in front, armed or focused): the caret with `mine algusesse`,
    `mine lõppu`, `rea algusesse`, `rea lõppu`, `lause algusesse`, `lause lõppu`, `sõna tagasi`, `kolm sõna edasi`,
    `mine sõna homme ette`, `mine sõna homme taha`, `pärast sõna homme`, `mine kooli juurde`; a selection with
    `vali kõik`, `vali see sõna`, `vali see lause`, `vali see rida`, `vali viimane sõna`, `vali viimane lause`,
    `vali sõna homme`, `vali homme`; typing at the caret with `kirjuta siia vahele kell viis`, `lisa siia kell viis`,
    `sisesta kell viis` (a space and a capital are added as the place needs); keys with `kustuta täht`,
    `kustuta kolm tähte`, `kustuta valitud`, `kustuta ees`, `kustuta sõna homme`, `vasakule`, `paremale kolm korda`,
    `üks rida üles`, `kaks rida alla`, `tee uuesti` (redo), `järgmine väli` (Tab, which arms the field it lands in);
    English: `go to the start`, `go before homme`, `select the sentence`, `insert hello`, `delete three letters`,
    `line up`, `redo`, `next field`. A word that is not in the box goes to the model instead (it may be a section of
    the page). `võta tagasi` stays the whole-box undo. On Google Docs only the keys and typing work (its editor is a
    canvas with no text to find in): `sõna tagasi`, `rea algusesse`, `kustuta täht`, `tee uuesti`, `kirjuta siia vahele …`;
    `võta tagasi` there needs the model to answer `pressKey Undo`.
  - browser: `keri alla`, `keri üles`, `järgmine vaheleht`, `eelmine vaheleht`, `näita numbreid`, `vajuta viis`;
  - the bar: `peida riba`, `näita riba`;
  - `puhka` stops typing, `ärka üles` resumes.
- The toolbar icon also turns listening on and off.
- When the speech model is not running, the strip says so in one amber line; start `npm run dev` and
  turn the microphone on again.

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

## Test

- `npx tsx extension/test/run.ts`: every browser command, including `readBox`, `setText`,
  `pressSend`, the M7 page commands (`readPage`, `clickItem`, `focusItem`, `siteSearch`, `media`,
  `pressKey`, `clearField`, `arm`, `bar`) on a YouTube-like stand-in (`fixtures/video.html`: a cookie
  banner, ten video cards with thumbnail, title and channel links, some below the fold, an
  `aria-labelledby` button, a tile that reacts to Enter only), a Gmail-like compose window
  (`fixtures/gmail.html`: `role=dialog`, fields named by `<label for>`, a send button) and a
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

## Unverified

- WhatsApp Web with a chat open: the composer, the send button, the open chat's name, and whether
  a synthetic Enter sends. Each selector in `extension/src/sites.ts` says VERIFIED or UNVERIFIED;
  to fix one, change it there, `npm run ext`, reload the extension.
- Messenger: every selector is a best guess; nobody has tried it logged in.
- YouTube and Google (M7): the search-field selectors in `SEARCH_FIELDS` (`extension/src/sites.ts`)
  and the player shortcuts `media` sends to `#movie_player` (k, m, f, arrows, j, l) are read from
  the public pages, not tried by voice; the element API is the fallback either way. `fullscreen`
  needs a user gesture Chrome may not grant to an injected script; it then answers failed.
- The unknown-site composer rule (a textarea or contenteditable with a send, post, comment or reply
  button in its form or within 200 px) is tested on stand-ins only.
- What `readPage` makes of the real YouTube, Gmail and WhatsApp pages (names, one item per card,
  the cookie banner, the items below the fold, the click fallbacks) is tested on the stand-ins
  above, built from knowledge of those pages' markup, not on the sites themselves.
- Whether the strip makes room on the real WhatsApp layout (tested on stand-ins built on `100%`
  and on `100vh` heights).
- Branded Google Chrome (tested in Playwright's bundled Chromium only), including how it asks about
  the replaced new-tab page, and a real microphone and voice (tested with recorded speech through a
  fake microphone).
- Live words on real WhatsApp: whether its composer takes the typed-at-the-end words as smoothly as
  the Lexical stand-in does.
- The development page at localhost (section 20) still works through `relay.js` as a harness.
