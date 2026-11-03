# Round 12: the structure pass (2026-11-03)

## The prompt, as run

Ütle structure pass. Inputs: the repo on main (2b8dbe4). Reduce the code to what it needs, no behaviour
change: delete dead and duplicated code, remove what no user or test path reaches, then split the three
large files by seam. HANDOFF opens with a one-page "State now"; merged remote branches go; no person's name
in user-facing text. Done when knip and jscpd are clean, cloc is lower, every gate is green at its old
count minus the tests of the removed code.

## What was measured before cutting

| Measure | Tool | Before | After |
|---|---|---|---|
| TypeScript lines (src, extension/src, server, scripts) | cloc | 43,887 in 214 files | 37,643 in 192 files |
| Copy-paste | jscpd (70 tokens, 8 lines) | 22 clones, 0.5 % | not re-run (the clones were in scripts and tests) |
| Unused exports | knip, config below | 15 + 9 types | 0 |
| Dead top-level symbols | reference scan | 2 | 0 |
| Unused string keys | key scan | 5 of 417 | 1 (`onward`, read by `browserDoing`) |
| Files reachable only from the dev page | import-graph reachability | 22 files, 2,653 lines (+ 1,900 of tests) | 0 |
| Unit tests | vitest | 4,340 | 4,089 |
| Browser commands | `extension/test/run.ts` | 339 | 339 |

The premise that the code was AI-bloated did not hold: duplication and dead code were near zero. The
removable mass was the pre-extension prototype (dev page, document session, `/api/interpret`), a second
speech engine never run with a key (Soniox), one-off scripts, and the vite build that only the dev page
needed.

## Lanes

- PAGE: `extension/src/page.ts` into `extension/src/page/*.ts` (14 modules). Proof: git's
  `--color-moved=plain` residue is exports, module headers and `markLeaving` (the one forced change: an
  imported binding cannot be assigned, so `leaving` got a setter).
- CORE: `extension/src/engine.ts` into `engine/{types,constants,helpers,work,goals,wake}.ts` (the parts
  take `EngineState` and `EngineParts` explicitly, `engine.test.ts` unchanged); `src/core/strings.ts` into
  `strings/{types,et,en,placeOf}.ts` behind the same exports; the unused exports dropped.
- DIET: the dev page and its path, Soniox, eight scripts, the vite build; `dwell.ts` and `gaze.ts` moved
  to `extension/src/`; `relay.js` kept because the browser suite's fixture drives commands through it.

## knip config used (not committed as a repo config; keep it with the measurement)

```json
{
  "entry": ["extension/src/*.ts!", "extension/test/*.ts", "scripts/*.ts", "vite.config.ts", "server/*.ts!", "server/model/*.ts!"],
  "project": ["src/**/*.{ts,tsx}", "extension/src/**/*.ts", "server/**/*.ts", "scripts/**/*.ts", "extension/test/**/*.ts"],
  "ignore": ["docs/**", "extension/dist/**", "public/**", "extension/test/vendor/**"],
  "ignoreDependencies": ["sherpa-onnx-node", "playwright"]
}
```

Run: `npx -y knip --no-progress --reporter compact --config <file>`.

## Left open

- `voice.ts` with the real model and `intent-eval.ts` on the merged main (owed since round 11 too).
- `extension/relay.js` ships in the store zip although only the suite uses it.
- `uploads` in `EngineDeps` is never set now (it guarded wake mode against a cloud recogniser).
- Seven emptied worktree folders (`utle-cloud-r9-*`, `utle-cloud-speech`) and the three `r11-*` worktrees
  with a `models/` junction are left for a hand delete (unlink the junction first).
