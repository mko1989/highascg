# Decisions waiting on the owner — 2026-07-28

Three work orders are blocked on a judgement only you can make. Everything else from the 28.07
evening batch is implemented (WO-365, WO-367, WO-369, WO-370, WO-373; WO-372 partly).

Nothing below has been implemented — deliberately. Each section says what to answer, what it
costs, and what happens once you answer.

**Quickest path:** WO-366 is seven yes/no ticks (§1). WO-371 and WO-368 are one letter each.

---

## WO-371 — "In PRV the playlist stops after the first item"

**Answer with: A, B or C.** → [WO-371](./work-orders/371_WO_prv_playlist_preview_playback.md)

### Why this needs you rather than a fix

You signed off on this behaviour and reported it as a bug, in the same 14:26 checklist pass:

- **item 27, ticked ✅** (WO-355): *"Recall a playlist look to preview: it shows one item and sits still."*
- **item 23, unticked ❌** (WO-354): *"no, i prv the playlist stops after first item."*

Same behaviour, opposite verdicts. WO-355 made playlists PGM-only **after** WO-354's acceptance was
written (from your todos27 line *"everything can be done inside the pgm channel only"*), so item 23
was tested against wording that WO-355 had already invalidated. **No code is broken — the checklist
is.** But the question WO-354 was answering is still unanswered:

> After editing a playlist, how do you confirm the new list is right without putting it on air?

Today: you can't. Preview shows item 1 frozen.

### Options

| | What happens | Cost |
|---|---|---|
| **A** | PRV stays frozen. Reword item 23 to match WO-355 ("shows the FIRST item of the NEW list, and sits still") — it still tests the shared-timer bug WO-354 actually fixed. | **Zero code.** A mid-list edit still can't be previewed. |
| **B** | Preview runs its own playlist timer while the look is **not** on air; stops the instant it goes to PGM (WO-355 item 27 stays true). | Re-introduces a second timer on PRV — the surface whose *sharing* caused WO-354's bug. Must be channel-scoped (the foundation exists) and puts continuous producer churn on PRV. |
| **C** ⭐ | Preview stays frozen, but the Playlists panel's ⏮/⏭ step the PRV render through the list manually. | One enable-condition plus a step-render path. The transport buttons already exist (`e2c699d`) and are disabled unless the playlist is live. |

**Recommended: C** — it answers the real need (verify the edited list) without rebuilding the
dual-timer surface WO-354 had to untangle. **A** is right if you are happy verifying on air.

### After you answer

Either way, items 23 and 27 get reworded so they can never contradict each other again, and the
implementing WO states which of WO-354's and WO-355's behaviours it preserves.

---

## WO-368 — the shader library is currently single-copy

**Answer with: A, B or C.** → [WO-368](./work-orders/368_WO_shader_store_git_ownership.md)

### Why this needs you rather than a fix

`c4e2871` told Syncthing the box owns `template/shaders` (that fixed peers resurrecting deleted
shaders). Git was never told, and still tracks the same files. The two ownership models now
disagree permanently:

- `git ls-files` → 11 tracked, `ls` → 16 on disk;
- 2 tracked shaders deleted on the box, 1 edited, **9 untracked** (including the WO-356 `-c2/-c3/-c4`
  children Shader Live writes when you save an edit).

Three consequences, worst first:

1. **Any `git checkout -- template/shaders`, branch switch or reset resurrects `sh-ext.html` and
   `sh-ios.html` and reverts your edit to `sh-ksbhdgdgb.html`** — the exact symptom `.stignore` was
   written to stop, arriving through the other sync channel.
2. `git status` is permanently dirty, so "is the tree clean?" stops being a usable signal. That is
   how WO-322/323 were lost in the 22.07→24.07 window (~43 files of real work sitting uncommitted).
3. **Nothing backs up your shaders.** Syncthing is told not to replicate them; git is not tracking
   them. Your library exists on exactly one machine.

### Options

| | What happens | Cost |
|---|---|---|
| **A** | Box owns shaders; git stops tracking them (`git rm --cached` + `.gitignore`, one commit). Ends the dirty tree, makes resurrection impossible. | Shaders leave the release payload — a fresh ISO box ships with **no** shader library unless a seeding step is added (check `tools/eggs/` and the WO-188 drop path first). |
| **B** | Git owns shaders; commit the current state as truth. | Every Shader Live save dirties the tree again the moment you use the feature. A snapshot, not a fix — needs a commit habit or a hook. |
| **C** ⭐ | Split: a small tracked seed set ships in the ISO; box-written/edited shaders move to an untracked user store (`data/shaders`-style) that the loader also reads. | A real code change (loader, Shader Live save target, template browser listing). The only option that fixes backup, release payload and dirty tree at once. |

