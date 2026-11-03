# Round 11: what Ralf's own demo found (2026-11-03, 15:20 to 15:29)

Sources, all on this machine: the screen recording (7.5 min, starts 15:20:18, 24 frames read), the dev
server's log (timings, causes, verdicts, no words), and the capture folder `C:\temp\utle-demo` (76
utterances as wav plus `log.tsv` with the words, the verdict and the score). Build: main 64d718e,
Sonnet 5.5 for every ask, only-my-voice on, TalTech recogniser. The machine was loaded: the peer
session's suites ran during the first 50 s (10 s of audio dropped), Ralf's Chrome and the screen
recorder the whole time (CPU 70 to 77 %). The capture holds Ralf's voice and a friend's e-mail
address; it stays out of git and is deleted when round 11 is done.

## Timeline (local time, what he said, what happened, seconds to the result)

| Time | He said | What happened | Finding |
|---|---|---|---|
| 15:20:37 to 15:23:02 | "ütle", "õpeta mu hääl", "ava uus leht ja ava seaded", "ma võin ükskõik mida öelda" | Nothing runs for 2.5 min: only-my-voice on, no profile (19 finals `profile_missing`). The bar says "Häält ei õnnestunud kinnitada" and "Kui see olid sina, õpeta hääl uuesti seadetes". | F1 |
| 15:21:42, 15:22:57 | "hääle õppimine ei õnnestunud", "kogu aeg ütleb, et lause liiga lühike" | Enrolment phrase 6 of 12 asked again and again: "Lause jäi liiga lühikeseks". The enrolment connection received 44 s and dropped 10 s (load). | F2 |
| 15:23:02 | (12 phrases read) | "Hääl on õpitud 10 lausest ja kontrollitud 2 uuel lausel." First verified utterance, 0.85. | works |
| 15:23:34 to 15:23:54 | "uus vaheleht", "Youtube", "Töötukassa", "mobiil-ID-ga sisselogimine" | New tab (rule), YouTube, Töötukassa opened via the model ("Sain aru: Avan Töötukassa"). "Youtube" once at 0.541, once rejected at 0.365: the same word, the same voice. | F3 |
| 15:24:04 to 15:24:33 | "mine tagasi eelmisele lehele" twice, "ei, ma mõtlen sinna, kus ma olin enne töötukassat" twice | Four utterances and about 30 s for one "back": each went addressee check (1.7 to 2.4 s) plus intent (2.0 to 3.6 s). The result, "Tagasi: YouTube", was right. | F4 |
| 15:25:06 to 15:25:30 | (a YouTube video talks in the background) then "mine töötukassasse" three times | The video's speech rejected, 0.13 to 0.42, correct. His own "mine töötukassasse" rejected at 0.35, 0.52, 0.54; accepted at 0.557 on the fourth try. | F3 |
| 15:25:43 to 15:25:57 | "ma tahan mobiil-ID-ga sisse logida, logi mobiil-ID-ga sisse" three times | Töötukassa login, then the Mobiil-ID form on tara.ee with ID code and phone fields. Three utterances, about 20 s. | works, slow |
| 15:26:04 to 15:26:14 | "mine uuele vahelehele" four times | Rejected at 0.44, 0.52, 0.37 with the video still on; accepted at 0.714. Then addressee plus a `place` intent: a core command went to the model. | F3, F4 |
| 15:26:24 to 15:26:41 | "ma tahan kirjutada enda sõbrale e-maili", "kirjuta meil Nadim punkt ... gmail punkt com" | Gmail opened, compose opened (a careful plan, "1/2 avan e-posti", 9 s). The address typed into To and read back: "natim.metavallijad@gmail.com" (the recogniser heard "Natim"). | F5 |
| 15:27:06 to 15:27:43 | "Nadim on nõrga t-ga ja ...", "ei, kustuta see terve e-mail ära, sa kirjutasid valesti" | His corrections appended garbage to the address ("...gmail.comkuuleseenädimnõrgat-ga"); two of his sentences were judged "not for me" and dropped ("2 lauset ei olnud mulle"); the delete never ran. He gave up and went to settings. | F5, F6 |
| 15:28:42 to 15:29:13 | (in English, to himself) "I'm going to go to settings and activate ... Soniox" | Five of six rejected (0.29 to 0.52) at a quiet 0.03 RMS; the addressee check said ignore for the rest. | F3 |

