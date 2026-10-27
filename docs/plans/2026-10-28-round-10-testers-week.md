# Round 10: ready for seven testers (week of 2026-10-27)

Source: Ralf's words on 2026-10-27 after an hour of real use with two partners: "There's still too
little getting used to ambiguity", "the activation word is pretty inefficient", "when it listens all
the time and logs everything that is said ... you have to create this moment of silence before you
can actually prompt it", "the voice recognition is showing absolutely no progress", "how slow
everything is", "short commands should be near instantaneous", "it constantly transcribes everything
it hears below and it also creates a lot of confusion for the program", "we need to get this platform
ready within THIS week so we can start testing" (seven testers at Rapla Hooldekogu, NewWorkTech next),
"onboarding ... first it would start out with the voice recognition and there on it would only
recognize voice."

The round is about one thing: a stranger in a care home, with a helper, can use Ütle for ten minutes
without the three failures Ralf hit today (it did not do what he meant, it listened to the wrong
person, it was slow). Nothing else is in scope.

## Priorities and GitHub issues (set 2026-10-27 evening)

Tracking: #9. The meeting's two issues come first; they are written as one PR each, on a branch,
reviewed before merge (their own rule, which beats this repo's work-on-main habit for them).

| Order | Issue | Covers | Lane below |
|---|---|---|---|
| Main | #3 Only my voice: fail-closed speaker gate, verified onboarding, short commands | P4, P8 | VOICE (replaced by #3's work packages A to F) |
| Main | #2 Wake word anywhere in speech, PASSIVE / ACTIVE / HARD OFF, no leakage | P2, P3 in wake mode | LISTEN, wake half (replaced by #2's sequence) |
| Side, first | #4 Real-voice measurement set | input to #2 and #3 | MEASURE |
| Side | #5 Ambiguity | P1, P6 | AMBIGUITY |
| Side | #6 Always-on mode keeps room speech out | P3 in always-on mode | LISTEN, always-on half |
| Side | #7 Speed: Haiku / Opus, endpointing | P5 | FAST |
| Side | #8 Dev key source | P9 | ENV |

Two rules from #2 and #3 bind the side lanes: nothing speech-driven runs before a positive owner
verdict when only-owner is on (so FAST's "act on the partial" is only-owner-off or post-verdict),
and PASSIVE sends no audio to any hosted ASR. The acoustic wake word is no longer simply out of scope:
#2 accepts an ASR-based coordinator behind the same interface, labelled limited, for this week, and
stays open for the acoustic detector.

## 0. State the plan starts from (measured 2026-10-27 12:40)

- `main` 7a5ce7c = `origin/main`, clean. Round 9 closed at 12:30 (first-run page, help, store packet,
  five faults, real pages, model door). The 4619ee17 session is done with this checkout.
- Dev server up with `UTLE_CAPTURE=C:\temp\utle-voice` (14 clips captured today, gate-labelled, not
  person-labelled; two of them contain Ralf's ID code and phone number spoken aloud; delete the folder
  when section 1 of lane MEASURE is done).
- Speaker gate: TitaNet-small, `OWNER_THRESHOLD` 0.54 calibrated on synthetic TartuNLP voices only.
  Today's real scores: clips the gate called owner 0.557 to 0.692, clips it called other 0.309 to
  0.539. A 0.02 margin at the cut-off. Who actually spoke is not recorded.
- Endpointing: rule1 2.4 s, rule2 1.0 s trailing silence, rule3 30 s. Intent calls today: quick
  1.4 to 2.2 s, careful 2.0 to 6.0 s, on Sonnet 5.5.
- Wake word: `src/core/wake.ts` matches "ütle" only as the first word of a final, one edit away
  ("ütel"), never with a letter added ("ütles", "ütlemine"). "ütle" is not in `models/hotwords.txt`
  (321 lines, none starts with it).
- Listening modes today: always on, wake word, and the strip toggle (a Tobii dwell click). Only-owner
  is a setting; enrolment is a button on the settings page, not part of the first run.
- Voice fixtures for proof: five Estonian clips in `scripts/fixtures/`, a synthetic speaker set,
  `scripts/asr-hotwords-eval.ts`, `scripts/speaker-calibrate.ts`, `scripts/intent-eval.ts` (78 cases).

## 1. The problems, from today's session

| # | What happened | Where read | Class |
|---|---|---|---|
| P1 | "Ava email" while the API-key site was in front: it opened mail in the same tab instead of beside it. "Ava uues vahelehes" then went to the other open tab (unicorns.ee). Twice to get "ava esimene kiri". The black verify button in the mail could not be clicked by name; `näita numbreid` was needed. | Ralf's account | Ambiguity: tab intent, ordinal references, buttons that are links |
| P2 | "Ütle, mine ..." is recognised as "Ütlemine ..." and the wake word never fires; the wake mode "can't be turned on" by voice. | Ralf's account; `wake.ts` 60; hotwords.txt | Wake word |
| P3 | In always-on mode everything anyone says lands in the bar; a command said while people talk is merged with their speech, the task never finishes ("Mine youtubei ja ava video" plus the room). The user has to make silence first. | Ralf's account; `wakeStarts`; rule2 1.0 s | Addressed speech |
| P4 | Only-owner let both partners through after a fresh 12-phrase enrolment. | dev2/dev3 logs, scores above | Speaker gate |
| P5 | Everything is slow; short commands should be near instant and not depend on a preset phrase list. | Ralf's account; intent ms above | Latency |
| P6 | "Scroll down for a minute straight" went to unclear. | dev log, earlier today | Intent coverage |
| P7 | ASR errors on ordinary speech today: "Uue kepiliti siin vahepeal", "Näitenumbreid", "Mina emaili" (for "mine emaili"). | capture log.tsv | ASR accuracy |
| P8 | Onboarding: the first run should begin with the voice, and from then on only that voice. | Ralf's account | Onboarding |
| P9 | The wrong API key was in use (Windows user variable outranks `.env.local`). Fixed per process only. | this session | Environment |

## 2. What the research says (2026-10-27, vendor pages unless marked)

ASR accuracy, Estonian. No independent 2026 benchmark exists. Speechmatics' own FLEURS table:
Speechmatics Enhanced 11.6 % WER, Whisper large-v3 22 %, Google Chirp 2 25.3 %, Deepgram Nova-2
45.2 %. ElevenLabs lists Estonian in Scribe v2's "excellent (at most 5 % WER)" tier on its own set.
Soniox claims 1.25 % on its own set. Google Chirp 3 streams et-EE in Preview only. TalTech's streaming
zipformer (ours, 1 334 h manual + 4 000 h TV) publishes no WER. Conclusion: only our own test set
can rank them; the spread between vendors on the same public set is 4x, so the measurement matters.

ASR latency and cost, streaming. ElevenLabs Scribe v2 Realtime: wss endpoint, partials about 150 ms,
`commit_strategy` manual / vad / turn_prediction, `vad_silence_threshold_secs`, $0.39 per hour
(2.5 h free). Soniox stt-rt-v5: Estonian, diarization, about $0.12 per hour. Speechmatics real-time:
$0.45 standard, $0.80 enhanced per hour, $100 free. All three send the audio to a US or UK cloud:
a care-home resident's speech leaves the building. Sherpa-onnx (ours) has no latency floor problem;
our floor is the 1.0 s trailing-silence rule plus the model call.

Speaker gate. Sherpa-onnx ships, besides TitaNet-small: 3D-Speaker CAM++ en-voxceleb (29.6 MB),
ERes2Net en-voxceleb (26.5 MB), WeSpeaker ResNet34 / CAM++ / ResNet152 / ResNet221 / ResNet293
en-voxceleb (LM variants), TitaNet-large (97.6 MB). 3D-Speaker's paper: EER ResNet34 6.9 %, ERes2Net
6.1 %, ERes2NetV2 6.0 %; ERes2NetV2 is built for short (3 s) utterances. One third-party test found
CAM++ advanced best on meetings (3.6 % EER). None of this transfers without a sweep on our clips:
`speaker-calibrate.ts --model` exists for exactly that.

Wake word. openWakeWord is English-only (its training TTS is English). Porcupine supports nine
languages, not Estonian, paid for commercial use. Sherpa-onnx keyword spotting needs a KWS model with
an Estonian token table; none exists. Our text-based wake word on the TalTech stream is the only
Estonian path this week; it can be made far better: hotword boost for "ütle", match it anywhere in a
final, split glued forms ("ütlemine" = "ütle" + "mine").

Addressed speech (is this said to Ütle?). Apple's work: ASR text plus decoder signals into an LLM
beats audio-only by 61 % relative EER. SAS (2026): under 20 MB, under 150 ms on device, F1 0.86 audio
only, English, weights not published. attenlabs saa-sdk: hosted, English-strongest. Nothing Estonian
and local exists. What we can do this week: the text path (Haiku classifies "command for the browser
/ dictation for the box / not for Ütle" with the recent context) plus the speaker gate plus a short
silence rule. Cheap, measurable on our transcripts.

Noise. Chrome's `noiseSuppression` and `echoCancellation` constraints exist; `voiceIsolation` is
Safari-only. Real target-speaker extraction in real time is research code. Not this week.

## 3. Lanes, ranked by what they do for a tester

### Lane MEASURE (first; the others depend on its numbers)

1. Record 20 minutes with three people: Ralf alone (10 commands, 10 dictations), one partner alone
   (10 of each), all three at once with Ralf commanding (10). Save per person with `UTLE_CAPTURE`,
   then label by person (the gate's own labels are not ground truth).
2. WER of the TalTech model on the labelled clips (scripts/asr-file.ts, reference typed by hand);
   the same clips through Scribe v2 Realtime (free hours) and Soniox (free credits) via a 60-line
   script each. Table: WER, median end-of-utterance latency, cost per hour.
3. `speaker-calibrate.ts --owner --other` with TitaNet-small, CAM++ en, ERes2Net en, ResNet34 en:
   EER and the best threshold on real voices. Pick the model and threshold.
4. Latency breakdown per command: speech end to final, final to intent, intent to action. p50/p95.

Proof: `docs/proof/r10-measure.md` with the four tables. Delete `C:\temp\utle-voice` after.

### Lane LISTEN (P2, P3): the bar shows what Ütle acts on, nothing else

- Wake word: "ütle" in hotwords (score 1.0, re-run asr-hotwords-eval to show nothing else changed);
  `wakeStarts` matches the wake word anywhere in a final and takes the words after it; glued forms
  split when the remainder starts a command verb ("ütlemine youtube'i" becomes "mine youtube'i").
- Addressed-speech check in always-on mode: a final that no rule matches goes to Haiku with the last
  three finals and the page summary; the answer is one of command / dictation / ignore; ignored
  speech never appears in the bar (a quiet counter "3 lauset ei olnud mulle" instead).
- A command in flight is not polluted: while a compound task runs, finals from others are dropped
  by the gate or by the addressee check, never appended to the task.
- Three modes with plain names on the first-run page: Vaata ja räägi (Tobii), Ütle-sõna, Alati.
  Default after enrolment: Ütle-sõna when no eye tracker is set, Vaata ja räägi when it is.

Proof: `src/core/wake.test.ts` for every form; a fixture of two voices (synthetic) where the second
voice's sentences never reach the bar; `intent-eval.ts` cases for the addressee answer.

### Lane VOICE (P4, P8): only my voice, from the first minute

- Model and threshold from MEASURE 3; score only on 1.5 s or more of speech, judge the first 1.5 s of
  a long final separately so a partner's long sentence cannot ride on a continuity window.
- First run (welcome.html): microphone, then "Loe need kuus lauset" enrolment, then one test
  command, done. Only-owner on by default after enrolment; the settings page keeps the off switch.
- Re-enrolment by voice: "õpi mu hääl uuesti".

Proof: calibrate output at most 5 % EER on the real clips; browser suite with the first run; the
two-voice fixture of LISTEN.

### Lane FAST (P5, P6): short commands near instant

- Haiku 5.5 for quick asks, Opus 5.5 for careful (`UTLE_MODEL`, `UTLE_MODEL_CAREFUL`); status reports
  both; eval on both models, cost per task printed.
- Act on the partial: when a partial already matches a rule and the VAD shows 300 ms of silence, run
  it and ignore the final if it matches the same rule. rule2 from 1.0 to 0.6 s in command mode; the
  dictation mode keeps 1.0 s.
- "keri N minutit/sekundit alla" is a slow scroll with a timer; "stopp" ends it.

Proof: latency table before/after from MEASURE 4; eval 78/78 or the diff named; the suite.

### Lane AMBIGUITY (P1): what he meant, on the page he is on

- New intent-eval cases typed from today's transcript: "ava email" with a login flow in front (keep
  the current tab, open beside it), "ava see uues vahelehes" (the thing just named, not another tab),
  "ava esimene kiri" in Gmail, "vajuta musta nuppu" / "ava link" on a link styled as a button, "mine
  tagasi sinna kus ma olin".
- `readPage` lists a link that looks like a button as a button with its text; the model gets the last
  three commands and their outcomes as `recent` and is told to prefer "open beside" when the current
  page is a form in progress.
- When two candidates score the same, the bar asks one question with two numbers, not "ei saanud aru".

Proof: the new cases pass on the quick model; a Gmail stand-in fixture with a verify-link button.

### Lane ENV (P9): the key

Delete or rename the Windows user variable `ANTHROPIC_API_KEY`, document `.env.local` as the one
place; `npm run dev` prints which key prefix it uses. Proof: a fresh terminal shows the usr key.

### Out of scope this week

Cloud ASR as the product's engine (decision in section 5), acoustic wake word, target-speaker
extraction, noise suppression beyond Chrome's constraints, speech impairments.

## 4. Orchestrator's own work, in order

1. Open the run, launch the monitor, dispatch MEASURE alone (needs Ralf and partners for 20 min).
2. With MEASURE's tables: dispatch LISTEN, VOICE, FAST, AMBIGUITY, ENV in worktrees, each with its
   own browser-suite port (round 9's lesson).
3. Review each lane with lane-review; merge; `npm run check`; the suite; Railway deploy; the store
   zip rebuilt.
4. A ten-minute walk-through by Ralf as a tester would do it, from install to a sent message, timed.

## 5. Only Ralf can do

- Record with the partners (20 minutes) and label the clips.
- Decide on cloud ASR: if MEASURE shows Scribe or Soniox at half our WER, the question is money
  ($0.12 to $0.39 per listening hour; seven testers at 2 h a day is $2 to $5 a day) and privacy (a
  care-home resident's speech to a US cloud; needs consent text and a data agreement). Default if no
  answer: stay local, improve what local does.
- Consent text for the Rapla testers before any recording.
- The Web Store developer account and the upload (round 9's packet is ready).

## 6. Exit test for the round

A person who has never seen Ütle, with the helper's sheet, in a room where two others talk:
install, enrol, say "Ütle, mine youtube'i ja otsi lastelaulud", get the result, dictate one message
and send it. Under ten minutes, and the bar never shows a sentence the others said.
