# WO-366 — todos21.07.26 top block was never triaged: seven owner items with no work order

**Status: OPEN — gap found by the 14.07→28.07 completeness audit (28.07.26). Triage only; no code written.**

## 1. Investigation

`work/work-orders/todos21.07.26` has two halves. Everything from the `WORK ORDERS CREATED FOR
EVERYTHING STILL OPEN (306-314)` banner down was triaged that day into WO-306…WO-314 and has
since been resolved or is tracked in `work/OPEN_ISSUES.md`.

The **first 14 lines** — written before that banner — were not part of the list the 306-314
block enumerates, and were never picked up afterwards. The 26.07 audit
(`work/todos26.07.26_wo_audit.md`) audited WO-306–344 by *work order*, so untriaged todo lines
were outside its method and stayed invisible.

Coverage check run 28.07.26 (`grep -rlin` over `work/work-orders/` for each phrase, plus
`git log --all --grep` and `work/OPEN_ISSUES.md`): the only file matching any of these phrases
is `todos21.07.26` itself.

| # | Owner line (todos21.07.26) | Coverage found |
|---|---------------------------|----------------|
| 1 | "the live audio channel should be created with pal or ntsc resolution setting so its the cheapest" | **none.** WO-237 (audio-only cheapest mode) predates this and is about audio-only channels, not the live-audio host channel. |
| 2 | "i connected pgm2 to rec output and pgm1 got recorded" | **none.** WO-172 covers device-view→stream source *sync*; no WO describes a record bus taking the wrong channel. Potentially the same failure class as WO-364's "destinationToVideoSource returns program_N unconditionally". |
| 3 | "why would keyboard reload(?)… the keyboard unlocks the numlock between restarts of highascg or casparcg" | **none.** Zero hits for `numlock` anywhere in the repo. |
| 4 | "some drag and drops from media browser to timeline do not 'land' on the timeline" | **none.** |
| 5 | "clips on the timeline are missing almost all of their settings in the inspector" | **partial.** `f65c7c4` ("timeline-clip inspector ReferenceError fix", found uncommitted 24.07) fixed a crash in that inspector but no WO states what the inspector is *supposed* to expose for a timeline clip. |
| 6 | "timeline operations especially during editing should be quicker on casparcg output… similar to how looks editing work" | **none.** WO-338 (operator edit latency) closed 27.07 covers the *looks/compose* path only. |
| 7 | "in compose preview inside timeline editor the default sizes of the label bar is fill width instead of keep it under the prv window" | **none.** WO-350 fixed bar heights in the *deck* compose preview; the timeline editor's compose preview was not in scope. |

Line 13's other half — "id also like to be able to add a live input (decklink for instance) to
preview in the compose preview" — **is** covered (WO-323, implemented `f8cc0ce`, checklist27
item 10). Line 13's "react faster to tab changes and edits" is covered by WO-338 (CLOSED 27.07).
Those two are why the block looks triaged at a glance; the seven above are not.

## 2. What needs doing

This WO is the triage, not the fix. For each of the seven:

1. Ask the owner which still reproduce — this is a week-old list and the timeline surface has
   had at least three refactors since (`6c8e3dc` split, `f65c7c4`, WO-173 batching). Items 3, 4
   and 5 in particular may already be gone.
2. Anything that still reproduces gets its own numbered WO with a live repro, following the
   normal structure (investigation first).
3. Anything that does not reproduce gets recorded here as closed-by-audit with the date and how
   it was checked — not silently dropped.

Suggested first cuts if the owner confirms them:

- **#2 (record bus records the wrong channel)** is the one with on-air consequence — a record
  that silently captures PGM1 while the operator cabled PGM2 is a lost recording. Start here.
  WO-364 §1 documents exactly this shape of bug (`destinationToVideoSource()` returning
  `program_<N>` regardless of the edge's `outputLayer`); check whether the record/stream sink
  resolution has the same unconditional mapping.
- **#1 (live-audio channel resolution)** is a cheap generator change with a measurable win —
  the channel is created at full video resolution today for a bus that carries no video.
- **#6 (timeline edit latency)** is the biggest piece; it likely wants the WO-338 nudge path
  extended to the timeline surface rather than new machinery.

## 3. Acceptance criteria

- Every one of the seven lines ends in one of: a numbered WO, a row in `OPEN_ISSUES.md`, or a
  "closed by audit — <how verified>, <date>" line in this file.
- No line is closed on "probably fixed by a refactor" without a check against the live box.

## 4. What was VERIFIED

- The coverage table above: each phrase grepped case-insensitively across `work/work-orders/`,
  `work/OPEN_ISSUES.md`, and `git log --all --grep`; only the todo file itself matched for the
  seven marked **none**.
- Repo state at `637965c`; offline suite 1559 pass / 0 fail / 2 skip at time of audit.
- No code written, nothing deployed.
