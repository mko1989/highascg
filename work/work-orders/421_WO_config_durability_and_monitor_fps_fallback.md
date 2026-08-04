# WO-421 — Config durability (review rows 8–9, de-scoped per owner) + monitor-bus fps fallback; suite back to 0-fail

**Status: DONE (2026-08-04 — smoke 4/4, WO-237 smoke 4/4, suite 1815 pass / 0 fail / 2 skip — FIRST 0-fail suite since the 03.08 produce run; server restarted to load)**

## Owner reframe that unblocked this (04.08)

"The WO-415 incident is normal operation that happens when I run eggs produce. It sets all
configs to defaults so the produced ISO is clean and not full of old test projects." So:
- The stick-insert → default-config sequence is **intended produce behavior**, not an incident.
  WO-415 is reframed accordingly; its hardening options 1–2 (flip pair direction / marker-file
  gating) are DROPPED — they would fight the intended flow. No config restore wanted.
- What remains from review rows 8–9 are the parts that hold in ANY flow, intended or not:
  torn files from crashes mid-write, and the amplifier that destroys a recoverable file.

## Investigation

1. **Review config §1 (row 9)** — `config-manager.js`: a config file that exists but fails to
   parse was logged and silently replaced by compiled defaults in memory; the next `save()`
   writes every key unconditionally, destroying the torn-but-recoverable file on disk. Both the
   monolithic outer catch and the per-file `_loadModular` catches had this shape.
2. **Review config §3 (row 8, atomicity half)** — `exfat-sync-fs.js` `copyFilePreserveTimes`
   used `fs.copyFileSync` straight onto the destination: truncate-then-write, the only writer
   of live `config/*.json` bypassing the WO-161 tmp+rename discipline. A crash/yank mid-copy
   leaves a torn file, which then feeds §1.
   The staleness-guard half of row 8 (review §2) is **deliberately NOT done**: "stick wins at
   boot" is the intended produce/field-kit contract per the owner.
3. **WO-237 suite reds were NOT pure config drift** — on the post-produce config (operator-GUI
   destination only, 50 fps) the generator's monitor bus read
   `plan.screens?.[0]?.dims?.fps` → undefined → fell back to 576p2500 against a 50 fps GUI
   main: the exact WO-237 every-other-frame audio-chop condition, live in the generated XML.
   The second red assumed `Screen 1 program/preview output` blocks exist — a test precondition
   the operator-gui-only config legitimately violates.

## What was done

1. `config-manager.js` — `_quarantineCorruptFile()`: an unparsable-but-present config file is
   renamed to `<name>.corrupt-<stamp>` (recover by fixing the JSON and renaming back) before
   defaults take over. Wired into the monolithic outer catch (only when the path is a file),
   every `_loadModular` per-key catch, and the `tandem_topology.json` catch.
2. `exfat-sync-fs.js` — `copyFilePreserveTimes` copies to `dst.tmp-<pid>`, applies utimes to
   the tmp, `renameSync`s into place; unlinks the tmp and rethrows on failure.
3. `config-generator-channels.js` — monitor bus fps:
   `plan.screens?.[0]?.dims?.fps ?? plan.operatorGuis?.[0]?.dims?.fps` (rate-match whatever
   mains exist).
4. Smoke repoints, reason recorded inline in both files: WO-406 smoke pinned the old call-site
   text (same contract, wider fps source); WO-237 smoke's fixed role list
   `['Screen 1 program output', …]` now derives the roles from the mains actually present in
   the no-monitor XML (and newly covers the operator-GUI block with the same unchanged-by-
   monitor-enable equality).

New `tools/smoke/smoke-wo421-config-durability.test.js` (curated): functional quarantine
(modular + monolithic: corrupt file moved aside, original bytes preserved, box still boots),
functional tmp+rename copy (success, failure leaves no debris and dst untouched), source pin
for the fps fallback.

## What was VERIFIED

- WO-421 smoke 4/4; WO-237 smoke 4/4 against the live box config (monitor mode now 720p5000
  for the 50 fps operator-GUI main — was 576p2500); WO-406 smoke green after repoint.
- Full suite **1815 / 0 fail / 2 skip** — first 0-fail suite since the produce run. All other
  gates green (500-line, unwired-exports, lint 218/218, prettier).
- Server restarted to load the quarantine + atomic-copy + generator code. The corrected
  monitor mode lands in `casparcg.config` on the next Apply from Settings (config generation
  is apply-time; no probe until then).
