# Round 10, lane MEASURE: the measurement tools (issue #4)

Tooling only. Every table below comes from the **synthetic** set in `scripts/fixtures/`
(TartuNLP text-to-speech voices: "mari" plays the owner, six other voices and a pitch-shifted "mari"
play other people). No real recordings exist yet. Nothing here picks a speaker model or threshold, and
no number here may be cited as how Ütle does with people: that waits for the recordings described in
"How Ralf records" at the end. The scripts run unchanged on any folder of labelled 16 kHz wavs.

Labels for the fixtures: `scripts/fixtures/labels.tsv` (29 clips, references typed from the texts the
fixtures were made from: `scripts/speaker-set.ts` LINES and `scripts/asr-hotwords-eval.ts` SPOKEN).

Measured 2026-10-27 on Ralf's Windows machine, worktree `r10-measure`, dev server on port 5393.

## 1. Recording and labelling (M1)

| Script | What it does |
|---|---|
| `scripts/record.ts` | Prompts 43 phrases per person: first the 12 enrolment phrases of `src/core/enrolPhrases.ts` (kind `enrol`), then 10 commands, 10 dictations, 8 wake cases from #2, "saada", "jah", "üks" from #3), records each from the microphone as the extension takes it (echo cancellation, noise suppression, gain control, 16 kHz AudioContext) in a Chromium window served from 127.0.0.1, writes `<out>/<person>/<id>.wav` and appends `<out>/labels.tsv`. Refuses an `--out` inside the repository (exit 3). Without `--consent` it prints the consent text and stops; that text is a **DRAFT that Ralf must approve** (issue #9) before anyone is recorded. `--crosstalk` records the commands with kind `crosstalk`. |
| `scripts/label.ts --import` | Adds a folder's wavs to `<out>/labels.tsv`. An `UTLE_CAPTURE` folder is read through its `log.tsv`: the gate's speaker verdict is not copied (speaker stays blank unless `--speaker` names the one person recorded), and the recognised text goes to `heard.tsv` as a typing hint, never into `reference`. |
| `scripts/label.ts --edit` | Walks the clips with a blank speaker or reference; Enter keeps, text replaces, `p` plays the clip, `q` saves and stops. |

`labels.tsv` columns: `file, speaker, reference, addressee (ütle/not/blank), kind (enrol, command, dictation, wake, short, crosstalk, other), duration_s`.

