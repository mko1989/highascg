# WO-465 — `build-highascg-egg.sh` leaves the build host without its dev dependencies

**Status: DONE in repo (2026-08-10; effective on the owner's next build)**

Owner (todos10.08): *"add npm install --include=optional to the end of the build eggs script"*.

## 1. Investigation

`install-iso-defaults.sh:74-75` runs `npm prune --omit=dev --omit=optional` so the squashfs
carries production `node_modules` only — correct and deliberate (WO-47: the ISO ships production
deps). The problem is that the prune outlives the build. The build host is also the dev machine,
so the next `node tools/ci/run-offline-tests.js` dies at the first gate:

```
Error: Cannot find module 'acorn'
Require stack:
- /home/casparcg/highascg/tools/ci/check-tdz-reads.js
```

This happened **three times in one afternoon**, each time costing a confusing failure that looks
like a code regression before you remember the cause. Once it was after a build that **failed at
the liveroot audit** (WO-464) and never produced an ISO at all — `prepare-…` runs `npm ci` then
the prune early, so even an aborted build strips the tree.

Two constraints on where the restore can go:

- **After `eggs produce`.** The produce clones the live tree into the squashfs; anything
  reinstalled before that lands inside the ISO, undoing the prune's purpose.
- **As `casparcg`, not root.** The build runs under `sudo`. `npm` as root writes root-owned
  entries into `node_modules/` and `~/.npm`, which then EACCES the operator's next npm or test
  run — swapping one confusing failure for a worse one. `install-iso-defaults.sh:38` already
  established the pattern (`sudo -u casparcg -H bash -lc`), so this matches it.

## 2. What was done

`build-highascg-egg.sh`, in the post-produce restore block (next to the swap restore and the
exFAT remount), before the WO-462 completion sidecar:

```bash
echo "==> Restore dev dependencies on the build host (post-produce; does not affect the ISO)"
sudo -u "${USER_CASPAR:-casparcg}" -H bash -lc "cd '${REPO_ROOT}' && npm install --include=optional" \
	|| echo "WARN: npm install --include=optional failed — run it manually before the offline suite" >&2
```

Failure is a warning, not an error: the ISO is already built and verified by this point, and an
offline build host should still finish with a usable image rather than a non-zero exit.

The sidecar stays the literal last action, so WO-462's "existence of `<iso>.sha256` means safe to
copy" contract is unchanged — the restore costs a few seconds before that marker appears.

## 3. What was VERIFIED to work

- `tools/smoke/smoke-wo465-build-restores-dev-deps.test.js` (new, registered in
  `tools/ci/run-offline-tests.js`) — **5/5 pass**: the restore exists; it is invoked through
  `sudo -u "${USER_CASPAR:-casparcg}"` (asserted on the command line itself, ignoring comments);
  it is positioned after `eggs produce --nointeractive` and before the sidecar; and a failure
  warns rather than aborting.
- `smoke-wo462-iso-copy-race-guard.test.js` and `smoke-wo464-liveroot-guard-runs-first.test.js`
  re-run together — 9/9 — since both assert orderings in this same file.
- `bash -n` clean. Full offline suite: **1929 pass / 0 fail / 2 skip** (1931 tests).

Not executed end-to-end: the change only runs inside a real `sudo` build, which needs the reboot
owed from WO-464. The next build exercises it.
