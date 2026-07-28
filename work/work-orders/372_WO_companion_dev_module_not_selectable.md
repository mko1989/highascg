# WO-372 — Companion offers no "dev" module to choose: the dev build and the installed build declare the same id AND the same version

**Status: OPEN — root cause found on the box 28.07.26. WO-361's claim was right about the flag and wrong about the outcome. Not fixed.**

Source: `work/checklist27.07.26_manual_verify.md` item 40, owner note 28.07 14:26:

> no, there is no dev to choose meaning companion doest run with correct flags. where is it defined?

## 1. Investigation

### 1a. Answering the owner's direct question first

*Where is it defined?* — a systemd drop-in, installed 21.07:

```
/etc/systemd/system/companion.service.d/override.conf
```

which appends to the unit's `ExecStart`:

```
--extra-module-path /home/casparcg/companion-module-dev
```

### 1b. The flag IS correct — that part of the diagnosis is wrong

Verified live on the box:

- `systemctl cat companion` shows `--extra-module-path /home/casparcg/companion-module-dev` on the
  `ExecStart` line.
- The running process (`pid 3390627`, started 14:17) is that unit.
- `dev-mode.sh` **has** been run: the symlink exists and resolves —
  `/home/casparcg/companion-module-dev/highpass-highascg → …/companion-module-highpass-highascg/pkg/highpass-highascg`
  (created 14:16, owned by root, i.e. run under sudo).
- Companion restarted at 14:17 and loaded the module cleanly:
  `Instance/Connection/HighAsCG/Entrypoint Found module entrypoint, with 0 upgrade scripts` …
  `Module initialized successfully`. No scan errors in the journal.

So Companion is running with the right flag, pointing at a valid dev module, and it loaded. The
owner's inference ("doest run with correct flags") is understandable but not what is happening.

### 1c. Real root cause — the two builds are indistinguishable

Both module copies declare an identical identity:

| path | manifest `id` | manifest `version` |
|------|---------------|--------------------|
| `/home/casparcg/companion-module-dev/highpass-highascg` (dev symlink) | `highpass-highascg` | **1.0.4** |
| `/home/casparcg/.config/companion/modules/highpass-highascg` (installed store) | `highpass-highascg` | **1.0.4** |

Companion's module-version picker lists *versions* of a module id. With two copies claiming
`highpass-highascg@1.0.4`, there is exactly **one** entry to offer — there is no second version to
appear in the dropdown, and nothing marks either copy as a development build. Hence "there is no
dev to choose". The dev path is being loaded or shadowed silently depending on scan order, which
is worse than it failing loudly: an edit-rebuild-restart cycle may or may not be what is running,
with no way to tell from the UI.

This is why `dev-mode.sh` appears to do nothing. The script's own header documents the loop
(edit → `npm run package:dev` → restart) but never changes the version, so every dev build
collides with the installed one.

## 2. What needs doing (plan — NOT executed)

1. **Make the dev build self-identifying.** `npm run package:dev` in the module repo should stamp a
   distinguishable version — a prerelease suffix (`1.0.5-dev.0`, or `1.0.4+dev.<n>`) written into
   `companion/manifest.json` at package time, not committed to source. Then Companion has two
   versions of one id and the picker has something to show.
   - Confirm which form Companion 5.0.2's version comparator accepts before choosing; a suffix it
     cannot parse may make the module vanish entirely rather than appear as an option.
2. **Verify what the picker actually does** with two versions present before declaring this fixed —
   the connection's pinned version lives in `db.sqlite` (WO-330 had to repoint a stale pin there),
   so an existing `HighAsCG` instance pinned to `1.0.4` may keep loading the installed copy even
   once a dev version exists. Expect to change the pin, and document that in the README.
3. **Make the loaded copy observable.** The dev loop is untrustworthy without it: log or surface
   which path the running module came from, so "did my edit take?" is answerable without guessing.
   Companion logs `Found module entrypoint` — check whether it can be made to include the path.
4. **Update `tools/eggs/companion/dev-mode.sh`** to say what it does *not* do (it does not make the
   module selectable on its own) and to fail loudly if the dev manifest version equals the
   installed one.
5. **WO-361's status line must be corrected.** It currently reads DONE on the strength of the flag
   already being configured — which is true and insufficient. The dev workflow it documents does
   not work end to end.

## 3. Acceptance criteria

- With the dev symlink in place and Companion restarted, the `HighAsCG` connection's version
  dropdown lists **two** entries and one is unmistakably the dev build.
- Editing module source → `npm run package:dev` → `sudo systemctl restart companion` produces an
  observable change in Companion with no ambiguity about which copy is live.
- Selecting the packaged version returns to the shipped 1.0.4 behaviour.
- The README documenting the loop is committed **in the module repo** — still outstanding from
  WO-361, see [WO-368](./368_WO_shader_store_git_ownership.md) §3, where the same untracked-README
  residue is recorded.

## 4. What was VERIFIED

- Every fact in §1b was read off the live box on 28.07: `systemctl cat companion`, `ps`,
  `readlink -f`, `journalctl -u companion --since 14:15`.
- Both manifests parsed directly; the id/version collision in §1c is measured, not inferred.
- Not verified, and deliberately so: how Companion 5.0.2's picker behaves once two versions exist.
  That needs the change made first — it is step 2 of the plan, not an assumption behind it.
- Nothing changed on the box: no manifest edited, no service restarted, no module repackaged.