Proof, SYNTHETIC (Chromium's fake microphone playing `et-jah-16k.wav`, out folder in the session scratchpad):

```
$ npx tsx scripts/record.ts --person fake --out <scratch>/rec --consent --set short --auto 2 --fake-mic scripts/fixtures/et-jah-16k.wav --headless
fake/short-saada.wav  1.77 s  "Saada."
fake/short-jah.wav  2.01 s  "Jah."
fake/short-yks.wav  2.02 s  "Üks."
3 clips written
$ npx tsx scripts/record.ts --person fake --out <scratch>/rec2 --consent --set enrol --auto 1 --fake-mic scripts/fixtures/et-jah-16k.wav --headless
12 clips written   (fake/enrol-01.wav ... kind enrol, reference "Ava uus leht ja ava seaded." ...)
$ npx tsx scripts/record.ts --person test --out scripts/out
refused: ...\scripts\out is inside the repository ... (exit 3)
$ npx tsx scripts/label.ts --import scripts/fixtures --out <scratch>/lab
6 clips added from ...\scripts\fixtures; 0 were there
$ npx tsx scripts/label.ts --import <scratch>/cap --out <scratch>/lab      (a one-line capture log saying "owner")
1 clips added ... (capture log: gate verdicts not copied)
   -> labels.tsv row: speaker blank, reference blank; heard.tsv: "jah"
```

Unit tests (`scripts/measure.test.ts`, run by `npm run check`): the refusal of a path inside the
repository (either slash, any case), the capture import leaving speaker and reference blank, the
labels round trip, the phrase list.

## 2. Speech recognition: WER, CER, latency, cost (M2), SYNTHETIC

`npx tsx scripts/wer.ts --labels scripts/fixtures/labels.tsv --engine taltech,soniox` (with `SONIOX_API_KEY`).

Normalisation, both sides (`normaliseEt`): NFC, Estonian lower case, apostrophes dropped inside a word
("youtube'i" = "youtubei"), every other punctuation mark and quote becomes a space, **digits spelled
one by one in Estonian** ("3" = "kolm", "5551234" = "viis viis viis üks kaks kolm neli"). A number said
as one word ("kaksteist") must be typed as that word in the reference. Totals are summed errors over
summed reference words. End-of-utterance latency: wall time from sending the 100 ms frame holding the
clip's last speech (-40 dBFS) to the engine's last final, streaming in real time; it includes each
engine's own endpoint silence rule.

**SYNTHETIC**, n = 29 clips, 126 reference words, 9 owner-voice and 20 other-voice clips:

| Engine | Clips | Ref words | Word errors | WER | CER | Median end-of-utterance | Cost per hour | Spent |
|---|---|---|---|---|---|---|---|---|
| TalTech (local) | 29 | 126 | 1 | 0.8 % | 0.2 % | 1856 ms | $0 (this machine) | $0 |
| Soniox stt-rt-v5 | 29 | 126 | 0 | 0.0 % | 0.0 % | 862 ms | $0.12 (soniox.com/pricing, real-time, read 2026-10-27) | $0.0041 (124.3 s streamed) |

TalTech's one miss: `owner-numbers-one-1` "Näita numbrid" for "Näita numbreid". Soniox wrote "kell 3"
for "kell kolm", which the digit rule counts as right. Text-to-speech is far cleaner than a person in a
room: these rates say the tool works, not how the engines hear people. ElevenLabs is a slot in
`ENGINES` (no key), not implemented.

## 3. Speaker gate: four models by length of speech (M3), SYNTHETIC

```
npx tsx scripts/speaker-calibrate.ts --labels scripts/fixtures/labels-enrol.tsv --owner-speaker mari --models all
npx tsx scripts/speaker-calibrate.ts --labels scripts/fixtures/labels.tsv       --owner-speaker mari --models all
```

Every clip is embedded as the gate embeds it (its 100 ms frames at or above SILENCE_RMS). **The bucket
is the trial clip's seconds of speech** (those same frames), not its length: the fixture "jah" is a
1.15 s clip with 0.3 s of speech. Both lengths are in the per-clip JSON (`seconds`, `speechSeconds`).
Columns (cells: rate [Wilson 95 % interval]; the 0.7 to 1 s bucket is empty in both runs, in the JSON):
- **EER, EER t**: the equal error rate and the threshold where FAR and FRR cross (closest pair).
- **FAR / FRR @0.54**: at `OWNER_THRESHOLD`, set on TitaNet's scale; on the other three models for
  comparison only.
- **t @FAR<=1 %, FAR there, FRR there, Verified**: issue #3's operating point (`--far-target`, default
  0.01). Verified "yes" is the lowest threshold where the Wilson upper bound of FAR is at most the
  target. When no threshold can show that, the lowest threshold whose measured FAR is at most the
  target, marked "not verifiable at n=<other trials>": showing FAR <= 1 % needs at least **381 other
  trials, all rejected**. Neither column depends on how many owner trials there are; the earlier
  "best t" (fewest errors in all) did, and is gone.

Two ways to make trials (`splitTrials`, printed as `method:`):
- **enrol** (the product's way, used whenever the owner has clips of kind `enrol`): his profile is the
  mean of his enrol clips only, and every other clip is a held-out trial: his non-enrol clips and every
  clip of other people, their enrol clips included. `record.ts` now records the 12 enrolment phrases
  of `src/core/enrolPhrases.ts` first, as kind `enrol`, so Ralf's recordings use this.
- **leave-one-out** (fallback, no enrol clips; the round 7 method): an owner clip against the mean of
  the other owner clips, an other clip against the mean of all owner clips.

### 3a. Enrol method, SYNTHETIC (`scripts/fixtures/labels-enrol.tsv`)

The speaker set has no enrolment phrases, so `labels-enrol.tsv` (same clips as `labels.tsv`) marks as
`enrol` the owner's four longest utterances (`owner-dictate-send-1`, `owner-sentence-2`,
`owner-numbers-one-1`, `owner-scroll-tab-2`) and each other voice's long sentence (`other-*-3`, which
still count as other trials). Held out: 5 owner trials ("saada", "jah", "üks", "keri alla", "Tere!",
0.3 to 0.7 s of speech) and 20 other trials.

