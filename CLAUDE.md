# Ütle

A Chrome extension for people who cannot use their hands: Estonian speech is typed into the site's
own message box, repaired and sent by voice, and the same voice moves the browser. Speech is
recognised by TalTech's model in the local dev server. Hackathon prototype (NewWorkTech, TalTech
Mektory, 5 and 6 October 2026). Nothing auto-deploys: no CI, no hosting, and the extension is loaded
unpacked.

## Read first

- `HANDOFF.md`: current state, known faults, what is and is not verified.
- `docs/PRODUCT.md`: what the product is, in plain words.
- `docs/ARCHITECTURE.md` is the spec; sections 21 onward describe what is built, 1 to 20 are
  history. When code and spec disagree, one of them is a bug: fix the spec first, then the code.
- `extension/README.md`: build, load, use and test the extension.
- `docs/plans/` holds the implementation plan for each milestone.

## Rules

- `src/core/**` is pure: no DOM, no network, no timers, no imports from `speech`, `api`, `ui` or `server`.
- The model proposes operations and never returns a rewritten document. Every op is validated against the document on the server and again in the reducer.
- Relative imports carry the `.ts` or `.tsx` extension (the server project compiles with `nodenext`).
- Types are imported with `import type` (`verbatimModuleSyntax`).
- Named exports only, except where a tool demands a default (`vite.config.ts`).
- No `any` casts, no skipped tests, no enums (`erasableSyntaxOnly`).
- The Anthropic key is read from `process.env.ANTHROPIC_API_KEY` on the server. Never create or commit a `.env` file.
- The server never logs document text, utterances or audio.
- Test first. Behaviour changes start in `src/core/*.test.ts`.

## Commands

- `npm run dev` runs the dev server: the speech model at `ws://localhost:5173/api/asr` and the development page.
- `npm run model` downloads TalTech's speech model into `models/` (once).
- `npm run ext` bundles `extension/src/` into `extension/dist/`; reload the extension after it.
- `npm run check` is the gate: typecheck, lint, test, build, extension build.
- `npx tsx extension/test/run.ts` runs every browser command in Chromium.
- `UTLE_REAL=1 npx tsx extension/test/voice.ts` (PowerShell: `$env:UTLE_REAL=1; npx tsx extension/test/voice.ts`) runs recorded speech through the real model and the real command logic (without `UTLE_REAL=1` it uses a stand-in); needs `npx vite --port 5193 --strictPort`.
- `npm run smoke` runs the old demo script through the real model. It spends a few cents.
- `npx tsx scripts/intent-eval.ts` runs 28 Estonian utterances through `/api/intent`'s model against fake pages (needs `ANTHROPIC_API_KEY`).

## Not verifiable without a person

A real voice, a real eye tracker, and logged-in WhatsApp and Messenger. Everything else is tested
with recorded speech and stand-in pages.
