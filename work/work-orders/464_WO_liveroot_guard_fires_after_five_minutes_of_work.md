# WO-464 — `build-highascg-egg.sh` spends ~5 minutes before refusing a second produce

**Status: IN PROGRESS (early guard landed 2026-08-10; owner: reboot, then re-run the build)**

Owner (todos10.08): *"now eggs produce fails"* — the run ended with:

```
ERROR: eggs liveroot has LIVE system bind mounts under /home/eggs/liveroot — reboot before
produce (rm/umount there can erase /usr, /bin, …)
    /home/eggs/liveroot/home ← /dev/nvme0n1p2[/home] (ext4)
    /home/eggs/liveroot/home/casparcg/bridge ← /dev/nvme1n1p3 (exfat)
    /home/eggs/liveroot/home/casparcg/highascg/media/bridge ← /dev/nvme1n1p3[/media] (exfat)
Audit FAILED (1 error(s), 6 warning(s)). Fix before eggs produce.
```

## 1. Investigation

**The guard is correct and the build was right to stop.** `eggs produce --clone` bind-mounts the
live system under `/home/eggs/liveroot` and does not tear those binds down when it finishes, so
they were still present from the 12:21 build. `eggs-liveroot-safety.sh` refuses any further
produce while they exist because `rm`/`umount` through them operates on the real system — this
project already has `RECOVER_DESTROYED_USR.md` and `recover-host-usr-from-eggs-artifact.sh` in
the tree, so the failure mode is not hypothetical. **The operational rule is one produce per boot.**

Verified on the host: the three binds are present and propagate `private,slave`. Slave
propagation means a `umount` here would *probably* not propagate back to `/home` or
`/home/casparcg/bridge` — but `eggs-liveroot-safety.sh:91` explicitly says
`Do NOT run: umount -R … or rm -rf …` and names reboot as the safe fix. That rule was written
after the incident; it is not being second-guessed here, and the guard deliberately refuses
rather than attempting cleanup.

**The actual defect is *when* the build says this.** `build-highascg-egg.sh` only reached the
check at its own line 92, via `audit-eggs-clone-host.sh`. Everything in the transcript before the
error had already run: `apt-get install`, `npm ci` (271 packages), `npm run build:client` (vite),
`npm prune --omit=dev`, the Companion module rebuild and install, the Calamares branding sync and
verify, GRUB/storage/kernel-header package checks, and the systemd unit installs. That is roughly
five minutes of wall clock **and a mutated host tree** — the config reset, the exFAT sync, the
pruned `node_modules` — to report a condition that was already true when the operator pressed
enter.

## 2. What was done

`build-highascg-egg.sh` now sources `eggs-liveroot-safety.sh` and performs the same check at the
top, before the `/etc/highascg/nvidia-iso-driver` stamp and long before `prepare-…`. On a hit it
prints the offending mounts, names reboot as the fix, repeats the "do NOT umount -R / rm -rf"
warning with the reason, and exits 1 having changed nothing.

The check in `audit-eggs-clone-host.sh` is deliberately left in place — it still covers the case
where a produce is started by some other path, and the cost of the duplicate is a few
milliseconds.

## 3. What was VERIFIED to work

- The guard's predicate was executed against the host in its current state and fires, listing
  exactly the three bind mounts the failed build reported.
- `tools/smoke/smoke-wo464-liveroot-guard-runs-first.test.js` (new, registered) — **4/4 pass**.
  It asserts the guard exists and — positionally — that it precedes the nvidia stamp,
  `prepare-eggs-clone-with-exfat.sh`, the late audit, and `eggs produce --nointeractive`; that it
  refuses rather than cleaning up (no `umount -R`/`rm -rf` in the guard) and says reboot; and that
  the audit still carries its own copy.
  The ordering assertion initially failed because it matched the words "eggs produce" inside the
  guard's own comment rather than the invocation — pinned to `eggs produce --nointeractive`.
- `bash -n` clean. Full offline suite: **1924 pass / 0 fail / 2 skip** (1926 tests).

**Remains (owner):**

1. **Reboot this build host**, then re-run
   `sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh`.
2. The six warnings in the same audit are not blocking, but two are worth clearing first with
   `stop-and-unmount-wo47-for-eggs-produce.sh`: `/home/casparcg/bridge` and
   `/home/casparcg/highascg/media/bridge` are mounted during produce.
3. Note for the local gates: `prepare-…` runs `npm ci` then `npm prune --omit=dev --omit=optional`,
   so **any** build attempt — including one that fails at the audit — strips dev dependencies and
   the offline suite then dies with `Cannot find module 'acorn'`. `npm install --include=optional`
   restores it; that happened three times today.
