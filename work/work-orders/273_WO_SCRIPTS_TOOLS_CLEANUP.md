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

---

# Inventory and findings (executed 2026-07-20)

## Scope actually measured
`scripts/` = 131 files. `tools/` = 616 files — but only **200** of those are scripts at all:
**91** are Plymouth/Calamares branding assets (PNG frames, themes) under
`tools/eggs/live-usb/branding/` and `highascg-eggs-theme/`, and **325** are `tools/smoke/*`
test files. So of 747 files in scope, 416 are branding art and the offline test suite.
The owner's "so much of it" is mostly those two, not runtime code — the actual runtime
surface is **46 files**, about 6%.

## Bucket counts (verified by `find`, totals reconcile to 131 + 616)

| Bucket | Count | Where it lives |
|--------|-------|----------------|
| **runtime** | **46** | `tools/runtime/` (34) + `scripts/exfat/highascg-*.sh` runtime helpers (12), installed to `/usr/local/lib/highascg/` |
| **setup** | **65** | `scripts/setup/` `boot/` `replication/` `lib/` `runtime/` (installers) `systemd/` `polkit/` `nvidia/` `tmpfiles.d/` `hooks/` (60) + `scripts/exfat/install-*.sh`, `write-*.sh` (5) |
| **dev** | **494** | `tools/smoke/` (325), `tools/eggs/` scripts (119), `tools/{ci,wiki,map,release,replication,startup,dev}` (45), `scripts/{deploy,ci,eggs}` (5) |
| **deprecated** | **33** | `scripts/deprecated/` — now the single archive |
| *branding assets* | *91* | `tools/eggs/live-usb/{branding,highascg-eggs-theme}/` — not scripts, ISO art |
| *compat forwarders* | *9* | `scripts/` root — 2–4 line `exec` shims, left in place (see open questions) |
| *unclassified* | *9* | `scripts/fix/` (4), `scripts/README.md`, `backup-caspar-config.sh`, `cg-studio-run.js`, 2 gitignored `.pyc` |

## Runtime set — every entry has a named caller

| Script | Caller (evidence) |
|--------|-------------------|
| `tools/runtime/operator-shape-overlay.py` | `src/` ×4 — spawned by running server |
| `tools/runtime/confine-pointer-barriers.py` | `src/system/pointer-confine.js` |
| `tools/runtime/confine-cursor.py` | `src/` |
| `tools/runtime/caspar-kill-main.sh` | `src/utils/caspar-restart.js` |
| `tools/runtime/casparcg-supervisor-lib.sh` | `run.sh` |
| `tools/runtime/highascg-launch-operator-firefox.sh` | `src/api/routes-system-browser.js` |
| `tools/runtime/highascg-network-apply.sh` / `-reset.sh` | `src/api/system-hardware-network.js` |
| `tools/runtime/highascg-nvidia-x-apply.sh` | `src/utils/nvidia-display-policy.js` + openbox autostart |
| `tools/runtime/highascg-operator-snap-home.sh` | `src/system/cef-bridge-subprocess.js` |
| `tools/runtime/highascg-replication-ssh.sh` | `src/api/routes-media-replication.js` |
| `tools/runtime/print-api-token.sh` | `src/api/auth-token-file.js` |
| `tools/runtime/exfat-sync-cli.js` | `/etc/systemd/system/highascg-exfat-sync.service` — **direct repo path** |
| `tools/runtime/capture-boot-xrandr.sh` | `~/.config/openbox/autostart` — **direct repo path** |
| `tools/runtime/probe-internal-storage.sh` | `highascg-storage-probe.service` (via `/usr/local/lib/highascg/`) |
| `tools/runtime/highascg-power-button-listen.sh` | `highascg-power-button.service` |
| `tools/runtime/highascg-apply-hardware-hostname.sh` | `highascg-hardware-hostname.service` |
| `tools/runtime/wo47-highascg-exfat-boot.sh`, `wo47-highascg-fix-config-permissions.sh` | `patch-wo47-exfat-boot-scripts.sh` **fallback** — see finding 3 |
| `scripts/exfat/highascg-exfat-{boot,arrive,network-apply,server-update}.sh`, `highascg-bridge-{boot,arrive}.sh`, `highascg-fix-config-permissions.sh`, `highascg-apply-server-drop.sh` | `/etc/systemd/system/highascg-*.service` (installed to `/usr/local/lib/highascg/` by `install-exfat-systemd-units.sh`) |
| `scripts/exfat/highascg-webui-server-update.sh` | `src/` |
| `tools/runtime/decklink-install-from-exfat.sh` (installed copy) | `highascg-decklink-install.service` |
| `fix-calamares-branding.sh` | `highascg-calamares-branding.service` |

