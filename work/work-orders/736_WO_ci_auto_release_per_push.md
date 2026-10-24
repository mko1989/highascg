# WO-736 — CI: every green push to main becomes a server release the second server updates from

**Status: DONE (24.10.26) — smoke 3/3; CI run 40118333157 green in all four jobs; its release `2026-10-24_175927` is tagged at the pushed SHA b82c482a and .4 reports it as the available update.**

Owner, 24.10: *"id like to install automations on github actions, so each push gets a test for integrity and run
build release there, if possible. right now the development is quick and i want to be able to update second server
easily."*

## Investigation

- `.github/workflows/ci.yml` already tests every push: `verify` (repo integrity, 500-line limit, unwired exports, boot
  check, ESLint, Prettier, the offline suite under Xvfb, npm audit), `godot` (shm tests, Godot unit tests, boot
  check) and `build-client` (Vite build). "Each push gets a test for integrity" is therefore already in place; the
  release part was missing.
- Releases were built by hand (WO-687: a clean worktree on the box, `npm ci`, `build:client`,
  `make-github-release-server.sh`). The box's updater (`src/system/server-update.js:202-226`) takes the newest
  non-draft release, prerelease included, that carries `highascg-server_*.tar.gz`, and compares its stamp with
  `BUILD_STAMP`. Any such release reaches Settings → Updates.
- `gh release create` without `--target` tags whatever the default branch points at. In CI a later push could already
  have moved main, so the tag would not be the commit that was tested.
- The desktop operator builds (`godot/export-client.sh`) need the Godot export templates (about 1 GB) and minutes of
  exporting. They are not needed to update a server: its kiosk runs `godot/client` from the tarball (WO-735).
- About 50 MB per release × every push means the release list needs pruning.

## What was done

- `ci.yml` job `release`: `needs: [verify, godot, build-client]`, only for `push` to `main`, `contents: write`,
  serialized (`release-main`, never cancelled). It runs `npm ci --include=optional`, `build:client`,
  `make-github-release-server.sh --no-godot-clients` with `RELEASE_TARGET=$GITHUB_SHA` and `GH_TOKEN`, then
  `prune-auto-releases.sh 10`.
- `tools/release/release-lib.sh`: `RELEASE_TARGET` → `gh release create --target`.
- `tools/release/prune-auto-releases.sh`: keeps the newest 10 automatic server prereleases (a server tarball, no
  `highascg-operator_*` asset) and deletes older ones with their tags. Manual releases (operator builds attached),
  full releases and the Caspar / scanner / CEF releases are never selected. Checked read-only against the live list
  first: it selected nothing.
- `tools/smoke/smoke-wo736-ci-release.test.js` (in FILES): pins the job's guards, the target, the prune's selection
  and the tarball's `godot/client`.

## What was VERIFIED

- Smoke 3/3; `smoke-wo367-wiring-gates` 9/9 and `smoke-release-package-bump` 1/1 (both read ci.yml / the release
  scripts) still pass.
- First run (push of b82c482a, CI run 40118333157): verify, godot, build-client and release all succeeded. The log
  shows `Release: …/releases/tag/2026-10-24_175927` and `automatic server prereleases: 1 (keeping 10)`.
- `git ls-remote` puts tag `2026-10-24_175927` on b82c482a, the tested commit. It is a prerelease with
  `highascg-server_2026-10-24T175927Z.tar.gz` (49.9 MB) and both starter zips.
- Downloaded back: 9901 entries, the same as the hand-built WO-735 release. They include 631 `godot/client/` files,
  `dist-web/`, `node_modules/` with the serialport linux-x64 prebuilds, no `.godot/` or `.uid` files, and no
  identity, cert or tailscale config.
- `.4` `GET /api/system/update/check?force=1` → `latest 2026-10-24T175927Z, updateAvailable: true`.
- Note: a docs-only push also makes a release. That is harmless (the newest 10 are kept) and keeps the rule simple.
