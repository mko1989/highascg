# WO-501 — The Web-UI update killed itself: the helper runs inside the cgroup it stops

**Status: DONE in repo (13.08.2026 — 7 new smokes executing the real script, suite 2055/2053/0,
eslint 0 errors, prettier clean). NOT DEPLOYED: installed boxes run the copy in
`/usr/local/lib/highascg/`, which must be refreshed as root — §5.**
**Priority:** High (the update path is how every other fix reaches the box)
**Source:** owner 13.08: *"the update from gui failed. it stopped highascg before doing the update.
this needs a seperate process/script to be run that will do the update so its not killed by stopping
highascg which is needed for the update. also the script needs to restart highascg as soon as the
update is done."*
**Related:** [WO-499](./499_WO_GUI_UPDATE_LEAVES_BOX_DOWN.md) (the EXIT trap — necessary, and not
sufficient; see §2), [WO-455](./455_WO_gui_update_eacces_var_cache.md),
[WO-424](./424_WO_gui_update_flow_unbricked.md), [WO-500](./500_WO_PGM1_PLAYS_AT_73_PERCENT_GPU_SATURATED.md)
(the fix that was waiting on this path to ship).

---

## 1. Root cause

`src/system/server-update.js` launches the privileged helper as a child of the Node process:

```js
execFileAsync('sudo', ['-n', helper, '--source', extractDir], …)
```

Node runs inside `highascg.service`. **`sudo` does not change cgroup**, so the helper is a member of
`highascg.service`'s control group. Its very first action is:

```sh
stop_service() { … systemctl stop "$SERVICE"; }
```

systemd's default `KillMode=control-group` terminates **every process in the unit's cgroup** — which
now includes the helper issuing the command. The helper dies at the `systemctl stop` line:

- the apply never runs → the box is **not updated**;
- `start_service` is never reached → the box is **left stopped**;
- on `SIGKILL` the WO-499 EXIT trap cannot run either.

Exactly the owner's report: *"it stopped highascg before doing the update."*

## 2. Why WO-499's trap did not cover this

WO-499 fixed a real and different bug — a non-zero exit **after** `stop_service` skipping
`start_service` — with `trap restore_service_on_exit EXIT`. That trap only fires when the shell
exits normally enough to run it. Being killed as collateral of its own `systemctl stop` is not such
a path. WO-499 stays correct and stays in place; it is the safety net for *failures*, not for
*being killed*.

## 3. What was done

**`scripts/exfat/highascg-webui-server-update.sh` — new `--detach` mode.**
`detach_and_exit()` re-launches this same script inside a **transient systemd unit**:

```sh
systemd-run --unit="highascg-update-<stamp>" --collect \
  --property=StandardOutput="append:<log>" --property=StandardError="append:<log>" \
  "$SELF" --source "$src"
```

- `systemd-run` places the unit under `system.slice`, **outside `highascg.service`'s cgroup**, so
  stopping the service cannot reach it.
- **No `--wait`** — deliberately. Waiting would keep the caller alive inside the doomed cgroup and
  re-create the exact kill window this fixes.
- `--collect` reaps the unit once it exits.
- Output goes to `/var/log/highascg/update-<stamp>.log`, not the caller's pipe, because the caller
  is about to be killed. The Web UI reads it back after the service returns.
- The detached run is the ordinary attached flow, so it already stops, applies, stages, and
  **restarts the service** via `start_service` + the WO-499 trap — the owner's "restart as soon as
  the update is done" requirement needs no extra code.
- **Source validation runs BEFORE detaching**, so a bad request still fails synchronously with a
  usable error instead of vanishing into a unit.
- `LOG_DIR` is overridable via `HIGHASCG_UPDATE_LOG_DIR` (test seam only).

**No sudoers change is required.** `/etc/sudoers.d/highascg-webui-server-update` already grants the
helper with unrestricted arguments:
`casparcg ALL=(root) NOPASSWD: /usr/local/lib/highascg/highascg-webui-server-update.sh`
— so `--detach` is accepted, and `systemd-run` is invoked by the already-root script rather than
needing its own rule. This was checked with `sudo -n -l`, not assumed.

**`src/system/server-update.js`** passes `--detach`, parses the machine-readable handoff line
(`HIGHASCG_UPDATE_DETACHED unit=… log=…`), and reports a distinct **`detached`** phase with the
unit and log path rather than a false `done`. Its timeout drops 900 s → 120 s, since the call now
returns as soon as the handoff happens. If the line is absent — an installed box still running the
pre-WO-501 helper — it logs a warning instead of claiming success.

## 4. What was VERIFIED

`tools/smoke/smoke-wo501-update-detaches-from-service-cgroup.test.js` — **7 tests, all passing**,
registered in the curated CI list. Six execute the **real script** with `systemd-run`, `systemctl`,
and `id` stubbed on PATH (the WO-499 harness), so they pin shipped control flow, not a restatement:

- `--detach` invokes `systemd-run` and issues **zero** `systemctl stop` calls itself — the
  regression guard for the actual bug.
- the transient unit is `--collect`ed and **not** `--wait`ed on.
- output is redirected to a file (`StandardOutput=append:`), not the caller's pipe.
- the handoff line names both unit and log.
- an invalid `--source` fails **before** anything is detached.
- **without** `--detach` the WO-499 stop→apply→start flow is byte-for-byte unchanged.
- the Node side asks for `--detach`, parses the handoff, and reports `phase = 'detached'`.

Also: `bash -n` clean, `node --check` clean, and the non-root guard still refuses first.

Full offline gate **2055 tests, 2053 pass / 0 fail / 2 skip**; eslint 0 errors; prettier clean.

**NOT verified:** an end-to-end GUI update on the box. That needs the §5 refresh first, and the only
honest test is a real update — which is the next one the owner runs.

## 5. Owner action — refresh the installed helper (root)

Installed boxes execute `/usr/local/lib/highascg/highascg-webui-server-update.sh`, not the repo
copy. Until it is refreshed, the GUI update still self-kills. Same requirement WO-499 §5 raised, and
it is now cumulative — the installed copy predates both fixes.

```bash
sudo install -m 0755 -o root -g root \
  ~/highascg/scripts/exfat/highascg-webui-server-update.sh \
  /usr/local/lib/highascg/highascg-webui-server-update.sh
```

Then the next GUI update runs detached. Watch it survive the service stop:

```bash
journalctl -u 'highascg-update-*' -f      # or: tail -f /var/log/highascg/update-*.log
```

**Chicken-and-egg, stated plainly:** this fix cannot deploy itself through the broken updater. The
command above is the manual bootstrap; every update after it is detached.

## 6. Work log

- 2026-08-13 — Opened, root-caused to cgroup membership, `--detach` implemented via `systemd-run`,
  7 smokes, full gate green. Awaiting the §5 root refresh and a real end-to-end update.