## Moves executed (`git mv`, history preserved)

| From | To | Evidence |
|------|----|----------|
| `scripts/legacy/` (6 files) | `scripts/deprecated/legacy/` | Only caller was `scripts/install.sh`; README already listed it "Do Not Use" |
| `scripts/unused/` (5 files) | `scripts/deprecated/unused/` | 0 refs anywhere; its own README says dead |
| `scripts/lib/install-helpers-{github,packages,runtime}.sh` | `scripts/deprecated/lib/` | 0 refs; abandoned split (finding 2) |
| `scripts/highascg-exfat-server-update.sh` | `scripts/deprecated/` | 0 refs; dead regression fork (finding 1) |

**References updated:** `scripts/install.sh` forwarder target; `SCRIPT_DIR` in
`scripts/deprecated/legacy/install.sh` (`../..` → `../../..`, since the file is one level
deeper and `$SCRIPT_DIR` must resolve to repo root — this feeds all five `install-phase*.sh`);
`scripts/README.md`; `scripts/deprecated/README.md`. Deprecation headers added to the four
dead files so nobody resurrects them.

Nothing under `tools/` was moved — every candidate had a caller or sits in a correctly-named
directory already.

---

## Findings — these matter more than the tidying

### 1. `scripts/highascg-exfat-server-update.sh` was a dead regression that looked current
Added **2026-07-04**, i.e. *newer* than the canonical `scripts/exfat/` version (last touched
2026-06-30), so any "use the newest" instinct picks the wrong file. It was never installed or
invoked — `install-exfat-systemd-units.sh:47` copies `scripts/exfat/highascg-exfat-server-update.sh`
to `/usr/local/lib/highascg/`, which is what `highascg-exfat-server-update.service` runs.
Relative to the live version this fork **drops** the `--excludes` list, `--archive-copy`,
`mkdir -p /run/highascg`, and the apply-failure recovery path that restarts the previous tree.
Had anyone "fixed the duplicate" by keeping the newer file, exFAT server updates would have
silently lost their exclude list. Moved to `deprecated/` with an explicit warning header.

### 2. 2026-07-04 was an abandoned-refactor day — four dead files, one theme
The same date produced `scripts/lib/install-helpers-{github,packages,runtime}.sh`: a clean
3-way split of the 518-line `install-helpers.sh`. **Nothing ever sourced them**, and all 23
functions are still defined in the monolith — so the split was written, never wired, and
never removed. `grep -rn 'install-helpers-'` across `src/ tools/ scripts/` returns zero hits.
Anyone editing the split files to fix an installer bug would see no effect.

### 3. `wo47-*.sh` are live fallbacks that basename-grep says are dead — and they have drifted
`tools/runtime/wo47-highascg-exfat-boot.sh` and `wo47-highascg-fix-config-permissions.sh`
show **0 references** to a basename grep, because `patch-wo47-exfat-boot-scripts.sh` builds
the path as `"${HERE}/wo47-${name}"`. They are the fallback source when `scripts/exfat/` is
absent (a Calamares-installed host from a fragment ISO). **I did not move them.** But
`wo47-highascg-exfat-boot.sh` has drifted from `scripts/exfat/highascg-exfat-boot.sh` — it is
missing this block:

```bash
if systemctl cat highascg-exfat-network-apply.service &>/dev/null; then
	log "Queueing highascg-exfat-network-apply.service (--no-block)"
	systemctl start --no-block highascg-exfat-network-apply.service 2>>"$LOG" || log "WARN: ..."
fi
```

**A host recovered via the fallback path boots without network-apply queued.** Left as an open
question — resyncing it is a behaviour change on the recovery path and belongs in its own WO.

Its stated rationale is also now stale: the header says *"Shipped under tools/runtime/ for
playout hosts (ISO excludes ~/highascg/scripts/\*)"*, but the fragment list **also** excludes
`home/casparcg/highascg/tools/*`, and the embed-server list excludes **neither** `scripts/` nor
`tools/runtime/`. Neither ISO variant matches the premise the file was created under.

