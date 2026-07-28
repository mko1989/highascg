# WO-371 — "In PRV the playlist stops after the first item": the owner ticked the design and then reported it as a bug

**Status: OPEN — BLOCKED ON AN OWNER DECISION. Written 28.07.26; the conflict is between two of the owner's own sign-offs, so no implementation is correct until it is resolved.**

## 1. The conflict

Both notes are in `work/checklist27.07.26_manual_verify.md`, saved in the same 28.07 14:26 pass.

**Item 27 — ticked ✅, no complaint** (WO-355, "Playlists are PGM-only + stop on take-out"):

> Recall a playlist look to preview: **it shows one item and sits still.** Take a different look
> to PGM: the old look's playlist stops hopping immediately.

**Item 23 — unticked ❌, reported as a failure** (WO-354, "Playlist edit → preview"):

> Edit a playlist, take the look to PGM (new list plays), recall it to preview — preview must play
> the NEW list too.
> > no, i prv the playlist stops after first item.

"Shows one item and sits still" and "stops after first item" are **the same behaviour**. It was
signed off as correct in item 27 and reported as broken in item 23.

## 2. Investigation — how it got here

The two items come from opposite directions and both were implemented as asked:

- **WO-354** (`00bdf04`) fixed a real bug: playlist timers were *shared* between PGM and PRV, so
  recalling an edited look to preview replayed the **old** list. The acceptance criterion written
  at the time was "preview must play the NEW list too" — i.e. preview was assumed to play.
- **WO-355** (`4517e02`) then made playlists **PGM-only by design**, from the owner's todos27 line:
  *"the playlist workflow of shaders now uses preview channel. why? everything can be done inside
  the pgm channel only."* That deliberately stopped preview from advancing.

WO-355 landed after WO-354 and silently invalidated item 23's acceptance criterion. Item 23 was
never rewritten, so the owner tested it against the older wording and correctly found it unmet.

So: **no code is broken.** The checklist is. But the underlying question WO-354 was solving is
still real and is *not* answered by WO-355:

> **After editing a playlist, how does the operator confirm the new list is right — without
> putting it on air?**

Today the answer is "you can't": preview shows item 1 frozen, so an edit can only be verified by
taking it to PGM. That is a genuine operational gap on a live playout box, and it is presumably
why the owner flagged item 23 rather than ticking it.

## 3. The decision (owner)

Three coherent answers. They are mutually exclusive.

**A. PRV stays frozen — fix the checklist, not the code.**
Item 23 is reworded to match WO-355 ("recall to preview shows the FIRST item of the NEW list, and
sits still") and the verification becomes: is the item shown the *new* list's first item, or a
stale one? That still tests what WO-354 actually fixed (the shared-timer bug) without contradicting
WO-355. Zero code. Weakness: a mid-list edit still cannot be previewed.

**B. Preview advances, but only while the look is NOT on air.**
PRV runs its own playlist timer when the look is in preview and no take is in flight; it stops the
moment the look goes to PGM (WO-355's "stop on take-out" stays). Gives real edit confirmation.
Cost: reintroduces a second timer on the preview channel — the exact thing whose *sharing* caused
WO-354's bug. It must be a genuinely separate, channel-scoped timer (WO-354 already made playlist
state channel-scoped, so the foundation exists), and it puts continuous producer churn on PRV.

**C. A scrub/step control instead of playback.**
Preview stays frozen, but the Playlists panel gets ⏮/⏭ that step the PRV render through the list
manually. The operator confirms order and content without a running timer anywhere. Cheapest of
the two real options and it fits the "minimalism" standing principle; the transport buttons
already exist in the panel (`e2c699d` gave them monochrome inline SVG glyphs) and are currently
disabled unless the playlist is live — this would enable them for the preview case.

**Recommendation: C.** It answers the actual need (verify the edited list) without re-creating the
dual-timer surface that WO-354 had to untangle, and it costs one enable-condition plus a
step-render path rather than a new timer lifecycle. **A** is the right answer if the owner is happy
verifying on air.

## 4. Acceptance criteria — once the decision is made

Common to all three: item 23 and item 27 must be re-worded so they can no longer contradict each
other, and whichever WO implements the choice must state explicitly which of WO-354's and
WO-355's behaviours it preserves.

- **If A:** no code. Checklist reworded; WO-354's acceptance line corrected in its own file so the
  next audit does not re-open this.
- **If B:** recalling an edited look to preview plays the new list end to end; taking any look to
  PGM stops it immediately (WO-355 item 27 must still pass verbatim); no timer is shared between
  channels — prove it by running different playlists on PGM and PRV simultaneously.
- **If C:** ⏮/⏭ step the preview render through the list; item 27's "sits still" stays true (no
  automatic advance); stepping never emits AMCP to the program channel.

## 5. What was VERIFIED

- Both checklist notes quoted verbatim from the file as saved 28.07 14:26.
- WO-354 (`00bdf04`) and WO-355 (`4517e02`) statuses and stated intent read from their own WO
  files; the ordering (355 after 354) confirmed from `git log`.
- No code inspected beyond establishing the two WOs' intent — deliberately, because the question
  is which behaviour is *wanted*, not what the code does. Nothing changed.
