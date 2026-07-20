# WO-273 — scripts/ and tools/ cleanup and classification

**Source:** todos19.07.26 — "i need you to do a thorough clean up on the scripts that are in scripts
folder and tools. there is so much of it... i cant beleive all of those are necesery for runtime.
id like the clean up to be moving deprecated into deprecated folder, and leaving/creating set of
scripts that are necesery for proper runtime, those that are needed for getting a fresh ubuntu
install to a working highascg server, and dev scripts for running eggs produce and simliars."

## Target end state
Every script lands in exactly one of four buckets, and the bucket is obvious from where it lives:

1. **runtime** — invoked by the running server, a systemd unit, or the operator GUI at any point
   during normal playout operation. These MUST keep working and MUST stay on the produced ISO.
2. **setup** — takes a fresh Ubuntu install to a working HighAsCG box (drivers, units, users,
   directories). Run once per machine, not during playout.
3. **dev** — build-host only: eggs produce, release packaging, wiki build, mirrors, QA helpers.
   These may be excluded from the ISO.
4. **deprecated** — superseded or dead. Moved to the existing `deprecated/` tree, not deleted, so
   history and intent survive.

## Method — evidence before moving anything
A script is **runtime** only if you can point at the caller. Build the evidence set first:
- `grep -rn` for each script's basename across `src/`, `client/`, `tools/`, `scripts/`,
  `package.json` scripts, `*.service` units in `scripts/setup/` and `/etc/systemd/system/`,
  `.xsession`/session startup files, and the eggs exclude lists.
- Check `tools/ci/run-offline-tests.js` and the smoke tests for references.
- Check the eggs fragments (`tools/eggs/live-usb/penguins-eggs-exclude-highascg*.list`) — anything
  currently EXCLUDED from the ISO is by definition not runtime; anything a unit calls must NOT be
  excluded. Reconcile both directions and report contradictions.

Produce a written inventory table (script → bucket → evidence/caller → action) in this file before
executing the moves.

## Constraints — this is a live playout box
- Moving a runtime script breaks playout. When evidence is ambiguous, classify conservatively as
  **runtime** and say so in the inventory rather than guessing.
- Prefer `git mv` so history follows the file. Never delete.
- Update every reference you move: unit files, package.json, docs, eggs lists, other scripts.
- Do NOT restart the service, do NOT run `npm run build:client`, do NOT execute setup or eggs
  scripts as part of this work.
- `scripts/setup/highascg-nvidia-persistence.service` is pending manual install by the owner —
  do not move or rename it without noting the new install path in the file's own header comment.

## Acceptance
- Inventory table complete: every file under `scripts/` and `tools/` classified with evidence.
- Moves executed for the unambiguous cases; ambiguous ones listed as open questions, not moved.
- All references updated; `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
- A short "where do I put a new script?" note so the structure survives contact with future work.
