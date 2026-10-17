# Brand

The identity carries on from the pitch poster (`docs/pitch`) and the approved UI mock of 6 October:

- **Wordmark:** `ütle` in lowercase Bricolage Grotesque ExtraBold. The two dots of the umlaut are drawn as
  green circles, the "listening" light.
- **Colour:** ivory on near-black. Green (`#3ddc84`) means listening and marks the one action on a page.
  Amber (`#f0b429`) means done and is used for what Ütle says back. The light theme darkens the amber to
  `#8a5a00` so that text stays readable.
- **Type:** Bricolage Grotesque for display, Manrope for text and the bar, JetBrains Mono for spoken words,
  always set in Estonian quotes („…“).
- **The bar is the hero.** Every visual shows the product's own bar: a mint tile, the heard sentence in large
  type, and one amber line saying what was done.

Files:

- `linkedin.html` renders `utle-linkedin-square.png` (1080x1350, feed) and `utle-linkedin-banner.png`
  (1200x627, link card) at 2x: `node docs/brand/render.mjs`.
- `site.html` was the first landing page mock (14 October); `site/index.html` has replaced it and is the source now.
- **Demo video** (`site/demo.mp4`, `site/demo.webm`, `site/poster.jpg`, 17 October): the real extension and the
  real local recogniser on the WhatsApp stand-in page, filmed by `scripts/demo-video.ts` with a fake microphone.
  The voice is TartuNLP's "tambet" (`https://api.tartunlp.ai/text-to-speech/v2`); three lines joined with
  `scripts/fixture.ts --lead 1.5 a.wav out.wav 4.5 b.wav 4 c.wav`. The script writes `demo-raw.webm` (silent)
  and `demo-meta.json`; ffmpeg lays the speech over it from `micOpenedAt` and cuts from `hoverAt - 0.8 s`:
  `ffmpeg -i demo-raw.webm -itsoffset <micOpenedAt s> -i speech.wav -filter_complex "[0:v]trim=start=S,setpts=PTS-STARTPTS[v];[1:a]atrim=start=S,asetpts=PTS-STARTPTS,aresample=48000[a]" -map [v] -map [a] -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart -c:a aac demo.mp4`
  (webm: `-c:v libvpx-vp9 -crf 34 -b:v 0 -c:a libopus`). Mari's voice mishears "jõuan" as "joon"; Tambet's does not.
- Copy follows the `plain-product-copy` skill (`~/.claude/skills/plain-product-copy`): no slogans, triads or contrast fragments.
- `site/` at the repository root is the live site (utle-site on Vercel, meant for utle.ee): `index.html`
  is the same page as `site.html` with a full document head, `privaatsus.html` is `docs/PRIVACY.md`.
  Deploy by hand from `site/` with `vercel deploy --prod`; nothing deploys on commit.
