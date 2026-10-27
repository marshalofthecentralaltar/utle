# What Ütle sees on real public pages (round 9, REALPAGES)

Written by `npx tsx scripts/real-pages.ts`, last run 2026-10-27 08:33 UTC, Playwright Chromium 1280x900, locale et-EE, a fresh profile, no login. Method and columns: docs/ARCHITECTURE.md 30.4.

| site | page | banner first (readPage before any click) | items (after accepting) | search field (SEARCH_FIELDS) | #movie_player | article (`loe ette`) | headline, no nav | strip covered | page bars under the strip | accept button and the pointer |
|---|---|---|---|---|---|---|---|---|---|---|
| youtube | https://www.youtube.com/ | yes (8 [dialog] items) | 11 | yes: `input[name="search_query"]` | n/a: not a watch page | n/a: not a news site | n/a: not a news site | no (strip top 772, height 128) | ytd-mini-guide-renderer.style-scope | "Nõustu kõigiga" at y 757 to 797, the pointer clicked it |
| youtube-watch | https://www.youtube.com/watch?v=jNQXAC9IVRw | none | 62 | yes: `input[name="search_query"]` | yes, holds the <video>; readPage lists "praegune video" | n/a: not a news site | n/a: not a news site | no (strip top 772, height 128) | none | n/a: no consent layer at load |
| google | https://www.google.com/ | yes (8 [dialog] items) | 22 | yes: `textarea[name="q"]` | n/a: not a watch page | n/a: not a news site | n/a: not a news site | no (strip top 772, height 128) | none | "Nõustu kõigiga" at y 714 to 762, the pointer clicked it |
| postimees | https://www.postimees.ee/ | yes (3 [dialog] items) | 48 | n/a: not a search site | n/a: not a watch page | 8 sentences | article ok | no (strip top 772, height 128) | none | "Olen nõus" at y 696 to 736, the pointer clicked it |
| delfi | https://www.delfi.ee/ | yes (3 [dialog] items) | 58 | n/a: not a search site | n/a: not a watch page | 23 sentences | article ok | no (strip top 772, height 128) | none | "NÕUSTUN KÕIGIGA" at y 645 to 684, the pointer clicked it |
| err | https://www.err.ee/ | yes (11 [dialog] items) | 44 | n/a: not a search site | n/a: not a watch page | 34 sentences | article ok | no (strip top 772, height 128) | none | "Nõustun kõigi küpsistega" at y 603 to 635, the pointer clicked it |
| ilmateenistus | https://www.ilmateenistus.ee/ | yes (3 [dialog] items) | 33 | n/a: not a search site | n/a: not a watch page | n/a: not a news site | n/a: not a news site | no (strip top 772, height 128) | none | "Nõustun" at y 806 to 850, the pointer clicked it |
| otse-err | https://otse.err.ee/k/etv | yes (11 [dialog] items) | 80 | n/a: not a search site | n/a: not a watch page | n/a: not a news site | n/a: not a news site | no (strip top 772, height 128) | none | "Nõustun kõigi küpsistega" at y 603 to 635, the pointer clicked it |

## Detail per site

### youtube

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-youtube.png`.
- Consent layer seen: tp-yt-paper-dialog#dialog.eom-v1-dialog.style-scope 700x838 pos=fixed z=2202 area=51%. Accepted with: Nõustu kõigiga, button y 757 to 797, clicked by the pointer.
- readPage before any click: 16 items; the first six: `button:[dialog] Keel: Estonian`, `link:[dialog] Logi sisse`, `link:[dialog] küpsisefaile`, `button:[dialog] Ei nõustu küpsiste ja muude andmete kasutamisega kirjeldatud`, `button:[dialog] Nõustun küpsiste ja muude andmete kasutamisega kirjeldatud e`, `link:[dialog] Rohkem valikuid`.

### youtube-watch

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-youtube-watch.png`.
- Consent layer seen: none. Accepted with: nothing clicked.
- readPage before any click: 62 items; the first six: `video:praegune video`, `link:YouTube'i avaleht`, `button:Juhised`, `field:Otsige`, `button:Search`, `button:Häälotsing`.