Model time per ask, from the log: addressee check p50 1.8 s (1.2 to 4.9); quick intent p50 2.3 s (1.7
to 2.8); careful intent 2.0 to 4.7 s. A sentence no rule knows costs 4 to 6 s before anything moves.

## Findings, ranked by what a tester meets first

**F1. Only-my-voice without a profile shows the wrong words and locks him out silently.** Class
product. For 2.5 minutes every utterance was `profile_missing` and the bar said "voice could not be
confirmed" and "if that was you, teach your voice again", lines written for a rejected voice. The
right line is "teach your voice first" with the button, and the first run should not leave only-my-voice
on with no profile. Owner: the strip's lines (`extension/src/offscreenMain.ts` reason to line) and the
welcome order. Proof: an engine test for `profile_missing` naming the line; the welcome in `run.ts`.

**F2. Enrolment phrases are cut by the server's backlog and come back "too short".** Class product.
The enrolment connection dropped 10 s of 44 s under load; a cut phrase has under 0.8 s of speech and
is asked again with no hint why. Phrase 6 took many tries. A care-home laptop is this loaded. Owner:
the server's drop should never land inside an enrolment phrase (hold the phrase, or tell the client
"the computer is slow, wait"), and the welcome should say what happened. Proof: `asrSession.test.ts`
with a slow fake decoder during enrolment; the dropped seconds on the enrolment connection stay 0.

**F3. His own voice is rejected about one time in four, and short words score low.** Class product,
the biggest. Real numbers from this session, labelled by the words: 48 of his utterances judged, 36
verified (0.54 to 0.85, median 0.68), 12 rejected (0.35 to 0.54); the YouTube video's 9 utterances
all rejected (0.13 to 0.46). The threshold 0.54 was picked on synthetic voices; a line at 0.50 would
have passed 3 more of his and still every video clip, but his 0.35 to 0.44 overlap the video's 0.37 to
0.46, so no threshold alone fixes it. One-word commands ("Youtube" 0.54 and 0.37) and quiet speech
(0.03 RMS, far from the mic) score lowest. The capture is the first real labelled set: run the model
sweep on it before any threshold change. Proof: `speaker-calibrate.ts --labels` on
`C:\temp\utle-demo-labels` (four models, EER per speech-length bucket), then the threshold policy.

**F4. Core commands in his own words go to the model and cost 4 to 6 s.** Class product. "mine
tagasi eelmisele lehele" and "mine uuele vahelehele" are not rules, so each paid an addressee check
plus an intent ask; "back" took four utterances and 30 s. Owner: the rules in `src/core/inpage.ts`
and the phonetic keys; measure first by replaying the 48 verified utterances of this session through
`inpageStep` and counting which went to the model. Proof: that replay as a test fixture, before and
after.

**F5. A name in an e-mail address cannot be corrected by voice.** Class product gap. The recogniser
wrote "Natim"; his correction "Nadim nõrga t-ga" has no path and was appended to the field. The
read-back offers only "edasi" or "valmis". The cheapest working path for a tester: saved contacts in
"Minu andmed" (name plus address, "kirjuta Nadimile") and, in the read-back, "vale" to clear and spell
letter by letter. Proof: a `saved.test.ts` case for a contact, an eval case on the Gmail stand-in.

**F6. The addressee check dropped his corrections as room talk.** Class product. "ei, kustuta see
terve e-mail ära, sa kirjutasid valesti" was judged "not for me" twice while a field was armed and the
bar had just read a value back. Owner: the addressee prompt should treat a sentence right after a
read-back as addressed. Proof: two eval cases from these exact sentences.

