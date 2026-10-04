# Ütle

A document editor for people who cannot use their hands: say the change, see what was
understood, repair it in one word. Hackathon prototype (NewWorkTech, TalTech Mektory, 5 and 6
October 2026). Local only: no remote, no deploy.

## Read first

- `docs/ARCHITECTURE.md` is the spec. When code and spec disagree, one of them is a bug: fix the spec first, then the code.
- `docs/plans/` holds the implementation plan for each milestone.

## Rules

- `src/core/**` is pure: no DOM, no network, no timers, no imports from `speech`, `api`, `ui` or `server`.
- The model proposes operations and never returns a rewritten document. Every op is validated against the document on the server and again in the reducer.
- Relative imports carry the `.ts` or `.tsx` extension (the server project compiles with `nodenext`).
- Types are imported with `import type` (`verbatimModuleSyntax`).
- Named exports only, except where a tool demands a default (`vite.config.ts`).
- No `any` casts, no skipped tests, no enums (`erasableSyntaxOnly`).
- The Anthropic key is read from `process.env.ANTHROPIC_API_KEY` on the server. Never create or commit a `.env` file.
- The server never logs document text or utterances.
- Test first. Behaviour changes start in `src/core/*.test.ts`.

## Commands

- `npm run dev` runs the whole product (the API is a Vite dev-server plugin).
- `npm run check` is the gate: typecheck, lint, test, build.
- `npm run smoke` runs the demo script through the real model. It spends a few cents.

## Not verifiable without a person

Voice input. The typed box sends the same event as the microphone, so everything else is testable.
