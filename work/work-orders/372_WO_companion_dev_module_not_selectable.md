# WO-372 — Companion offers no "dev" module to choose: the dev build and the installed build declare the same id AND the same version

**Status: IN PROGRESS — the collision is fixed and the dev build is now self-identifying (`1.0.5-dev.d20260728t1511` vs installed `1.0.4`). Plan steps 1, 4 and 5 done; steps 2 and 3 need a Companion restart, which is an owner call on a live show-control service — NOT declared done until the picker is observed.**

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

## 4. What was DONE (steps 1, 4, 5)

### 4a. The dev build stamps its own version (step 1)

The plan's caveat was answered **before** choosing a form: `validateManifest` from
`@companion-module/base/manifest` — the same validator `companion-module-build` runs — was fed
three candidates against the real manifest. All three are accepted:
`1.0.4-dev.d20260728t1512`, `1.0.5-dev.0`, `1.0.4+dev.1`. So a suffix cannot make the module
vanish at validation.

The build tool already supports what was needed and it was simply never used:
`companion-module-build --prerelease` sets `isPrerelease` in the manifest
(`tools/dist/scripts/lib/build-util.js:113`), and the version is copied verbatim from
`package.json:version` (`:108`) — which is exactly why every dev build collided.

In the module repo (`~/companion-module-dev/companion-module-highpass-highascg`):

- **new `scripts/stamp-dev-manifest.js`** — rewrites the **packaged** manifest only
  (`pkg/<id>/companion/manifest.json`): version → `<next patch>-dev.d<UTC yyyymmdd>t<hhmm>`,
  `isPrerelease: true`, then re-validates before writing. Source `package.json` and
  `companion/manifest.json` are never touched, so nothing dev-only can be committed by accident.
- **`package:dev`** → `companion-module-build --dev --prerelease && node scripts/stamp-dev-manifest.js`.

Form choices, both deliberate: a leading-letter timestamp identifier (`d2026…`) because semver
forbids leading zeros in *numeric* prerelease identifiers and an 09xx time would be invalid; and
**next**-patch rather than same-patch, because `1.0.4-dev.x` sorts BELOW `1.0.4` and would read as
older than the release it is testing.

### 4b. `dev-mode.sh` refuses to hide the failure (step 4)

`tools/eggs/companion/dev-mode.sh` was also **stale**: it looked for the build in `dist/` and put
the symlink in `/home/casparcg/companion/modules/`, while the working setup (per §1b) uses
`pkg/<id>` and `<extra-module-path>/<id>`. Repointed, and:

- it now reads both manifests and **exits 1 with the explanation** when the dev and installed
  versions match — the exact state that produced "there is no dev to choose";
- the header says what the script does *not* do (it does not make the module selectable on its
  own), and the printed workflow names the version to pick and warns that the pin lives in
  Companion's `db.sqlite`, so an existing connection keeps its pinned version until changed.

### 4c. WO-361 status corrected (step 5)

[WO-361](./361_WO_companion_module_dev_mode.md) now reads CORRECTED, not DONE, naming why
(verifying the flag is not verifying the loop) and pointing here.

## 5. What was VERIFIED

- **The collision is gone, measured:** dev manifest `highpass-highascg@1.0.5-dev.d20260728t1511`
  `isPrerelease: true` vs installed `highpass-highascg@1.0.4` `isPrerelease: false`, both read
  back from disk after a real `npm run package:dev`.
- **Version forms accepted** by Companion's own manifest validator (above) — the plan's step-1
  caveat, answered with a run rather than an assumption.
- **The guard fires and passes:** a fixture tree with two `1.0.4` manifests → `dev-mode.sh` exits
  **1** with the WO-372 explanation; changing the dev manifest to the stamped version → passes and
  creates the symlink. Also re-run against the real box layout: "dev 1.0.5-dev.d20260728t1511 vs
  installed 1.0.4 ✓ distinguishable", symlink already correct.
- Every fact in §1b was read off the live box on 28.07: `systemctl cat companion`, `ps`,
  `readlink -f`, `journalctl -u companion --since 14:15`.
- Both manifests parsed directly; the id/version collision in §1c is measured, not inferred.
### Still NOT verified — and this WO stays open until it is

- **Step 2 — what the picker actually does** with two versions present. Companion has not been
  restarted: it is live show-control on a production box, and a restart is the owner's call, not a
  side effect of a repo change. Until someone runs
  `sudo systemctl restart companion` and looks at Connections → HighAsCG → version dropdown, the
  acceptance criteria are unproven. Two specific things to watch:
  1. whether the connection, pinned to `1.0.4` in `db.sqlite`, keeps loading the installed copy
     (expected — the pin must be changed, cf. WO-330);
  2. whether Companion 5.0.2 **hides** prerelease versions from the dropdown by default. If the
     dev entry does not appear at all, the fallback is to drop `--prerelease` from `package:dev`
     and keep only the version suffix — the stamping is what creates the second entry;
     `isPrerelease` is only the label on it.
- **Step 3 — make the loaded copy observable** (log the path the running module came from). Not
  attempted; it needs the same restart to test.
- **The module repo README is still uncommitted** there (untracked `README.md`), as WO-361 noted
  and [WO-368](./368_WO_shader_store_git_ownership.md) §3 records. `scripts/stamp-dev-manifest.js`
  and the `package:dev` change are likewise **uncommitted in the module repo** — that repo is not
  this one, and committing in it was not in scope here.
- What changed on the box: the module's **dev package** was rebuilt (`pkg/`, which is what the dev
  symlink points at) and now declares the dev version. The **installed** copy under
  `~/.config/companion/modules/` was not touched, and Companion was not restarted, so nothing
  running changed.
