# Chrome Web Store listing

Everything the Chrome Web Store developer dashboard asks for, ready to paste. Estonian first,
English after. The package is `extension/out/utle-0.4.0.zip` (`npm run ext:pack`), the screenshots
are in `extension/store/` (`npx tsx scripts/store-shots.ts`). Design: `docs/ARCHITECTURE.md` 30.6.

## Ralf's ten minutes

Only you can do steps 1 and 9: step 1 costs money (a one-time registration fee, 5 US dollars at the
time of writing) and step 9 publishes under your name. Everything else is copy and paste from
below.

1. **Yours, one time, with the fee.** Open <https://chrome.google.com/webstore/devconsole>, sign in
   with the Google account that should own Ütle, accept the developer agreement and pay the
   registration fee. Verify the contact e-mail it asks for (tere@utle.ee or your own).
2. In a terminal in the repository: `npm run ext:pack`. It prints
   `store zip: …\extension\out\utle-0.4.0.zip`.
3. In the dashboard: **Add new item**, choose that zip.
4. **Store listing** tab: paste the description (both languages, one field) from "Description"
   below, choose the category, the language Estonian, and upload the five PNGs from
   `extension/store/` in the order 1 to 5. The icon comes from the zip.
5. **Privacy** tab: paste the single purpose, each permission's justification, "No" for remote
   code, tick the data types under "Data declarations", tick the three statements, and paste the
   privacy policy URL.
6. **Distribution** tab: visibility **Unlisted**, all regions, free.
7. Leave **Test instructions** with the text under "For the reviewer" below.
8. Read the preview once: the name, the summary line and the first screenshot.
9. **Yours.** **Submit for review**. Review usually takes a few days. When it is approved, copy the
   item's address and put it in `extension/README.md` "Install on a locked computer" (route B) and
   in `site/index.html` (the "Paigaldamine" section, both languages).

For every later upload: raise `version` in `extension/manifest.json`, run `npm run ext:pack`
again, and upload the new zip under **Package**.

## Name

Ütle

## Summary (at most 132 characters)

The store takes this from the manifest's `description`; it is the same string.

```
Kirjuta sõnumeid ja kasuta veebi eesti keeles rääkides. Write messages and use the web by speaking Estonian.
```

108 characters.

## Category

Accessibility (Ligipääsetavus).

## Language

Estonian (eesti). The description carries English after the Estonian.

## Description

```
Ütle on Chrome'i laiendus inimestele, kes ei saa käsi kasutada. Sa räägid eesti keeles ja sõnad ilmuvad selle lehe enda sõnumikasti, kus sa parajasti oled: WhatsApp Web, Messenger või mõni muu leht. Sõnum läheb teele alles siis, kui ütled „saada“.

Veebilehtede allservas on riba. See näitab, mida Ütle kuulis ja mida ta tegi. Kuulamise lülitad sisse, kui hoiad silmajälgija kursorit sekundi mikrofoniplaadil, klõpsuga või häälega.

Mida saab öelda, näiteks:
- „kirjuta Marile“ avab vestluse Mariga.
- „mitte kolm, vaid neli“ vahetab kastis vale sõna.
- „näita numbreid“ paneb igale lingile ja nupule numbri. Numbri ütlemine vajutab seda.
- „keri alla“, „mine youtube'i“, „loe ette“.
- „abi“ avab lehe kõigega, mida saab öelda.

Mida on vaja. Kõne tunneb ära Tallinna Tehnikaülikooli keeletehnoloogia labori eesti keele mudel Ütle serveris. Server jookseb samas arvutis või teises masinas, mille aadressi ja võtme abiline seadetes sisestab. Pärast paigaldamist avaneb leht „Alustamine“, mis viib abilise viie sammuga läbi: mikrofon, server, proovimine, hääl ja valmis.

Kuhu kõne läheb. Kui server on teises masinas, lahkub heli sinu arvutist. Lause, millest Ütle reeglite järgi aru ei saa, saadab server tekstina koos lehe lühikokkuvõttega Anthropicu keelemudelile Claude. Heli ega öeldud teksti ei salvestata. Analüütikat ega reklaame ei ole. Privaatsuspoliitika: https://utle.ee/privaatsus

Ütle on prototüüp. See sai alguse 2026. aasta oktoobris NewWorkTechi kaasava digiinnovatsiooni häkatonil TalTech Mektorys. Küsimused: tere@utle.ee

---

Ütle is a Chrome extension for people who cannot use their hands. You speak Estonian and the words appear in the message box of the page you are on: WhatsApp Web, Messenger or any other page. The message is sent only when you say “saada” (send).

A bar along the bottom of web pages shows what Ütle heard and what it did. You turn listening on by resting an eye tracker's pointer on the microphone square for a second, by a click, or by voice.

What you can say, for example:
- “kirjuta Marile” (write to Mari) opens the chat with Mari.
- “mitte kolm, vaid neli” (not three but four) swaps a wrong word in the box.
- “näita numbreid” (show numbers) puts a number on every link and button. Saying the number presses it.
- “keri alla” (scroll down), “mine youtube'i” (go to YouTube), “loe ette” (read aloud).
- “abi” (help) opens a page with everything you can say.

What it needs. Speech is recognised on the Ütle server by the Estonian model of Tallinn University of Technology's language technology laboratory. The server runs on the same computer or on another machine whose address and token a helper enters in the settings. After installing, the page “Alustamine” (Getting started) takes the helper through five steps: microphone, server, a try, voice, done.

Where your speech goes. When the server runs on another machine, the audio leaves your computer. A sentence the rules do not understand is sent by the server as text, with a short summary of the page, to Anthropic's language model Claude. Audio and the text of what you say are not stored. There are no analytics and no ads. Privacy policy: https://utle.ee/privaatsus

Ütle is a prototype. It started at the NewWorkTech inclusive digital innovation hackathon at TalTech Mektory in October 2026. Questions: tere@utle.ee
```