### google

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-google.png`.
- Consent layer seen: div.jw8mI 1280x900 pos=fixed z=9998 area=100%. Accepted with: Nõustu kõigiga, button y 714 to 762, clicked by the pointer.
- readPage before any click: 9 items; the first six: `button:[dialog] Keel: ‪eesti‬`, `link:[dialog] Logi sisse`, `link:[dialog] küpsisefaile`, `button:[dialog] Keeldu kõigist`, `button:[dialog] Nõustu kõigiga`, `link:[dialog] Rohkem valikuid`.

### postimees

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-postimees.png`, article `docs/proof/r9-real-postimees-article.png`.
- Consent layer seen: div#didomi-popup.didomi-popup-backdrop.didomi-notice-popup 1280x900 pos=fixed z=2147483641 area=100%. Accepted with: Olen nõus, button y 696 to 736, clicked by the pointer.
- readPage before any click: 6 items; the first six: `link:[dialog] meie koostööpartnerid`, `button:[dialog] Olen nõus`, `button:[dialog] Halda valikuid`, `text:veebilehe põhifunktsioonide ja küberturvalisuse tagamiseks n`, `text:uudiste ja muu sisu kuvamiseks ja haldamiseks, sh keele- ja`, `text:ajakirjandusliku sisu tarbimise mõõtmiseks, et tagada ajakir`.
- Article: https://arvamus.postimees.ee/8571330/rainer-saks-venemaa-on-valmis-taasalustama-konelusi-parast-4-novembrit-miks-valiti-just-see-paev, 8 sentences. The first three:
  1. RAINER SAKS ⟩ Venemaa on valmis taasalustama kõnelusi pärast 4. novembrit.
  2. Miks valiti just see päev?
  3. Venemaa presidendi välispoliitika abi Juri Ušakov teatas eile, et Venemaa on valmis taasalustama kolmepoolseid läbirääkimisi USA ja Ukrainaga pärast 4. novembrit, kirjutab julgeolekuekspert Rainer Saks (Parempoolsed).

### delfi

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-delfi.png`, article `docs/proof/r9-real-delfi-article.png`.
- Consent layer seen: div.cky-consent-container.cky-popup-center 440x518 pos=fixed z=99999999 area=20%. Accepted with: NÕUSTUN KÕIGIGA, button y 645 to 684, clicked by the pointer.
- readPage before any click: 4 items; the first six: `button:[dialog] meie 1037 partnerit`, `button:[dialog] Kohanda`, `button:[dialog] Nõustun kõigiga`, `text:Hindame teie privaatsust`.
- Article: https://www.delfi.ee/artikkel/120620387/graafikud-reitingute-keskmised-kolm-voimalikku-peaministrit-kuus-voimalikku-koalitsiooni?dsrc=%253D%253DQfiUTMlBzYlRGN2I2Nl1CNjJTOtYmYwQTL3AzYj1SN4QmZzQzYxIiOiQWSrN2bsJmIskzM0gDOwMTO3EjOiAXbhR3cl1Wa0JCLwojI4VGZulkbvlGdjV2ciwiIyUGc5R1aj9GbCJiOiUGc5R1aj9GbiJCLwojI4VGZul0aj9GbiJCLikmZsVGRiojIl1WYOVGdpNnIsISZnFGc052byZmI6ISZwlHVldWYwJye, 23 sentences. The first three:
  1. GRAAFIKUD \| Reitingute keskmised: kolm võimalikku peaministrit, kuus võimalikku koalitsiooni
  2. Isamaa ja Keskerakonna kaksikliidul pole enam enamust, sest alternatiivsete kolmikliitude võimalused on paranenud.
  3. Augustikuu ülevaatega võrreldes on Isamaa kaotanud neli mandaati.

### err

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-err.png`, article `docs/proof/r9-real-err-article.png`.
- Consent layer seen: div.modal.fade 1280x900 pos=fixed z=1050 area=100%. Accepted with: Nõustun kõigi küpsistega, button y 603 to 635, clicked by the pointer.
- readPage before any click: 14 items; the first six: `button:[dialog] et`, `button:[dialog] ru`, `button:[dialog] en`, `button:[dialog] Nõusolek`, `button:[dialog] Personaliseeri`, `button:[dialog] Domeenide ülene nõusolek (23)`.
- Article: https://www.err.ee/1610177479/veebikasiinode-maksulangetus-pole-seni-toonud-lubatud-lisaraha, 34 sentences. The first three:
  1. Veebikasiinode maksulangetus pole seni toonud lubatud lisaraha
  2. Kultuurkapital hoiatab, et oodatust väiksem maksutulu võib pikendada kultuuriobjektide rahastamist ja kasvatada laenukulusid.
  3. Rahandusminister peab maksulangetust halvaks poliitikaks, kuid valitsus seda tagasi pöörata ei plaani.

