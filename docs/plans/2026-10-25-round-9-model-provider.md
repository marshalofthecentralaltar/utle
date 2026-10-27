# Round 9: the model behind `/api/intent` becomes a choice (2026-10-25)

Source: the owner's three lines of 2026-10-25: route model calls through an abstraction layer so a
provider swap is configuration; measure tokens per *completed task*, not per call; keep one
open-weight fallback that has actually been run. Plus the ask to pick the single most competitive
cheap Chinese model to test against the Claude models the server uses today.

Research was done on 2026-10-25 from web-search snippets; the sandbox could not open the official
pricing pages directly, so every number marked **[unverified]** must be read off the vendor's page
before anyone commits to it. Everything in section 3 that is not marked was consistent across at least
two sources.

## 0. State the plan starts from

- `main` at ef3bab3, round 8 merged, Railway deploy done 2026-10-23 (`docs/DEPLOY.md`).
- `POST /api/intent` (`server/intent.ts`) makes one Anthropic call per ask: `claude-sonnet-5-5` by
  default (`DEFAULT_MODEL` in `server/app.ts`, `UTLE_MODEL` overrides), one tool `answer`, system
  prompt about 27 kB marked `cache_control`, `output_config.effort` low (quick) or high (careful),
  `max_tokens` 400 or 2000, SDK timeout 7 s or 12 s. The SDK is already behind a two-line interface,
  `MessagesClient` in `server/interpret.ts`, but its params are Anthropic-shaped (system blocks,
  `output_config`, `tool_choice`), so nothing but Anthropic can sit behind it today.
- The cost of a task is unknown. The server logs `kind`, `care` and `ms`; `usage` is never read,
  except in `scripts/flow-eval.ts`. The eval (`scripts/intent-eval.ts`, 62 cases) prints pass rate
  and p50/p95 latency per ask, no tokens, no dollars.
- A "task" already exists as an object in the engine: a `Job` in `extension/src/engine.ts` runs one
  utterance to its end (one goal, or a chain of goals, each in steps, each step one ask) and ends in
  exactly one way: done, stopped, unclear, cancelled, or the watchdog. The server knows none of that.
- Prices today (Anthropic list, cached 2026-10-06 in the claude-api skill, per 1M tokens):
  Fable 5.1 $10 in / $50 out / $0.25 cache read; Opus 5.5 $4 / $20 / $0.20; Sonnet 5.5 $2 / $10 /
  $0.20; Haiku 5.5 $0.10 / $0.50.
- A latent fault found while reading: `server/interpret.ts` (the old `/api/interpret` demo path)
  sends `tool_choice: { type: 'any' }`, which Opus 5.5 and Sonnet 5.5 reject with a 400. Nothing in
  the extension calls it; `npm run smoke` does. Fix it in lane A for free (`auto` plus the prompt).

## 1. The decision: which model to test against Claude

**Test first: DeepSeek V4.1-Flash** (API model name `deepseek-flash`, build 1017 of 2026-10-17),
with thinking disabled, through its OpenAI-compatible API, and then the same weights through a
US or EU host for anything that touches a real user's page.

Why it and not the others, in the order that matters for a spoken command:

1. **Licence.** MIT weights on Hugging Face (`deepseek-ai/DeepSeek-V4.1-Flash`), confirmed by every
   source. The licence is the whole point of the exercise: it is what lets the weights move to a
   host with a data-processing agreement. Kimi K3 (custom licence), Qwen3.8-Max (custom, MAU
   clause), MiniMax M3 (community licence) do not give that.
2. **Price.** Official API, per 1M tokens: $0.15 in (cache miss), $0.003 cache hit, $0.60 out
   off-peak; $0.30 / $0.006 / $1.20 at peak. Peak reported as 01:00 to 04:00 and 06:00 to 10:00 UTC
   on weekdays, which is an Estonian working morning **[unverified]**. Against Sonnet 5.5 that is
   roughly 7 to 13 times cheaper on input and 8 to 17 times on output, and the cache hit makes the
   27 kB system prompt nearly free. Caching is automatic by prefix, no `cache_control`.