| Model | Bucket (speech) | n own | n oth | EER | EER t | FAR @0.54 | FRR @0.54 | t @FAR<=1 % | FAR there | FRR there | Verified |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TitaNet-small | all | 5 | 20 | 57.5 % | 0.207 | 0.0 % [0-16] | 60.0 % [23-88] | 0.552 | 0.0 % [0-16] | 60.0 % [23-88] | not verifiable at n=20 |
| TitaNet-small | <=0.7 s | 5 | 6 | 36.7 % | 0.184 | 0.0 % [0-39] | 60.0 % [23-88] | 0.552 | 0.0 % [0-39] | 60.0 % [23-88] | not verifiable at n=6 |
| TitaNet-small | 1-2 s | 0 | 7 | - | - | 0.0 % [0-35] | - | 0.464 | 0.0 % [0-35] | - | not verifiable at n=7 |
| TitaNet-small | >2 s | 0 | 7 | - | - | 0.0 % [0-35] | - | 0.442 | 0.0 % [0-35] | - | not verifiable at n=7 |
| CAM++ en | all | 5 | 20 | 40.0 % | 0.624 | 60.0 % [39-78] | 0.0 % [0-43] | 0.763 | 0.0 % [0-16] | 100.0 % [57-100] | not verifiable at n=20 |
| CAM++ en | <=0.7 s | 5 | 6 | 36.7 % | 0.624 | 66.7 % [30-90] | 0.0 % [0-43] | 0.632 | 0.0 % [0-39] | 40.0 % [12-77] | not verifiable at n=6 |
| CAM++ en | 1-2 s | 0 | 7 | - | - | 57.1 % [25-84] | - | 0.763 | 0.0 % [0-35] | - | not verifiable at n=7 |
| CAM++ en | >2 s | 0 | 7 | - | - | 57.1 % [25-84] | - | 0.688 | 0.0 % [0-35] | - | not verifiable at n=7 |
| ERes2Net en | all | 5 | 20 | 40.0 % | 0.319 | 0.0 % [0-16] | 80.0 % [38-96] | 0.442 | 0.0 % [0-16] | 60.0 % [23-88] | not verifiable at n=20 |
| ERes2Net en | <=0.7 s | 5 | 6 | 36.7 % | 0.319 | 0.0 % [0-39] | 80.0 % [38-96] | 0.442 | 0.0 % [0-39] | 60.0 % [23-88] | not verifiable at n=6 |
| ERes2Net en | 1-2 s | 0 | 7 | - | - | 0.0 % [0-35] | - | 0.379 | 0.0 % [0-35] | - | not verifiable at n=7 |
| ERes2Net en | >2 s | 0 | 7 | - | - | 0.0 % [0-35] | - | 0.422 | 0.0 % [0-35] | - | not verifiable at n=7 |
| ResNet34 en | all | 5 | 20 | 40.0 % | 0.614 | 65.0 % [43-82] | 20.0 % [4-62] | 0.808 | 0.0 % [0-16] | 60.0 % [23-88] | not verifiable at n=20 |
| ResNet34 en | <=0.7 s | 5 | 6 | 36.7 % | 0.642 | 50.0 % [19-81] | 20.0 % [4-62] | 0.808 | 0.0 % [0-39] | 60.0 % [23-88] | not verifiable at n=6 |
| ResNet34 en | 1-2 s | 0 | 7 | - | - | 71.4 % [36-92] | - | 0.757 | 0.0 % [0-35] | - | not verifiable at n=7 |
| ResNet34 en | >2 s | 0 | 7 | - | - | 71.4 % [36-92] | - | 0.750 | 0.0 % [0-35] | - | not verifiable at n=7 |

Every held-out owner trial in this stand-in set is short, so the 1-2 s and >2 s rows have no owner
trials and no EER; only FAR can be read there. That is a limit of the set, not of the method: Ralf's
recordings hold out commands and dictations of every length.

### 3b. Leave-one-out fallback, SYNTHETIC (`scripts/fixtures/labels.tsv`, no enrol clips)

