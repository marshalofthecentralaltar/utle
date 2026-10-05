# Ütle: what the product is

Written 2026-10-05, after the first use on real WhatsApp. This is the page for teammates, the
pitch and anyone who has not read the code. The technical design is `docs/ARCHITECTURE.md`
(sections 21 onward describe what is built now; sections 1 to 20 are history).

## One sentence

Ütle lets a person who cannot use their hands write, repair and send messages and move around
the web by speaking Estonian, inside the sites they already use.

## Who it is for

A man with a motor disability the team spoke to on 5 October 2026. He speaks clear Estonian, types
very slowly, and points with a Tobii eye tracker. In his words: writing messages is the pain, he
wants to move around the computer by voice, and eye tracking works badly with forms and PDFs.

More broadly: people in Estonia with a mobility disability that makes typing hard but leaves
speech usable. About 33,700 people have a registered mobility disability; how many of them fit is
not known (our guess: a few thousand).

## The problem

No mainstream hands-free tool works in Estonian. Windows Voice Access, Apple Voice Control and
Dragon do not support it; Windows voice typing dictates Estonian but cannot control anything.
Eye tracking is language-independent but slow for text.

## What he does with it

1. Opens WhatsApp Web in Chrome. A black bar sits at the bottom of the page with one large button.
2. Looks at the button for a second. It turns green: Ütle is listening.
3. Speaks. The bar shows what is heard. His words appear in WhatsApp's own message box.
4. Repairs by voice: "mitte kolm, vaid neli", "kustuta viimane sõna", "võta tagasi".
5. Says "saada". WhatsApp sends it.
6. Says "keri alla", "järgmine vaheleht", "ava gmail", "näita numbreid" and a number to click
   anything. Says "puhka" to stop it typing what it hears, "ärka üles" to resume.

Nothing opens in a separate window. He stays where he is.

## How it works, in plain words

- A Chrome extension draws the bar, listens, and types into the page.
- Speech is recognised by TalTech's Estonian model (Tanel Alumäe's lab, MIT licence) running on
  the same laptop. No audio leaves the machine.
- Commands and repairs are understood by rules, with no AI model and no cost per use. A Claude
  model for freer corrections is planned and not connected.

## What is proven and what is not

| Claim | Status on 5 October |
|---|---|
| Dictating and sending in real WhatsApp Web | Done once by a team member with a normal voice |
| Scrolling and switching tabs by voice | Done by recorded voice in automated tests |
| Works with his voice | Not tried |
| Works with a real Tobii | Not tried |
| Faster for him than typing | Not measured |
| Messenger | Built against a stand-in page, never tried on the real site |

## What it is not, yet

It does not control anything outside web pages, does not work on Chrome's own settings pages, and
needs a developer to install it (a local server and an unpacked extension).

## Why this could last (the pitch's moat)

1. The interaction: built for people for whom every word is expensive, not for fast fluent speakers.
2. It acts inside the sites people already use instead of asking them to move to a new app.
3. What it learns about one person (names, phrases) makes it better for him each week. Not built yet.
4. Estonia is small and reachable: disability organisations, Töötukassa (which funds work-related
   aids, including software), and the TalTech lab are all within reach. Foreign vendors will not
   bother with Estonian procurement.
5. Estonian speech recognition is NOT ours. It is TalTech's and open to anyone. Do not pitch it as ours.

## Who pays

Probably not the user. Töötukassa provides work-related aids free of charge and the Social
Insurance Board reimburses most assistive devices at 90 percent. Price anchors: Voiceitt costs
600 dollars a year; a Tobii eye tracker costs about 2,000 to 8,000 pounds.

## The event

NewWorkTech Inclusive Digital Innovation Hackathon, TalTech Mektory. Tuesday 6 October: 10:00
three-minute recap per team, teamwork until 12:30, pitch preparation 13:30, pitch to the jury 14:30.