**Recommended: C** long-term; **A** is the correct stop-gap if you want it settled today. Neither
should land before answering *"what backs up my shaders?"* — right now nothing does.

### Same class, one commit, no decision needed

`README.md` in `/home/casparcg/companion-module-dev/companion-module-highpass-highascg` is still
untracked (`??`), so the dev-mode loop WO-361 documents exists only on this box. WO-372 added
`scripts/stamp-dev-manifest.js` and a `package:dev` change **in that same repo, also uncommitted**.
One commit there closes all three. Say the word and I'll do it.

---

## WO-366 — seven of your 21.07 lines were never triaged

**Answer with: does it still happen? — seven times.** → [WO-366](./work-orders/366_WO_todos21_untriaged_backlog.md)

### Why this needs you rather than a fix

The top 14 lines of `todos21.07.26` sit above the `WORK ORDERS CREATED FOR EVERYTHING STILL OPEN
(306-314)` banner, so they were never part of that triage, and the 26.07 audit worked *by work
order* — untriaged todo lines were outside its method. Seven have **zero** coverage anywhere
(grepped across `work/work-orders/`, `OPEN_ISSUES.md` and `git log --all --grep`).

They are a week old and the timeline surface has had at least three refactors since (`6c8e3dc`
split, `f65c7c4`, WO-173 batching), so some are probably already gone. Guessing which would mean
closing them on "probably fixed by a refactor" — which the WO's own acceptance criteria forbid.

### Tick each one

| # | Your line (21.07) | Still happens? | Note |
|---|---|---|---|
| 1 | live audio channel should be created at PAL/NTSC resolution so it's cheapest | ☐ yes ☐ no | Cheap generator change, measurable win — the channel is created at full video resolution today for a bus carrying no video. |
| 2 | ~~i connected pgm2 to rec output and pgm1 got recorded~~ | **— done —** | Promoted to WO-373 and **fixed 28.07**. Needs a highascg restart. |
| 3 | keyboard unlocks numlock between highascg/casparcg restarts | ☐ yes ☐ no | Zero hits for `numlock` anywhere in the repo. |
| 4 | some drag-and-drops from media browser to timeline don't "land" | ☐ yes ☐ no | |
| 5 | timeline clips missing almost all settings in the inspector | ☐ yes ☐ no | `f65c7c4` fixed a *crash* there; no WO says what that inspector should expose. |
| 6 | timeline editing should be quicker on the CasparCG output, like looks editing | ☐ yes ☐ no | Biggest piece. Probably extends the WO-338 nudge path to the timeline rather than new machinery. |
| 7 | in the timeline editor's compose preview, the label bar fills width instead of staying under the PRV window | ☐ yes ☐ no | WO-350 fixed this in the *deck* compose preview only. |

Two neighbouring lines are already covered and are why the block looks triaged at a glance: the
live-input-in-compose-preview request (WO-323, `f8cc0ce`) and "react faster to tab changes and
edits" (WO-338, closed 27.07).

### After you answer

Every **yes** gets its own numbered WO with a live repro. Every **no** is recorded in WO-366 as
"closed by audit — <how verified>, <date>" rather than silently dropped. Suggested order if several
are yes: **#1** (cheap, measurable), then **#7** (small, client-only), then **#6** (the big one).

---

## Also owed, not a decision

- **Restart highascg** to activate WO-373's server half:
  `kill -TERM $(systemctl show -p MainPID --value highascg)`
- **Restart Companion** to finish WO-372 — the dev build now declares `1.0.5-dev.d20260728t1511`
  vs installed `1.0.4`, so the picker finally has two entries, but I did not restart a live
  show-control service to look. Watch for two things: the connection is pinned to `1.0.4` in
  `db.sqlite` (expect to change the pin), and if Companion hides prereleases the fallback is to
  drop `--prerelease` and keep only the version suffix.
- **Nothing is pushed** — 8 commits sit on the local branch awaiting `git push origin main`.
- `npm run verify:repo-integrity` fails locally on 11 Syncthing `*.sync-conflict-*` files under the
  gitignored `projects/`. Your data, invisible to CI, untouched by me — worth a cleanup.
