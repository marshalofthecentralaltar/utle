# Ütle: what the product is

For teammates, the pitch, branding, and anyone who has not read the code. Written 5 October 2026.
The technical design is `docs/ARCHITECTURE.md` (sections 21 onward describe what is built now;
sections 1 to 20 are history). The current state and known faults are in `HANDOFF.md`, which wins
wherever this page and it disagree.

## In one sentence

Ütle lets a person who cannot use their hands write, repair and send messages and move around the
web by speaking Estonian, inside the sites they already use.

"Ütle" is Estonian for "say". It is pronounced roughly "UET-leh".

## Who it is for

People who cannot type or use a mouse comfortably because of a motor disability, an injury or an
illness. Many of them already use an eye tracker to move a pointer by looking.

The product changed direction after the team talked to an eye-tracker user with a motor disability
on the first day of the hackathon. He said three things, and they are the brief:

1. Typing messages is slow.
2. He wants to move around the browser by voice.
3. Estonian, not English.

He also said eye tracking works badly with forms and PDFs.

More broadly: people in Estonia with a mobility disability that makes typing hard but leaves speech
usable. About 33,700 people have a registered mobility disability; how many of them fit is not known
(our guess: a few thousand).

## The problem

Voice tools today either take dictation or take commands, and they are built for English. No
mainstream hands-free tool works in Estonian: Windows Voice Access, Apple Voice Control and Dragon do
not support it, and Windows voice typing dictates Estonian but cannot control anything. Eye tracking
is language-independent but slow for text. Dictation makes mistakes, and fixing a mistake usually
needs the hands the person does not have. Writing one message to a friend can take minutes and a lot
of effort.

## What Ütle does

**Writes messages where the conversation already is.** He opens WhatsApp Web in Chrome and speaks.
The words appear in the site's own message box while he talks. He says "saada" (send) and the
message goes. There is no separate app to write in and nothing to copy across. Messenger is built
for too, but has never been tried on the real site.

**Repairs mistakes in a few words.** "Mitte kolm, vaid neli" (not three, four) fixes the wrong word.
"Kustuta viimane sõna" removes the last word. "Võta tagasi" undoes. None of this needs hands, and
none of it needs the internet.

**Moves around the browser.** "Järgmine vaheleht" (next tab), "keri alla" (scroll down), "ava
postimees" (open a site), "otsi ..." (search Google). "Näita numbreid" puts a small number on
everything clickable on the page, and saying a number clicks it. That last one makes any website
usable, including ones we have never seen.

**Opens a conversation by name.** "Kirjuta Marile" opens the chat with Mari. "Kirjuta Marile, et ma
jõuan homme kell kolm" opens it and writes the sentence, ready to send. Tested on stand-in pages;
on real WhatsApp only the chat list has been checked.

**Understands imperfect speech.** If it hears "mina whatsappi" instead of "mine whatsappi", it works
out what was meant and says what it took it to be. It never guesses on the things that cannot be
taken back: sending, resting, waking and undoing are only done when said exactly.

**Rests when asked.** "Puhka" makes it stop typing what it hears until "ärka üles" (wake up), so he
can talk to someone in the room.

