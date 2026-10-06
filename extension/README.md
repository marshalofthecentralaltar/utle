# Ütle extension

Speak Estonian; the words go into the message box of the page you are on (WhatsApp Web first,
Messenger, any page) while you speak, and the browser scrolls and switches tabs by voice. A strip at
the bottom of every page, and of the new-tab page, shows the microphone, the words heard, and what
was done. Nothing opens a separate window. Design: `docs/ARCHITECTURE.md` sections 21.2 and 21.3 (the strip and
live words), 22 (understanding by meaning) and 23 (round 3: speed, push-to-talk by looking, sound-alike
commands, editing, Soniox).

## Build

From the repository root:

1. `npm ci` (once).
2. `npm run model` (once): downloads the Estonian speech model into `models/`, and the small
   speaker model (29 MB) for "Kuula ainult mind" into `models/speaker/` (optional; a failure there
   is a warning).
3. `npm run ext`: bundles `extension/src/` into `extension/dist/`. Run it again after any change.

## Load

1. Start the speech model: `npm run dev` (it serves `ws://localhost:5173/api/asr`). Keep it running.
   Within a minute or two it prints `[asr] model loaded on a worker thread in N ms` (see "The dev
   server's log lines" below).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked**, choose the `extension/` folder (not `dist/`).
4. Pin the Ütle icon (puzzle piece, then the pin).
5. If the speech model runs at another address, set it under **Details → Extension options**, then
   reload the extension.

## Soniox instead of the local model (optional)

Soniox is a hosted Estonian recogniser; the audio then leaves the laptop. It needs a key in the
environment of the terminal that runs `npm run dev`, never in a file: PowerShell
`$env:SONIOX_API_KEY="..."; npm run dev`, bash `SONIOX_API_KEY=... npm run dev`.
`curl localhost:5173/api/status` then shows `"speech":{"local":true,"soniox":true}`. On the settings
page choose **Kõnemudel: Soniox (pilves)**; the choice takes effect the next time listening is turned
on. `UTLE_ASR=soniox` in the same environment sends every connection to Soniox whatever the setting.
Without the key the bar says the speech model is not reachable and the server logs
`[soniox] SONIOX_API_KEY is not set`. Nobody has run this with a real key (see "Unverified").

## Only your own voice (round 4, optional)

Background conversations are typed as if you said them. Two things stop that: push-to-talk by
looking (below), and the server knowing your voice. On the settings page, group **Minu hääl**:

1. **Õpeta mu hääl**: listening starts if it was off and the bar says "Räägi 8 sekundit tavalisel
   häälel…"; speak normally for eight seconds (pauses are skipped). The bar then says "Hääl on
   õpitud." or "Hääle õppimine ei õnnestunud." (too little speech within about 30 s). The server
   keeps `models/speaker/owner.json`: a voice embedding and a loudness, never audio. Press the
   button again to replace it.
2. **Kuula ainult mind**: from the next time listening starts, an utterance the server judges to be
   another voice is dropped and the bar says "Keegi teine rääkis, jätsin vahele." for three seconds.
   An utterance it cannot place is obeyed. Words the other voice typed as a preview go away when
   you next speak. **Kuula kõiki** turns it off.

Without the speaker model (`npm run model` not run, or the download failed) the server logs
`[asr] no speaker model`, and "Kuula ainult mind" only skips speech clearly fainter than yours was
at enrolment: distance from the microphone, not the voice. Nobody has tried this with a real voice;
the thresholds are in `server/speaker.ts`.

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
- What to say (the exact phrases come from `src/core/inpage.ts` and `src/core/browserIntent.ts`; the
  full tables are `docs/ARCHITECTURE.md` 21.1, 22 and 23.4):
  - dictation: anything that is not a command is added to the message box. What the fixed phrases do
    not recognise goes to the model with what is on the page ("uus leht", "vajuta Mari", "pane
    vaiksemaks"); it needs `ANTHROPIC_API_KEY` on the dev server.
  - `saada`, `saada ära`, `saadake`, `saadame`: sends what is in the box. Never guessed from a misheard
    word: "sada" and "saata" are typed.
  - corrections: `mitte kolm, vaid neli`, `kolme asemel neli`, `kustuta viimane sõna`, `kustuta viimane
    lause`, `kustuta kõik`, `uus rida`, `punkt`, `võta tagasi`; `tagasi` alone undoes while there are
    words in the box, and goes back a page otherwise.
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
    `võta tagasi` there needs the model to answer `pressKey Undo`. Tested on `fixtures/essay.html`, never on Docs itself.
  - scrolling: `keri alla`, `keri üles` (80% of the view, smoothly), `keri natuke alla`, `natuke üles`,
    `veidi alla` (a third), `keri aeglaselt alla`, `keri tasa üles`, `aeglaselt alla` (a steady 90 px/s until
    stopped), `stopp`, `seis`, `aitab`, `lõpeta`, `lõpeta kerimine`, `kerimine seis` (stop), `lehe algusesse`,
    `lehe lõppu`. While there are words in the box a one-word `stopp` or `aitab` is typed (it is a reply);
    `lõpeta kerimine` always stops. `keri edasi` and `keri tagasi` skip in the video.
  - sound-alikes (round 3): a command heard the Estonian way is still understood, and the amber line says
    what it took it to be ("Sain aru: „ava juutuub“"): `ava juutuba`, `mine guugel`, `aga whatsapp` (for
    "ava whatsapp"), `vatsap`, `keri ala`, `geri alla`, `saadake`. Site names with case endings too
    (`mine whatsappi`, `youtube'i`). Never for sending, resting, waking or undo.
  - browser: `järgmine vaheleht`, `eelmine vaheleht`, `kolmas vaheleht`, `uus leht`, `sulge`, `mine tagasi`,
    `laadi uuesti`, `ava whatsapp`, `otsi kassivideod` (the site's own search, Google when it has none),
    `otsi googlest ilm`, `näita numbreid`, `vajuta viis`, `peida numbrid`, `kirjuta siia` (arm the focused
    field), `tühjenda otsing`, `sulge aken` / `välja` (Escape), `enter`, `mängi`, `paus`, `vaiksemaks`,
    `täisekraan`;
  - the bar: `peida riba` folds it to the pill, `näita riba` brings it back;
  - `puhka` stops typing, `ärka üles` resumes.
  - push-to-talk by looking: nothing to say; look at the microphone (or the whole bar) and speak, look
    away and the words are delivered. Set it on the settings page (**Kuulamine: Vaatamisega**).
- The toolbar icon also turns listening on and off.
- When the speech model is not running, the strip says so in one amber line; start `npm run dev` and
  turn the microphone on again.

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
- `[intent] kind=command done=true ms=1800`: one answer of the model; `[intent] error=upstream_rejected`
  with no key.
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
Ütle's own pages (the new tab, the settings page) carry the strip, so the settings can be changed by
voice or by dwell. On Google Docs the strip is there, but the document is a canvas: dictation and the
keys reach it, the whole-box repairs and "find a word" do not (see "What to say").

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
