# HighAsCG — how work happens here

This is a LIVE CasparCG playout box (single owner, on-air use). Read this before touching
anything; it encodes the working discipline every session is expected to follow.

## Work orders are the memory of this repo

Every non-trivial issue, feature, or investigation gets a work order: `work/work-orders/NNN_WO_<slug>.md`
(next free NNN) plus a row in `work/OPEN_ISSUES.md` (the queue: `| WO-NNN | summary | link | status |`).

**Before working on ANY issue: search the work-order INDEX first** — one line per WO (number, status, area,
title, file), generated from the WO headers. It costs a fraction of grepping the WO bodies.

```
rg -i "<keyword>" work/work-orders/INDEX.md               # which WOs touch this? (status + file in the hit)
rg " (OPEN|IN PROGRESS) \[audio" work/work-orders/INDEX.md  # not-done WOs of one area
rg -il "<keyword>" work/work-orders/*.md                  # only then the live bodies (deprecated/ is skipped)
rg -n "<keyword>" work/OPEN_ISSUES.md                     # queue status
```

Most "new" issues are follow-ups, regressions of past fixes, or already-diagnosed problems with
a written root cause. The WO for the area tells you the load-bearing constraints (X SHAPE input
contracts, AMCP escaping, bank layout…) that a fresh reading of the code will not.

## Work order structure (in this order)

1. **Investigation FIRST.** What was found, with `file:line` evidence, measurements, journal
   excerpts, reproduction. Written BEFORE fixing — the diagnosis is the durable value.
2. **What was done.** The actual change, per file, and WHY that approach over alternatives.
3. **What was VERIFIED to work.** Concretely: which tests ran (counts), what was probed live on
   the box (journal lines, API responses, screenshots), and what remains owner-QA. Never mark
   done on "should work" — state what was proven and how.

Header, right under the `# WO-NNN — title` line:

```
**Area:** <primary>[, <secondary>…]     (slugs: tools/wo/wo-lib.js AREAS — engine, amcp, audio, godot-client, …)
**Status: OPEN | IN PROGRESS | DONE (date, how verified) | DEPRECATED (reason; successor WO-NNN)**
```

After adding or changing a WO header run `node tools/wo/build-index.js`; `node tools/wo/check-wos.js` (a curated
smoke, so CI) fails on a bad header, a stale INDEX.md or a reference to a missing WO file. Only WOs live in
`work/work-orders/` (owner todos arrive there too); notes go to `work/notes/`, logs and old todos to `work/archive/`.

**DEPRECATED work orders are NOT a source of truth.** A WO whose approach was reverted,
superseded, or proved wrong keeps its history but must carry a DEPRECATED status naming the
reason and the successor WO, and it lives in `work/work-orders/deprecated/` — move it with
`node tools/wo/wo-move.js <plan.json>` (it rewrites every link and path mention). Trust the successor, not the
corpse. When your own approach dies, deprecate the WO yourself — a dead end recorded honestly saves the next
session from repeating it.

## Non-negotiables

- **`RULES.md` holds the owner's project rules** (input-field behaviour, …). Every change follows them;
  add a rule there when the owner states one.
- **Verify, then say so.** Fixes are proven on the box (this is the production machine) or via
  the offline suite — and the WO records which.
- **Commit each verified unit immediately.** Small commits, real messages. Push triggers CI
  (GitHub Actions: verify + build-client) — keep it green; a red run is a real regression.
- **Smoke tests grep source text.** Many smokes `readFileSync` production files and pin exact
  lines (WO acceptance guards). Refactors must repoint the reads (concat pattern for require
  strings), never weaken assertions. New test files must be added to the curated FILES list in
  `tools/ci/offline-test-files.js` (run by `tools/ci/run-offline-tests.js`).
- **500-line file limit**, CI-enforced (`node tools/ci/check-max-file-lines.js`). Split, don't cram.
- **Deploy loop:** client → `npm run build:client` then `DISPLAY=:0 xdotool key F5` (kiosk
  reload). Server → `kill -TERM $(systemctl show -p MainPID --value highascg)` (systemd
  restarts it). Templates/shape helper respawn lazily.
- **Subagents:** use Haiku for small mechanical jobs; VERIFY their load-bearing claims yourself
  (diffs, tests) before committing. Never let an agent run git state operations.
- **Syncthing syncs this repo with peers.** Server-written paths must be in `.stignore` or
  peers revert them (see the shader-fight incident, WO-354 era). `.stignore` doesn't sync —
  mirror changes on the Mac.
- **Owner communication:** todos arrive in `work/work-orders/todosDD.MM.YY` files; QA hand-off
  goes through checklist files (`work/checklist*.md`). Minimalism is the standing UI principle.

## Fast context

`work/OPEN_ISSUES.md` — live queue. `work/todos*_wo_audit.md` — periodic status audits (can go
stale; the WO's own status line wins). Box-specific ground truth (ports, OSC quirks, kiosk/X
contracts) lives in the session memory of the owner's Claude setup and in the WOs themselves.