**What changed on 5 October, evening and night.** After a day of real use the person it is for asked
for six things, and they were built in two rounds. It now understands what he means, not only fixed
phrases: what the rules do not recognise goes to a Claude model with what is on the page, and the
model may answer only with one of a fixed set of actions, checked before anything runs ("vajuta
Mari", "pane vaiksemaks", "mine youtube'i ja otsi kassivideod"). Nothing is typed where he did not
ask: words go only into a box he chose. He can edit inside the text as with a keyboard: move the
caret between words, sentences and lines, select, insert in the middle, delete letters, redo. For an
eye tracker there is push-to-talk by looking: it listens while the pointer rests on the microphone,
or on the whole bar, and delivers the words when the pointer leaves. Commands heard the Estonian way
("juutuba", "aga whatsapp", "saadake") are understood by sound. Scrolling can be a little, slow, and
stopped. The speech server can no longer fall minutes behind, and the bar says when it is behind at
all. And there are two speech backends: TalTech's model on the laptop, or Soniox in the cloud when a
key is set. None of this has been tried with his voice yet.

**What changed on 6 October, morning.** After the demo he asked for three more things. One breath
may now hold a chain: "mine whatsappi, siis ava Karini viimane sõnum, siis kustuta see kõigi jaoks"
is done goal by goal, with the bar showing "2/3 · …", and a pause before "siis" does not break it.
The server can learn his voice from eight seconds of speech and, with "Kuula ainult mind" on, skip
what other people in the room say. And the model now sees everything on the page he might refer
to, not only the clickable things: the messages of the open chat, headings, paragraphs; it can rest
the pointer on one so its hidden menu appears, open a right-click menu, and scroll to it. All of it
is proven on stand-in pages only.

**What changed on 6 October, afternoon.** After the demo with the person it is for, five more
things. Forms by voice: an ID code, a phone number, an e-mail address or a PIN said as words
("kolm üheksa null kaks", "ralf punkt sepp ät gmail punkt com") becomes digits and characters in a
one-line field, the bar reads the field back (a PIN as dots), "valmis" goes to the next field and
"kinnita" submits, so a Smart-ID login can be done by voice. A long sentence or a chain makes the
model read the whole thing and plan before it acts, while short commands stay as quick as before.
It can no longer get stuck: nothing waits more than 25 seconds, the bar counts the seconds while it
thinks, and "katkesta" stops everything at once. And "suurenda" / "vähenda" zoom the page, text and
layout together, kept per site. All of it is proven on stand-in pages only: a Smart-ID-like test
page, never the real one, and no real voice.

**The first version, a document editor,** survives only as a development page at localhost: say
"change the budget deadline to Friday", see the change marked in the text, say yes or no. Its edits
need an Anthropic API key, and the key on the build machine is rejected. It is not part of what the
user is given.

## How it feels to use

Three moves, borrowed from how two people work on a text when only one has the keyboard:

1. **Say it.** Speak naturally, in Estonian (English commands are understood too).
2. **See what was understood.** The words appear as he speaks. Nothing important happens out of
   sight.
3. **Repair it in a word.** A short correction, not a retype.

On screen there is almost nothing: one bar along the bottom of whatever page he is on, and of the
new-tab page. It holds a large microphone target, the words being heard, and one line saying what
was just done. The microphone target is big on purpose, so an eye tracker can switch listening on
and off by resting on it for a second. That is tested in automated tests, not yet with a real eye
tracker.

## How it works, in plain words

- A Chrome extension draws the bar, listens, and types into the page.
- Speech is recognised by TalTech's Estonian model (Tanel Alumäe's Laboratory of Language
  Technology, MIT licence) running on the same laptop, on its own thread so nothing else slows it.
  No audio leaves the machine, unless Soniox (a hosted recogniser) is chosen on the settings page
  with a key on the server; then it does, and the settings page says so.
- Fixed commands and repairs are understood by rules, with no AI model and no cost per use. What
  the rules do not recognise is understood by a Claude model, which sees the words and what is on
  the page (never the audio) and may answer only with one of a fixed set of actions, checked before
  anything runs. Nothing is typed into a field he did not choose.

## What makes it different

- **Estonian first.** Recognition and every line the bar shows are Estonian.
- **Speech stays on the computer.** The recognition model runs on the user's own laptop. No audio is
  sent anywhere. For a tool that hears everything a person says at their desk, this is the point,
  not a detail.
- **It works inside the sites people already use.** No new messenger to move friends to.
- **Mistakes are cheap.** A wrong word costs one short sentence to fix. Nothing is sent until he
  says so.
- **Designed for no hands at any step,** including turning the microphone on. Installing it still
  needs a helper.

## Principles the product will not break

- Nothing leaves the computer without the user asking: a message is sent only on "saada".
- The user always sees what was understood before it matters.
- An error never costs more than the sentence that caused it.
- What the user says and writes is never logged.

## What is proven and what is not

| Claim | Status on 6 October 2026, afternoon |
|---|---|
| Dictating and sending in real WhatsApp Web | Done with the first version by the developer and one team member, both with ordinary voices |
| Words typed while speaking, and the new-tab page | Done by recorded speech in automated tests in Chromium; not yet on real WhatsApp or in Google Chrome |
| Scrolling and switching tabs by voice | Done by recorded speech in automated tests |
| Understanding by meaning (the model) | 61 of 62 scripted utterances pass against stand-in pages with the real model, run by the person it is for with his key on the evening of 5 October; the one miss fixed since. Not tried on real sites by voice |
| Editing inside the text (caret, selection, insert, keys) | Done on a stand-in essay page (a plain editor and a textarea) in automated tests; not with a voice, not on WhatsApp, not on Google Docs itself |
| Push-to-talk by looking | The timing is unit tested with fake clocks; not tried with a real eye tracker or a real pointer |
| Sound-alike commands, slow scrolling, stop | Unit tests and automated browser tests on stand-in pages; the misheard forms come from his report, not from recordings |
| The speech server never falls behind | Tested with a fake slow decoder; the worker thread not run with the model on this machine |
| Soniox as a second recogniser | Built against Soniox's published client code; never connected, no key |
| Works with the voice of the person it is for | Not tried for anything built since the first version |
| Works with a real eye tracker | Not tried |
| Faster for him than typing | Not measured |
| Messenger | Built against a stand-in page, never tried on the real site |
| Chains of goals in one breath (6 October) | Stand-in pages only: the engine with fakes, the real model against fake pages in the eval; not with a voice |
| Only your own voice (6 October) | Stand-in pages only: a fake speaker model in the tests; the real model never run on an Estonian voice |
| Everything on the page: messages, hover, the menu (6 October) | Stand-in pages only: the WhatsApp stand-in deletes a message for everyone; the real site's selectors are guesses |
| Forms by voice: numbers as digits, e-mail, phone, PIN, "valmis", "kinnita" (6 October, afternoon) | Stand-in pages only: a Smart-ID-like test page in the browser suite and 99 unit cases for the conversion; not the real Smart-ID page, no bank form, no real voice |
| The model thinks longer on a long sentence, never gets stuck, "katkesta" (6 October, afternoon) | Stand-in pages only: the engine with fakes, the server with a scripted model; the latency of a careful ask on the real model is unmeasured |
| Zoom by voice (6 October, afternoon) | Stand-in pages only: the tab zoom stepped in the browser suite; not on a real site |