### ilmateenistus

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-ilmateenistus.png`.
- Consent layer seen: section#tcpCookieConsent.tcp-cookie-consent 1265x145 pos=fixed z=1000 area=16%. Accepted with: Nõustun, button y 806 to 850, clicked by the pointer.
- readPage before any click: 37 items; the first six: `button:[dialog] Keeldun`, `button:[dialog] Nõustun`, `link:[dialog] küpsiseid`, `link:Keskkonnaagentuuri logo`, `link:Juurdepääsetavus`, `button:Eesti`.

### otse-err

- Load: ok (HTTP 200). Screenshot: `docs/proof/r9-real-otse-err.png`.
- Consent layer seen: div.modal.fade 1280x900 pos=fixed z=1050 area=100%. Accepted with: Nõustun kõigi küpsistega, button y 603 to 635, clicked by the pointer.
- readPage before any click: 13 items; the first six: `button:[dialog] et`, `button:[dialog] ru`, `button:[dialog] en`, `button:[dialog] Nõusolek`, `button:[dialog] Personaliseeri`, `button:[dialog] Domeenide ülene nõusolek (23)`.

<!-- fixes -->

## Faults found and fixed: before and after

Before: the script's first runs on 2026-10-27, before the fixes (logs not kept in the repo, lines copied here). After: the reruns after the fixes, the same sites (for the two articles the same address, through `UTLE_ARTICLE_<site>=<address>`). Each fix has a suite case on a trimmed copy of the real markup in `extension/test/fixtures/real-<site>.html`.

| fault | site | before | after | suite case |
|---|---|---|---|---|
| a banner over the whole page let the page's items through | delfi.ee front page | readPage 26 items: the 3 `[dialog]` buttons, then `[allpool] JUHTKIRI \| Eestit ründasid sabotöörid…` and more story links under the overlay | 4 items: `[dialog] meie 1037 partnerit`, `[dialog] Kohanda`, `[dialog] Nõustun kõigiga`, the text `Hindame teie privaatsust` | `readPage delfi.ee: a page-covering banner lists only its own items` (real-delfi.html) |
| the same | postimees.ee front page | 26 items: 3 `[dialog]`, then `[allpool] Halda valikuid`, `[allpool] Nõusolekud`, `[allpool] MAAILM`… | 6 items: 3 `[dialog]` and 3 text items of the banner | the same case |
| the same, the main video | err.ee, otse.err.ee | the 11 `[dialog]` items, then `video:praegune video` behind the modal (26 and 44 items) | 14 and 13 items, no video while the modal is up | the same case |
| the subscriber teaser read as the article | postimees.ee, arvamus.postimees.ee/8571330/… | sentence 3: "Tellijana loed uudiseid äpis reklaamivabalt." (then two more selling points) | sentence 3: "Venemaa presidendi välispoliitika abi Juri Ušakov teatas eile, …" (article ok) | `read postimees.ee: the subscriber teaser is not read`, and the article's own list is still read (real-postimees.html) |
| the headline read twice | err.ee, www.err.ee/1610177479/… | sentences 1 and 2: "Veebikasiinode maksulangetus pole seni toonud lubatud lisaraha" and the same with a full stop | sentence 2: "Kultuurkapital hoiatab, …" | `read err.ee: the lead opening with the headline is not read twice` (real-err.html), and two unit tests in `src/core/reading.test.ts` |

## Faults found and not fixed

| fault | where | evidence | why not here |
|---|---|---|---|
| the strip covers the page's consent button | youtube.com ("Nõustu kõigiga" at y 757 to 797), ilmateenistus.ee ("Nõustun" at y 806 to 850); the strip is y 772 to 900 at 1280 x 900 | Playwright's pointer click: `<utle-strip></utle-strip> intercepts pointer events`; `docs/proof/r9-real-youtube.png`, `r9-real-ilmateenistus.png` | the strip's layout (`strip.ts`) belongs to another lane; `readPage` still lists the button as `[dialog] …` for a voice click |
| a headline's comment count is read | postimees.ee, the day's first article: the h1 ends "(11)" | the third sentence read was "(11)" | seen on one article after the fixes; not reproduced on a fixture yet |
