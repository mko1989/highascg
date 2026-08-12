# WO-499 — A failed Web-UI update left the playout box down

**Status: DONE (12.08 — 4 new smokes that execute the real script, suite 2039/2037/0). Installed boxes need the helper refreshed — §5.**

Owner 12.08: *"it seems the update process via gui fails. because it stopped the highascg process and
never started it back again. also this didnt get there — `scripts/runtime/remove-highascg-web-proxy.sh:
No such file or directory`"*.

Both symptoms are **one failure**. See §4 for the second one.

## 1. Root cause

`scripts/exfat/highascg-webui-server-update.sh` runs under `set -euo pipefail` and its `main()` is:

```
stop_service            # stops highascg.service
"$APPLY_SH" …           # the actual rsync into ~/highascg
stage_drop_to_volume …  # copy the drop to the exFAT stick
stage_drop_to_volume …  # …and the bridge volume
push_drop_config
start_service           # ← only reached if EVERYTHING above exited 0
```

There was no `trap`. **Any** non-zero exit after `stop_service` — a failed apply, a full disk, an
unmounted volume, an exFAT permission refusal — aborted the script with the service still stopped.
The box is then dark, with no operator UI, which is the one tool you would use to recover it.

## 2. The most likely trigger, and a second latent bug

`stage_drop_to_volume` ran:

```sh
rsync "${xtra[@]}" -rlptgoD --delete "${src%/}/" "${drop%/}/"
```

`-g` and `-o` ask rsync to preserve group and owner. **exFAT has no ownership**, so rsync attempts a
chown it cannot perform and exits **23**. This is a known trap on this box — the same flags broke the
stick seed scripts before. Under `set -e` that exit took down the whole update *after* the service was
already stopped, even though the server itself had by then been updated successfully.

## 3. What was done

- **`trap restore_service_on_exit EXIT`.** The service is restarted on *every* exit path when it was
  running beforehand, failure included, with a clear log line saying the update failed but the box was
  brought back. The non-zero exit code is **preserved** and still reaches the Web UI job log, so a
  failed update still reads as failed.
- **exFAT-safe staging:** `-rlpt --modify-window=2` (no `-goD`; exFAT timestamps are 2 s granular),
  and a failed stage now logs and returns 0.
- **Everything after the apply is best-effort.** Staging to removable volumes and the config push are
  conveniences; the server is already updated by then and none of it is worth failing for.

## 4. Why the file "didn't get there"

`scripts/runtime/remove-highascg-web-proxy.sh` **is** in the release tarball (verified:
`tar -tzf … | grep remove-highascg-web-proxy` → present, and `scripts/` is not in the rsync excludes).
It was missing on the box because the update aborted *at or before* the apply step, so `scripts/` was
never synced. One failure, both symptoms. Nothing extra to fix here — a successful update delivers it.

## 5. Installed boxes need the helper refreshed

The helper that runs is the **root-installed** copy at
`/usr/local/lib/highascg/highascg-webui-server-update.sh`, not the repo copy — so a box still running
the old one has the same bug even after taking this update. Chicken-and-egg: the broken helper is what
applies the fix.

After updating, refresh the root helpers once per box:

```
sudo bash scripts/exfat/install-exfat-systemd-units.sh
```

Recovery for a box that is down right now:

```
sudo systemctl start highascg
```

## 6. What was VERIFIED

`tools/smoke/smoke-wo499-update-always-restarts.test.js` — **4 tests**. The first three **execute the
real script** with `systemctl` and friends stubbed on `PATH`, so they exercise the shipped control
flow rather than a restatement of it:

1. apply fails → `stop` **and** `start` are both issued, and the log says the box was brought back;
2. apply succeeds → unchanged behaviour, `web UI update complete`;
3. the failing exit code (3) is preserved, not swallowed by the trap;
4. the staging rsync no longer passes `-goD` and is best-effort.

Writing them surfaced that `validate_source_path` only accepts `/var/cache/highascg/updates/*` or
`/tmp/highascg-updates/*` — an arbitrary temp dir is refused *before* the service is stopped, which is
worth knowing: the guard is why a malformed call is harmless.

Full offline gate → **2039 tests, 2037 pass / 0 fail / 2 skip**.

## 7. Repo hygiene incident, fixed in the same commit

The WO-498 commit used an unscoped `git add -A` and swept in **16 live-config files** that had been
dirty since before this session and were deliberately left alone until then — including
`config/device_graph.json` with **this box's 4 connectors**, which broke
`smoke-fresh-box-clean-device-view` (the guard that stops one box's hardware shipping to every box).
It also re-added `config/nginx/highascg-web-proxy.conf`, because exfat-sync restored that file on disk
between the `git rm` and the commit.

Reverted with `git restore --source=… --staged config/` so the **index** returns to the pre-session
baseline while the working tree — the live config this box is running — is left untouched. The nginx
conf is now in `.gitignore`, since the stick/bridge will keep resurrecting it.

`smoke-wo498`'s "proxy is gone" assertion was also wrong in kind: it checked the filesystem, which a
sync can repopulate. It now asserts on `git ls-files`, i.e. what the repo actually ships.