## What it is not, yet

It does not control anything outside web pages, does not work on Chrome's own pages (settings,
extensions, the Web Store), works only in Google Chrome on a computer, and needs a developer to
install it: a local speech server and an unpacked extension. It cannot go on the Chrome Web Store
while it needs that local server (see `docs/PUBLISHING.md`).

## Where it could go

- An installable program that works across the whole computer, not only the browser.
- More sites handled by name (email, online banking, e-services such as eesti.ee).
- Other small languages that the big voice tools serve badly.
- Use by anyone whose hands are busy or tired, not only people with a disability.

## Why this could last (the pitch's moat)

1. The interaction: built for people for whom every word is expensive, not for fast fluent speakers.
2. It acts inside the sites people already use instead of asking them to move to a new app.
3. What it learns about one person (names, phrases) makes it better for him each week. Not built yet.
4. Estonia is small and reachable: disability organisations, Töötukassa (which funds work-related
   aids, including software), and the TalTech lab are all within reach. Foreign vendors will not
   bother with Estonian procurement.
5. Estonian speech recognition is NOT ours. It is TalTech's and open to anyone. Do not pitch it as
   ours.

## Who pays

Probably not the user. Töötukassa provides work-related aids free of charge and the Social Insurance
Board reimburses most assistive devices at 90 percent. Price anchors: Voiceitt costs 600 dollars a
year; a Tobii eye tracker costs about 2,000 to 8,000 pounds.

## For branding

**Fixed, please keep:**

- The name Ütle and its meaning.
- Estonian comes first in every piece of copy; English second.
- Plain words and sentence case. The product speaks in short, calm sentences ("Saadetud.", "Sain
  aru: ..."). No exclamation marks, no jargon, no cheerfulness about disability.
- High contrast and large targets. Anything on screen must be readable by someone with low vision
  and hittable by an eye tracker.

**What exists now, as a starting point, not a decision:**

- A lowercase wordmark, "ütle", where the two dots of the ü are the listening light: red and solid
  when listening, hollow when not.
- The typeface Atkinson Hyperlegible Next, drawn for readers with low vision.
- In the old document editor: a warm ivory or near-black background, near-black or ivory text, thin
  lines instead of boxes, and colour only for meaning (red for removed text, blue for added, yellow
  for "which one").
- In the browser bar: an opaque dark strip with white and yellow text, so it reads the same on any
  website.

These two looks do not match each other yet. One visual identity that covers both is the most
useful thing branding can deliver.

**Open, yours to decide:** logo beyond the wordmark, colour palette, tagline, the tone of the pitch
deck, a name for the bar itself, how the product is shown in a ten-second demo.

**Words to use and avoid.** Say "people who cannot use their hands" or "a motor disability"; do not
name a medical condition. Avoid
"suffering from", "handicapped" and "normal users". The user is the one in control; Ütle does what
he says.

## Where to look

| What | Where |
|---|---|
| Screenshots of the product on test pages | `docs/proof/` |
| Every phrase the product understands, in both languages | `extension/README.md` ("What to say"); the rules in `docs/ARCHITECTURE.md`, sections 20.3, 21.1, 22, 23.4 and 25; a short table in `README.md` |
| Every line the product says | `src/core/strings.ts` |
| How to install and run it | `README.md` |
| What is not ours, and its licence | `THIRD-PARTY.md` |

## The event

NewWorkTech Inclusive Digital Innovation Hackathon, TalTech Mektory, Tallinn. Tuesday 6 October:
10:00 three-minute recap per team, teamwork until 12:30, pitch preparation 13:30, pitch to the jury
14:30.
