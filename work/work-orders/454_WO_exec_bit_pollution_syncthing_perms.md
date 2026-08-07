# WO-454 — exec-bit pollution: 1039 files committed as 755, 472 more pending; source = exFAT perms via Syncthing

**Status: DONE (2026-08-07 — tree normalized in 8687eec + follow-up, git status clean except runtime files, Syncthing highascg folder ignorePerms=true live-verified via REST. Peers still need the same toggle when next powered on.)**

## Investigation FIRST

Owner asked what the mode-only changes were. Ground truth:

- Working tree carried **472 files flipped 100644→100755 with zero content diff** (299 src/,
  140 template/, 16 scripts/, 15 tools/). Worse: `git ls-tree -r HEAD | grep 100755` showed
  **1039 files already COMMITTED executable**, including `.gitignore`, `README.md`, most of
  `docs/`, vendor PDFs — the pollution had been leaking into history for weeks, one commit at
  a time, whenever a session committed a file that happened to be flipped (this session's
  WO-453 commit 2 included; caught in review).
- Mechanism: exFAT has no POSIX permissions — every file on an exFAT mount reads back 755.
  The repo's Syncthing folder (`w6jjt-3qnxe`) had **`ignorePerms="false"`**, so any peer whose
  copy round-tripped exFAT broadcast 755 for everything it rescanned; this box received and
  applied it. Same failure family as the WO-354-era server-write sync fights.
- Owner: the other Syncthing machines are currently off — no live fight while fixing.

## What was done

1. Classified all 1039 committed executables: extension (`.sh/.command/.py/.pl/.cgi`) or `#!`
   shebang = legit (300 kept); the other **739 stripped to 644** and committed (736 + 2
   space-named vendor PDFs + 1 already covered). The 472 uncommitted flips chmod-reverted.
   Zero content staged in the normalization commits (verified `--cached --numstat`).
2. Syncthing `highascg` folder set **`ignorePerms=true`** via REST PATCH (HTTP 200, re-read
   confirms `true`, persisted by Syncthing itself) — git is now the only authority on the
   exec bit; Syncthing stops relaying exFAT's lies. Rejected alternatives: committing the
   755s (permanent wrong metadata), `core.fileMode=false` (hides real exec-bit changes on
   future scripts).

## What was VERIFIED to work

- `git status` clean afterwards except the 7 legitimately-dirty runtime files
  (config/*.json runtime writes, README.txt, owner todos).
- `git ls-tree -r HEAD | 100755` now = real scripts only (extension/shebang audit).
- REST `GET /rest/config/folders/w6jjt-3qnxe` → `ignorePerms: true`.

## Remains owner

- **When the Mac / other peers come back online: set Ignore Permissions on the highascg
  folder there too** (Folder → Edit → Advanced), BEFORE their first rescan — a peer with
  ignorePerms=false and a 755-polluted copy can re-flip this tree once, though git now makes
  that a one-command revert.