## Screenshots

Five, 1280×800, from `extension/store/` in this order:

| File | Shows |
|---|---|
| `1-message.png` | A stand-in chat page like WhatsApp Web, Mari's conversation open, a message in the box, the bar showing the words heard |
| `2-numbers.png` | A stand-in video page with a number on every link and button |
| `3-welcome.png` | The welcome page "Alustamine", step 1 done |
| `4-settings.png` | The settings page, the Server section |
| `5-help.png` | The help page "Mida saab öelda", the group Sõnumid open |

All are the extension's own pages or the test suite's stand-in pages (`extension/test/fixtures/`):
no real site, no real account, invented names only.

## Single purpose

```
Ütle laseb inimesel, kes ei saa käsi kasutada, kirjutada sõnumeid ja liikuda brauseris eesti keeles rääkides.

Ütle lets a person who cannot use their hands write messages and move around the browser by speaking Estonian.
```

## Permission justifications

| Permission | Justification (paste) |
|---|---|
| Host permission `<all_urls>` | The user speaks to whatever site they are on. The extension must find the message box and the buttons on that page, type the spoken words into it, and show its status bar there. It reads the page only when the user speaks a command. |
| `tabs` | Voice commands open, close and switch tabs ("järgmine vaheleht", "eelmine vaheleht") and go to a site by name ("ava youtube"). |
| `scripting` | When the user speaks a command, the extension runs its page script in the tab in front to carry it out: type into the box, press a button, scroll, put numbers on the links and buttons. |
| `storage` | Keeps the user's settings (bar size, server address and token) and the details they saved themselves, such as an e-mail address, in the browser. |
| `offscreen` | The microphone is read in an offscreen document, so listening goes on while the user moves between tabs. |
| `contextMenus` | The toolbar icon's right-click menu opens Alustamine (getting started), Seaded (settings) and Abi (help). |
| New tab page override | The new tab page is a page of large tiles that can be chosen by voice or by looking, with the status bar on it, so a new tab is usable without hands. |

## Remote code

No. All code is in the package.

## Data declarations

Tick these in the Privacy tab's data list:

- **Personal communications**: the spoken messages (audio while listening, and the text of what was said) go to the speech server the user set up.
- **Website content**: when a sentence is not understood by the rules, a short summary of the page (address, title, visible buttons and links, the text in the message box) goes through that server to Anthropic.
- **Personally identifiable information**: an e-mail address, phone number or ID code the user saved is kept in their browser and can be in the message box text sent with that summary.

Tick all three statements: the data is not sold to third parties, not used or transferred for
purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

## Privacy policy URL

- `https://utle.ee/privaatsus` (the page `site/privaatsus.html`).
- `https://github.com/marshalofthecentralaltar/utle/blob/main/docs/PRIVACY.md` (the same text).

Use `https://utle.ee/privaatsus` once utle.ee's DNS points at Vercel and the page opens in a
browser; until then the GitHub page, which works only while the repository is public. On
27 October 2026 both answered: `https://utle.ee/privaatsus` returned the page titled "Ütle
privaatsus" and the GitHub page returned 200, so use utle.ee. If utle.ee does not open on the day
you upload, use the GitHub address in the Privacy tab and in both languages of the description.

## Visibility

Unlisted. Only people with the link find it.

## For the reviewer

```
Ütle needs a speech server, which is not part of the extension. Without one, the bar says "Kõneserver ei vasta" (the speech server does not answer); every other part (the welcome page, the settings, the help page opened by the toolbar icon's right-click menu, the new tab page) can be opened. The server's source and the steps to run it are at https://github.com/marshalofthecentralaltar/utle (npm run serve). Contact: tere@utle.ee
```

## What the zip holds

`npm run ext:pack` writes exactly these 21 files (version 0.4.0):

```
manifest.json
options.html
offscreen.html
permission.html
newtab.html
welcome.html
help.html
relay.js
dist/asr-worklet.js
dist/background.js
dist/content.js
dist/help.js
dist/newtab.js
dist/offscreen.js
dist/options.js
dist/page.js
dist/permission.js
dist/welcome.js
icons/128.png
icons/16.png
icons/48.png
```

`scripts/pack-check.ts` unpacks it, loads it as an unpacked extension on a fresh profile and checks
that the welcome page opens and that "abi" opens the help page.