**Environment, not product:** the 10 s of drops in the first 50 s and the server running up to 11 s
behind real time while the suites ran; the hiss counter in the log is cumulative (12.4 s over 136 s
of audio, 9 %), by design.

## What worked

New tab, YouTube, Töötukassa by name, "back" to the right page, the Töötukassa login and the Mobiil-ID
form in three steps, Gmail open and compose, the e-mail read-back, the room's voice kept out of the
page every time, "keegi teine rääkis" shown when it was. Enrolment finished once the load was gone.

## Lanes proposed (three, after the QUICK/EXIT run closes; each Opus 5.5; proofs named above)

| Lane | Findings | Files | Starts after |
|---|---|---|---|
| VOICE2 | F3 (sweep on the real set, threshold policy, short words), F2 (no drop inside a phrase) | `server/speaker.ts`, `server/asrSession.ts`, `scripts/speaker-calibrate.ts` | the sweep's numbers |
| WORDS | F4 (rules for his phrasings, replay of this session), F6 (addressee after a read-back) | `src/core/inpage.ts`, `src/core/phonetic.ts`, `server/addressee.ts`, eval cases | now |
| FIRSTRUN | F1 (profile-missing lines, welcome order), F5 (contacts in Minu andmed, "vale" in the read-back) | `extension/src/offscreenMain.ts`, `welcome.ts`, `src/core/saved.ts`, `options.ts` | now |

## Dispositions

| Item | Class | Status | Evidence |
|---|---|---|---|
| F1 profile-missing shows the rejected-voice lines | defect | marked-unresolved (lane FIRSTRUN) | frames 15:21:33 and 15:22:28 of the recording; server log 19 × `profile_missing`; `offscreenMain.ts` line 149 to 151 maps every reason but `insufficient_audio` and `model_unavailable` to `foreign` |
| F2 enrolment phrases cut by the backlog | defect | marked-unresolved (lane VOICE2) | server log "44 s received, 10 s dropped" on the enrolment connection; frame 15:22:28 "Lause jäi liiga lühikeseks" at 6 / 12; `MIN_PHRASE_SECONDS` 0.8 in `server/speaker.ts` |
| F3 one in four of his utterances rejected | defect | marked-unresolved (lane VOICE2, sweep first) | `C:\temp\utle-demo\log.tsv` scores labelled by words: 36 verified, 12 rejected, 9 video clips rejected; `OWNER_THRESHOLD` 0.54 "picked on synthetic voices" (`server/speaker.ts`) |
| F4 core commands in his words go to the model | defect | marked-unresolved (lane WORDS) | server log: `[addressee]` + `[intent]` pairs at 15:24:04 to 15:24:33 and 15:26:14 (`kind=place`); frame 15:24:11 "Mõtlen" |
| F5 a name in an address cannot be corrected | missing | marked-unresolved (lane FIRSTRUN) | frames 15:26:50 and 15:27:38: "natim.metavallijad@gmail.com" then "...comkuuleseenädimnõrgat-ga"; `src/core/saved.ts` kinds are email, tel, code only |
| F6 corrections judged "not for me" | defect | marked-unresolved (lane WORDS) | frame 15:27:45 "2 lauset ei olnud mulle"; server log `[addressee] verdict=ignore` at 15:27:07 and 15:27:18 |
| Drops and lag in the first 50 s | unverified | marked-unresolved as environment (the peer's suites plus Chrome at 77 % CPU) | server log finals 1 to 9: wall minus audio up to 11.5 s, dropped 1.3 to 2.6 s; a re-run on an idle machine decides whether a product bound is also needed |
| Threshold change now | method-choice | choice-for-ralf after the sweep, not before | the overlap 0.35 to 0.46 between his rejected clips and the video's makes any single line a trade; the sweep gives the numbers |

Not in this round: Soniox as the recogniser (he switched to it at the end; untested here), the
Mobiil-ID form filled end to end (needs his real code and phone).