### 4. Eggs-list contradictions

- **The default `-fragment.list` excludes both `scripts/*` and `tools/*`.** This is by design
  (header: "ISO = Caspar shell; Node server from exFAT drop-update/") and the tarball carries
  `scripts` + `tools/runtime`, so `highascg-exfat-sync.service`'s direct repo path
  `/home/casparcg/highascg/tools/runtime/exfat-sync-cli.js` resolves after the drop is applied.
  **Not a bug — but it is load-bearing and undocumented at the unit.** That unit has no
  `/usr/local/bin` fallback, unlike `capture-boot-xrandr.sh` in the openbox autostart, which
  does. A fragment ISO that boots without a stick has a dead exfat-sync unit by construction.
- **`penguins-eggs-exclude-highascg-embed-server.list` excludes `tools/restore` — which does
  not exist.** Stale entry; the directory is absent from the repo.
- **The embed-server list excludes only `tools/{eggs,smoke,release,restore}`** and therefore
  **ships `tools/ci/`, `tools/map/`, `tools/wiki/`, `tools/replication/`, and the empty
  `tools/dev/` onto the playout ISO.** All five are build-host-only by the WO's own definition
  of the dev bucket. Adding them is a safe ISO-size win but is an ISO-content change, so I
  left it as a recommendation rather than editing the list.
- **The embed-server list does not exclude `home/casparcg/highascg/scripts/*` at all**, so the
  full NVIDIA graveyard (`scripts/deprecated/nvidia/`, 10 scripts) ships on that ISO.

### 5. The headline: nothing filters `scripts/` on the way to a playout box
`scripts/lib/archive-common.sh::archive_common_server_tar_members()` defines the release
tarball **and** the exFAT drop-update payload as:

```
index.js package.json package-lock.json src config template scripts tools/runtime [dist-web]
```

`scripts` is taken **whole**. Every playout box therefore receives `scripts/deprecated/`,
including the NVIDIA graveyard, on every update — which is precisely the owner's "I can't
believe all of those are necessary for runtime." Consolidating into `deprecated/` does not by
itself shrink the payload.

**Recommended one-line fix (not applied — it changes the live update path, so it wants the
owner's sign-off):** add to `archive_common_bulk_tar_excludes()`:

```bash
--exclude="./scripts/deprecated"
```

Evidence that this is safe: no file under `scripts/deprecated/` has any reference from `src/`,
`client/`, `package.json`, any `.service` unit in-repo or in `/etc/systemd/system/`, or the
openbox autostart. The only inbound edge is `scripts/install.sh` → `deprecated/legacy/install.sh`,
a human-invoked host installer that is never run from a deployed tarball.

## Open questions — deliberately not moved

| Item | Why left alone |
|------|----------------|
| 9 compat forwarders at `scripts/` root — `dev-push.sh`, `install-exfat-systemd-units.sh`, `write-highascg-systemd-unit.sh`, `install-host-boot-branding.sh`, `apply-bridge-label-highascgdat.sh`, `clean-eggs-dev-host.sh`, `disable-nvidia-multi-driver-boot.sh`, `highascg-exfat-remount-sync.sh`, plus `install.sh` (legacy monolith entry) | Intentional back-compat from the 2026-06-08 reorg; each is a 2–4 line `exec bash .../<canonical>` shim. Still the path used by ~40 doc/runbook references. Removing them is a docs project, not a scripts project. Note these are the *reason* the root of `scripts/` looks cluttered — they are 3 lines each, not duplicated logic. |
| `tools/runtime/wo47-*.sh` | Live fallback (finding 3). Drift should be fixed, not the file moved. |
| `tools/runtime/{clean-slate-reset.js,replication-pair-qa.sh}`, `tools/replication/*.js`, `tools/map/timing-test.js` | 0 refs, but operator/QA diagnostics reachable by hand and already in correctly-named dirs. Classifying them dead needs owner intent, not grep. |
| `scripts/fix/*` vs `scripts/deprecated/fix-*` (4 divergent pairs) | Both copies differ; `scripts/fix/` is newer and referenced once. Deciding which is canonical requires knowing which boot failure each addresses. |
| `scripts/setup/highascg-nvidia-persistence.service` | Pending manual install by owner — **not moved**, install path in its header comment is unchanged and still correct. |
| `tools/runtime/__pycache__/` | Untracked and already gitignored; not mine to delete. |