3. **Latency.** Non-reasoning mode: time to first token about 0.9 to 1.35 s, 270 to 300 tokens a
   second (Artificial Analysis, Requesty, OpenRouter). That fits a 2.5 s p50 for an answer of 100 to
   300 tokens only with thinking **off** (`thinking: { type: 'disabled' }` or the lowest
   `reasoning_effort`): the reasoning variant's first token lands after about 11 s. Careful asks
   therefore cannot buy thinking the way they do on Claude; see 4.3.
4. **Capability.** Artificial Analysis Intelligence Index 45 (reasoning on), 25 (off; non-reasoning
   peers' median 12). Self-reported: Automation-Bench 60.5 against Opus 5's 50.3, Terminal-Bench 2.1
   90.6 against 89.1, but Terminal-Bench 4.0 42.3 against 51.8. No tau-bench or BFCL row for V4.1.
   Opus 5.5 leads the index at 58.
5. **Hosts.** 21 providers list it: Fireworks $0.22 / $0.66 (US), DeepInfra $0.20 / $0.60 (US),
   SiliconFlow $0.15 / $0.60, Baseten (fastest first token listed, 0.43 s), Scaleway and Nebius
   (EU companies; prices not retrieved) **[unverified]**. A Vercel AI SDK provider exists
   (`@ai-sdk/deepseek`) that exposes the cache-hit counts.

**Runner-up: GLM-5.3-Flash** (Z.ai, MIT, $0.15 / $0.03 cached / $0.50): the best agentic score of
the cheap tier (58.2), but first token measured at 4 to 41 s on Z.ai's own API with reasoning on.
Only worth testing through a faster host with reasoning off. **Third, if Estonian is the problem:**
Xiaomi MiMo-V2.6-Pro (MIT, index 46, $0.435 / $0.87), no latency or tool-calling data found.

**Not for this use:** Kimi K3 / K3.1 Pro ($2 to $3 in, $10 to $15 out, always-on reasoning, K3.1
weights promised only by 2026-11-04), Qwen3.8-Max ($2 / $6, custom licence), MiniMax M3.

**Risks the eval must answer, in order:** (a) does it honour a required tool call every time (a
Hugging Face thread on V4-Flash-0731 says forced tool use is not always honoured; the server
already turns a text-only reply into `unclear`, so a miss costs a command, not a crash); (b)
Estonian: no benchmark covers DeepSeek on Estonian (the one Estonian study, arXiv 2510.21193, found
commercial flagships ahead of open models, Kimi K2 the closest); the 62 eval cases are the first
signal anyone will have; (c) verbosity: it "answers at great length" on the index, so `max_tokens`
400 stays and the `say` clip stays; (d) peak-hour price; (e) JSON mode is soft, so the tool schema
is the only schema.

**Data.** DeepSeek's first-party API stores data in the PRC, offers no region choice, and no public
Article 28 agreement was found; Italy's and Berlin's regulators have acted against the app. Z.ai's
default endpoint is in China; Moonshot is a Singapore entity that trains on API content by default
**[aggregator]**. Alibaba Model Studio has a Frankfurt region, the only Chinese first party with one.
Rule for Ütle: **the first-party DeepSeek endpoint sees synthetic eval pages only.** A real user's
page content (an accessibility user's messages, mail, forms) goes to the fallback only through a
host with a DPA (Together dedicated EU, Scaleway or Nebius if confirmed, Fireworks enterprise), and
`docs/PRIVACY.md` must name that host before the switch is ever flipped in production.

## 2. The structure

Three lanes, dispatched in this order because B and C measure what A makes swappable. Each lane
is one deliverable with its own tests; the gate is `npm run check` and the browser suite as always.

### Lane A: `server/model/`, the one door to any model (the abstraction layer)

Own thin wrapper, not OpenRouter and not the Vercel AI SDK. Reasons: the call has one shape (one
system prompt, one user turn, one tool, one answer), so an adapter is about a hundred lines per
provider; OpenRouter is a vendor in the hot path with a 5.5 % fee on credit and drops Anthropic's
`cache_control` unless it routes to Anthropic directly; the AI SDK keeps `cache_control` and
`effort` but has open issues around caching with structured output and would be a second
abstraction over the one we already have. OpenRouter stays useful as a *provider* behind the
wrapper for one-off tests of models we have no key for (its Exacto routing mode is the one to use
for tool calling).

Files, all under `server/model/` (server code, so the core rule does not bind it; still no DOM, no
`any`, `.ts` imports, named exports):

- `types.ts`: the provider-neutral request and reply.
  ```ts
  export interface ModelAsk {
    system: string            // the fixed, cacheable prefix
    systemExtra?: string      // CAREFUL_PROMPT, after the cached block
    user: string
    tool: { name: string; description: string; schema: Record<string, unknown> }
    effort: 'low' | 'high'
    maxTokens: number
    timeoutMs: number
  }
  export interface ModelReplyNeutral {
    call: unknown | null                                  // the tool input, or null
    stop: 'tool' | 'text' | 'cut' | 'refusal' | 'error'
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
    provider: string; model: string; ms: number
  }
  export interface Model { ask(ask: ModelAsk): Promise<ModelReplyNeutral> }
  ```
- `anthropic.ts`: today's call moved verbatim: SDK, `cache_control` on the first system block,
  `output_config.effort`, `tool_choice auto` with `disable_parallel_tool_use`, the `usage` fields
  read into the neutral shape, the error mapping from `toIntentError`.
- `openaiCompat.ts`: one `fetch` to `${baseUrl}/chat/completions` with the Node `fetch` and an
  `AbortSignal.timeout`; `messages: [system, user]`, `tools: [{ type: 'function', function }]`,
  `tool_choice: { type: 'function', function: { name } }`, `max_tokens`, and for DeepSeek
  `thinking: { type: 'disabled' }` on quick asks and the lowest reasoning setting on careful ones
  (the exact field name is checked against the live docs in the lane, not assumed). Reads
  `usage.prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` when present, else
  `prompt_tokens`. Parses `tool_calls[0].function.arguments` with `JSON.parse` in a try; a parse
  failure is `stop: 'text'`. Covers DeepSeek, Fireworks, DeepInfra, OpenRouter, Z.ai, Moonshot,
  Alibaba with nothing but a base URL and a key.
- `config.ts`: the configuration is one string per slot, provider and model joined by a colon:
  `UTLE_MODEL=anthropic:claude-sonnet-5-5` (default), `UTLE_MODEL=deepseek:deepseek-flash`,
  `UTLE_MODEL=openai:<model>` with `UTLE_MODEL_URL` and `UTLE_MODEL_KEY` for any other host.
  Known providers carry their base URL and key variable: `deepseek` reads `DEEPSEEK_API_KEY`,
  `fireworks` `FIREWORKS_API_KEY`, `openrouter` `OPENROUTER_API_KEY`. A bare model id without a colon
  stays Anthropic, so every existing `UTLE_MODEL` keeps working. `UTLE_FALLBACK=<same syntax>`
  names the second model, empty by default.
- `fallback.ts`: `withFallback(primary, fallback)` is itself a `Model`. It tries the fallback only
  on a **fast** failure of the primary: 401, 403, 429, 5xx, connection refused, a `refusal`. Never
  on a timeout: a voice command that already waited 7 s cannot wait 7 more. The reply says which
  provider answered; the log line gains `provider=`.
- `index.ts`: `modelFromEnv(env)` returns the configured `Model`; `/api/status` reports
  `model: { primary, fallback, last: 'primary' | 'fallback' | null }`.

`server/intent.ts` keeps everything it does (schema parse, care, `answerFrom`, `pageIntentFrom`,
the log line) and calls `deps.model.ask(...)` instead of `deps.client.messages.create(...)`.
`server/interpret.ts` moves to the same door and loses its forced `tool_choice`. `scripts/intent-eval.ts`,
`flow-eval.ts` and `smoke.ts` build the model with `modelFromEnv`, so `UTLE_MODEL=deepseek:deepseek-flash
npx tsx scripts/intent-eval.ts` is the whole test.

Tests, written first (`server/model/*.test.ts`, fakes only, no network): the Anthropic adapter
sends exactly what `server/intent.test.ts` asserts today (the cached block, the second block only
when careful, effort, tokens, timeout) and reads usage; the OpenAI adapter builds the request body
from a `ModelAsk` and parses a `tool_calls` reply, a text reply, a cut reply (`finish_reason:
length`), a 429, a connection error, a malformed `arguments`; the fallback runs on each fast failure
and not on a timeout; the config parses every form and rejects an unknown provider with a clear
message; `/api/status` reports the three fields. `server/intent.test.ts` keeps passing with a fake
`Model` instead of a fake `MessagesClient`. CLAUDE.md gains the new variables; `extension/README.md`
"Hosted server" too; `docs/DEPLOY.md` says the Railway variables for a fallback.

### Lane B: tokens and dollars per completed task (the instrumentation)

The unit is the engine's `Job`. Three small changes carry the number from the model to one line:

1. **The server returns usage.** `IntentAnswer` gains an optional `usage: { input, output, cacheRead,
   cacheWrite, provider, model }` (`src/core/pageIntent.ts`, schema and type; the engine ignores it
   for everything but the tally). The server log line gains `in= out= cached= provider=`.
2. **The engine tallies per job.** `Job` gets `spend: { asks, input, output, cacheRead, ms }` summed
   in `askOnce`. When the job ends, in the one place every ending passes (`finishJob` or its
   equivalent in `engine.ts`; the lane finds it), the engine emits one record:
   `{ outcome: 'done' | 'stopped' | 'unclear' | 'cancelled' | 'tookTooLong' | 'rules', asks, steps,
   goals, input, output, cacheRead, ms, provider, model }`. `rules` is a task the rules finished with
   no model at all, kept so the share of model-free tasks is visible. The record goes to the console
   and to a ring of the last 200 in `chrome.storage.local` (`utle-spend`), never with words.
3. **The eval prints the number.** `scripts/intent-eval.ts` already runs each case as a task
   (steps and chains included). Per case it sums the asks' usage and prints `tokens` and `$`; at the
   end it prints the table that decides anything:

   | model | pass | asks per task | tokens per completed task (in / cached / out) | $ per completed task | $ wasted on failed tasks | p50 / p95 ms |

   "$ per completed task" is total spend divided by passed cases, so a model that fails cases pays
   for them in the denominator. A price table per model id lives in `scripts/prices.ts` (moved
   out of `flow-eval.ts`), with peak and off-peak for DeepSeek and the hour of the run in the JSON.
   `UTLE_EVAL_JSON` gets the per-task records so two runs can be diffed.

A settings-page readout ("Kulu": tasks today, asks per task, which model answered) is **not** in
this round: the number must first be seen in the eval and the console. Tests: `engine.test.ts`
(the tally over a chain of three asks and a failed step, the `rules` outcome, the ring's cap),
`pageIntent.test.ts` (the schema accepts and omits usage), the eval's table with a fake model.

### Lane C: the fallback, run in anger (the drill)

What "tested" means here, as a checklist that lives at the end of this file and is ticked with
dates and numbers, never with "should work":

1. **The eval on the fallback.** `UTLE_MODEL=deepseek:deepseek-flash npx tsx scripts/intent-eval.ts`
   with `UTLE_EVAL_JSON`, on synthetic pages only. Record pass rate, p50 / p95 per care, $ per
   completed task, and the list of failed case names next to the same run on `claude-sonnet-5-5`
   the same hour. Acceptance to count as a fallback at all: at least 90 % of the primary's pass
   rate and p50 under 2.5 s on quick asks. Below that it is a measurement, not a fallback.
2. **The switch itself.** Start the dev server with a wrong Anthropic key and
   `UTLE_FALLBACK=deepseek:deepseek-flash`; `curl /api/status` says `last: null`; one ask through
   the eval with `UTLE_EVAL_ONLY` says `provider=deepseek` in the server log and `last: fallback` in
   the status. Then the other way round: a wrong DeepSeek key and the primary healthy, nothing
   changes for the user. Then a 429 forced with a fake in `fallback.test.ts`.
3. **A second host for the same weights.** The same eval with `UTLE_MODEL=fireworks:<id>` (or the
   first EU host whose terms are confirmed), because the leverage is the weights, not DeepSeek's
   servers: record the latency difference and whether the tool call is honoured as often.
4. **Repeat on a schedule.** Every round's close runs step 1 for both models and appends the row.
   A fallback whose last row is older than a month is marked stale in the checklist.
5. **Before production use with a real page** (not this round): the host's DPA in `docs/PRIVACY.md`,
   and the strip tells the user which assistant answered when it was not the usual one (one
   string, `inpage.fallbackUsed`, so he knows why the answers feel different).

## 3. Numbers to put against each other (from the research, 2026-10-25)

| model | licence | $ in / cached / out per 1M | first token | index (AA) | note |
|---|---|---|---|---|---|
| Claude Fable 5.1 | closed | 10 / 0.25 / 50 | always thinks | top tier | not for a 2.5 s command |
| Claude Opus 5.5 | closed | 4 / 0.20 / 20 | eval p50 2.7 s (1a) | 58 | too slow by voice |
| Claude Sonnet 5.5 (today) | closed | 2 / 0.20 / 10 | eval p50 about 1 s (round 3) | | the baseline |
| DeepSeek V4.1-Flash | MIT | 0.15 / 0.003 / 0.60 off-peak; 0.30 / 0.006 / 1.20 peak [unverified hours] | 0.9 to 1.35 s, thinking off | 45 on / 25 off | **test first** |
| GLM-5.3-Flash | MIT | 0.15 / 0.03 / 0.50 | 4 to 41 s on Z.ai, reasoning on | 57.5, agentic 58.2 | only through a fast host |
| MiMo-V2.6-Pro | MIT | 0.435 / 0.0036 / 0.87 | unknown | 46 | third, if Estonian fails |
| Kimi K3.1 Pro | custom, weights pending | 2 / 0.20 / 10 | always thinks | 55 | no |
| Qwen3.8-Max | custom | 2 / 0.25 / 6 | | BFCL v4 lead (3.7-Max 75 %) | Frankfurt region; no |
| MiniMax M3 | community | 0.30 / – / 1.20 | | | no |

Sources the lane should open first: arXiv 2609.19969 (the V4.1-Flash paper), the Artificial
Analysis pages for `deepseek-v4-1-flash-non-reasoning` and `deepseek-v4-1-flash-1017/providers`,
DeepSeek's own pricing page (for the peak hours), `huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash`
(the licence file itself), Together's "EU data centers" support page, arXiv 2510.21193 (the Estonian
benchmark).

## 4. Decisions taken here, so the lanes do not re-decide them

1. **Own wrapper, two adapters, one config string.** Not OpenRouter as the layer, not the AI SDK.
2. **The fallback never waits twice.** It runs on fast failures only; a timeout stays a timeout and
   the engine's "Abiline ei vastanud" lines stay as they are.
3. **Careful asks on a non-thinking fallback get no thinking.** They keep `CAREFUL_PROMPT`, the
   2000-token budget and the 12 s wait; whether planning survives without thinking is a line in
   the eval table (the chain cases are all careful), not an assumption.
4. **Synthetic pages only to Chinese first-party endpoints.** Section 1, "Data".
5. **The metric is $ per completed task on the eval, with failed tasks in the cost and out of the
   denominator.** Per-call token counts are printed but never the headline.
6. **Default model does not change this round.** Sonnet 5.5 stays until a row in the table says
   otherwise and Ralf has heard the difference by voice.

## 5. Questions for Ralf (answer when convenient; nothing here blocks the lanes)

1. A DeepSeek API key for the eval (a few cents) and, later, a Fireworks or other host key: put them
   in the terminal's environment like the Anthropic key, never in a file.
2. Is a 10 % drop in the eval's pass rate acceptable for a fallback that costs a tenth? That sets
   the acceptance line in lane C.
3. Which host is acceptable for a real user's page content: the answer decides whether lane C step
   3 is Fireworks (US) or an EU host.

## 6. The checklist (lane C ticks it; nothing below is true until a date stands next to it)

- [ ] Eval on `anthropic:claude-sonnet-5-5`, same hour as the next line: pass __ / 62, p50 __ ms quick, __ ms careful, $ __ per completed task.
- [ ] Eval on `deepseek:deepseek-flash`: pass __ / 62, p50 __ / __ ms, $ __ per completed task, tool call missed __ times, failed cases: __.
- [ ] Switch drill: wrong primary key falls to the fallback in one ask; wrong fallback key changes nothing.
- [ ] Same weights on a second host (`__`): pass __, p50 __.
- [ ] Row repeated at the close of round 10.