| Model | Bucket (speech) | n own | n oth | EER | EER t | FAR @0.54 | FRR @0.54 | t @FAR<=1 % | FAR there | FRR there | Verified |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TitaNet-small | all | 9 | 20 | 34.2 % | 0.365 | 0.0 % [0-16] | 33.3 % [12-65] | 0.577 | 0.0 % [0-16] | 33.3 % [12-65] | not verifiable at n=20 |
| TitaNet-small | <=0.7 s | 5 | 6 | 36.7 % | 0.271 | 0.0 % [0-39] | 60.0 % [23-88] | 0.577 | 0.0 % [0-39] | 60.0 % [23-88] | not verifiable at n=6 |
| TitaNet-small | 1-2 s | 2 | 7 | 0.0 % | 0.647 | 0.0 % [0-35] | 0.0 % [0-66] | 0.647 | 0.0 % [0-35] | 0.0 % [0-66] | not verifiable at n=7 |
| TitaNet-small | >2 s | 1 | 7 | 0.0 % | 0.691 | 0.0 % [0-35] | 0.0 % [0-79] | 0.691 | 0.0 % [0-35] | 0.0 % [0-79] | not verifiable at n=7 |
| CAM++ en | all | 9 | 20 | 34.2 % | 0.714 | 55.0 % [34-74] | 11.1 % [2-44] | 0.879 | 0.0 % [0-16] | 77.8 % [45-94] | not verifiable at n=20 |
| CAM++ en | <=0.7 s | 5 | 6 | 45.0 % | 0.807 | 100.0 % [61-100] | 0.0 % [0-43] | 0.879 | 0.0 % [0-39] | 60.0 % [23-88] | not verifiable at n=6 |
| CAM++ en | 1-2 s | 2 | 7 | 53.6 % | 0.484 | 28.6 % [8-64] | 50.0 % [9-91] | 0.787 | 0.0 % [0-35] | 100.0 % [34-100] | not verifiable at n=7 |
| CAM++ en | >2 s | 1 | 7 | 21.4 % | 0.578 | 42.9 % [16-75] | 0.0 % [0-79] | 0.626 | 0.0 % [0-35] | 100.0 % [21-100] | not verifiable at n=7 |
| ERes2Net en | all | 9 | 20 | 34.2 % | 0.379 | 0.0 % [0-16] | 44.4 % [19-73] | 0.618 | 0.0 % [0-16] | 44.4 % [19-73] | not verifiable at n=20 |
| ERes2Net en | <=0.7 s | 5 | 6 | 36.7 % | 0.327 | 0.0 % [0-39] | 80.0 % [38-96] | 0.431 | 0.0 % [0-39] | 60.0 % [23-88] | not verifiable at n=6 |
| ERes2Net en | 1-2 s | 2 | 7 | 0.0 % | 0.718 | 0.0 % [0-35] | 0.0 % [0-66] | 0.718 | 0.0 % [0-35] | 0.0 % [0-66] | not verifiable at n=7 |
| ERes2Net en | >2 s | 1 | 7 | 0.0 % | 0.829 | 0.0 % [0-35] | 0.0 % [0-79] | 0.829 | 0.0 % [0-35] | 0.0 % [0-79] | not verifiable at n=7 |
| ResNet34 en | all | 9 | 20 | 34.2 % | 0.754 | 80.0 % [58-92] | 11.1 % [2-44] | 0.815 | 0.0 % [0-16] | 44.4 % [19-73] | not verifiable at n=20 |
| ResNet34 en | <=0.7 s | 5 | 6 | 36.7 % | 0.747 | 83.3 % [44-97] | 20.0 % [4-62] | 0.815 | 0.0 % [0-39] | 60.0 % [23-88] | not verifiable at n=6 |
| ResNet34 en | 1-2 s | 2 | 7 | 0.0 % | 0.839 | 85.7 % [49-97] | 0.0 % [0-66] | 0.839 | 0.0 % [0-35] | 0.0 % [0-66] | not verifiable at n=7 |
| ResNet34 en | >2 s | 1 | 7 | 0.0 % | 0.843 | 71.4 % [36-92] | 0.0 % [0-79] | 0.843 | 0.0 % [0-35] | 0.0 % [0-79] | not verifiable at n=7 |

The equal 34.2 % "all" EER of all four models is the coarseness of the set, not agreement: with 9
owner trials FRR moves in steps of 11 points and with 20 other trials FAR in steps of 5, and on every
model the FAR/FRR crossing falls at 7 of 20 against 3 of 9. With trials this few the intervals are 30
to 60 points wide: neither set can rank the models.

Default behaviour unchanged: `npx tsx scripts/speaker-calibrate.ts scripts/fixtures/speaker-set`
rewrote `scores.json` with every field equal to the committed file except the per-clip `ms` timings
and the `stored` block (the committed file was made with `--profile`, the rerun without it); the
committed file was restored.

