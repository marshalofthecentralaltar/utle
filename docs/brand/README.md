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
- `site.html` is the landing page mock, English with an Estonian switch (ET strings in its script), written as an Artifact page (no `<html>` wrapper).
- Copy follows the `plain-product-copy` skill (`~/.claude/skills/plain-product-copy`): no slogans, triads or contrast fragments.
- `site/` at the repository root is the live site (utle-site on Vercel, meant for utle.ee): `index.html`
  is the same page as `site.html` with a full document head, `privaatsus.html` is `docs/PRIVACY.md`.
  Deploy by hand from `site/` with `vercel deploy --prod`; nothing deploys on commit.