Models: `npx tsx scripts/speaker-models.ts` adds the two missing ones to `models/speaker/` (sizes
checked against GitHub's listing):

| Model | File | Bytes | Source |
|---|---|---|---|
| ERes2Net en voxceleb | `3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx` | 26 485 263 | github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/ |
| ResNet34 en voxceleb | `wespeaker_en_voxceleb_resnet34.onnx` | 26 534 365 | same release |

## 4. Command latency by stage (M4), SYNTHETIC

`npx vite --port 5393 --strictPort` (with `ANTHROPIC_API_KEY`), then
`UTLE_PORT=5393 npx tsx scripts/latency.ts --labels scripts/fixtures/labels.tsv` (kinds command and short).

What each stage is measured from: (1) the wall time the frame holding the clip's last speech is sent
to `/api/asr` (streamed in real time as the extension streams) to the clip's last final; includes the
recogniser's endpoint silence. (2) handing the final to the real `inpageStep` to having the page
commands; for words the rules give to the model, also `readPage`, `POST /api/intent` (Sonnet 5.5),
`pageIntentFrom` and `applyIntent`. (3) the extension's own page script (`extension/dist/page.js`)
running those commands in headless Chromium on `chat.html` (3000 px more in its message list so it
scrolls, "Tere" already in the composer so "saada" sends; set up before the clock). Not measured: the
engine's holds between stages (final assembler, quick-reply hold), a hosted server's network, the
service worker hop. "Järgmine vaheleht" (switchTab) runs in the service worker and has no stage 3.

**SYNTHETIC**, 18 clips (7 "saada", 7 "keri (natuke) alla", "näita numbreid", "järgmine vaheleht", "jah", "üks"):

| Stage | n | p50 | p95 |
|---|---|---|---|
| speech end -> final | 18 | 1780 ms | 2139 ms |
| final -> intent, rules | 16 | 5 ms | 27 ms |
| final -> intent, model | 2 | 2296 ms | 2457 ms |
| intent -> action, in the page | 17 | 166 ms | 425 ms |

"jah" and "üks" on a chat page went to the model and came back as dictation (setText); with n = 2 the
model row's p95 is the larger of two values.

## How Ralf records

Consent first. The consent text in `record.ts` is a **DRAFT**: Ralf approves the wording (issue #9)
before any recording. Then, before anyone is recorded, read them the text `record.ts` prints without `--consent`
(what is recorded, that it stays on this computer, what it is for, that it is deleted after, that they
can stop). Record only after a yes.

1. Folders, outside the repository: `C:\temp\utle-voice` (the scripts refuse a folder inside it).
2. Each person alone, about 8 minutes each (the 12 enrolment phrases come first: they make the
   owner's profile in the speaker table, as the product's enrolment does), in a normal room with the microphone you use for Ütle:
   ```
   npx tsx scripts/record.ts --person ralf --out C:/temp/utle-voice --consent
   npx tsx scripts/record.ts --person partner1 --out C:/temp/utle-voice --consent
   npx tsx scripts/record.ts --person partner2 --out C:/temp/utle-voice --consent
   ```
   A Chromium window shows each phrase: Space starts, Space stops, Backspace redoes the last, Escape ends.
3. All three talking at once while Ralf reads the commands:
   `npx tsx scripts/record.ts --person ralf --crosstalk --out C:/temp/utle-voice --consent`
4. Optional, real use: run the dev server with `UTLE_CAPTURE=C:\temp\utle-voice\capture-<person>`, use
   Ütle, then `npx tsx scripts/label.ts --import C:/temp/utle-voice/capture-<person> --out C:/temp/utle-voice --speaker <person>`
   (only when that folder is one person; otherwise leave `--speaker` off and type it per clip).
5. Check and correct: `npx tsx scripts/label.ts --edit C:/temp/utle-voice/labels.tsv --all`. The
   reference is what was actually said, numbers as said ("kaksteist", not "12").
6. The four tables:
   ```
   node --env-file=.env.local --import tsx scripts/wer.ts --labels C:/temp/utle-voice/labels.tsv --engine taltech,soniox
   npx tsx scripts/speaker-calibrate.ts --labels C:/temp/utle-voice/labels.tsv --owner-speaker ralf --models all
   npx vite --port 5393 --strictPort        (another shell, ANTHROPIC_API_KEY set)
   UTLE_PORT=5393 npx tsx scripts/latency.ts --labels C:/temp/utle-voice/labels.tsv
   ```
   Each writes its JSON next to `labels.tsv` (wer.json, speaker-sweep.json, latency.json). Copy only the
   counts and rates into the proof file; the JSON files hold what people said and stay in the folder.
7. When the tables are written down: delete `C:\temp\utle-voice` entirely (recordings, labels, JSON,
   capture folders). Soniox spend for the whole set is about $0.01 (about 8 minutes of audio per
   person at $0.12 per hour).
