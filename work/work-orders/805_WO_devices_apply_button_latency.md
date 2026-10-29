# WO-805 — Devices tab "Apply Caspar config (restart)" is too slow: where the time goes

**Status: OPEN (29.10) — investigation**
**Source:** owner 29.10: *"verify the apply and restart command stack and waits inside the button in the devices tab.
it seems to be a bit too slow."*
**Related:** [WO-440](./440_WO_apply_button_always_restarts_caspar.md) (button always sends `force:true`),
[WO-515](./515_WO_APPLY_LAYOUT_GUARD_AND_RESTART_COST.md) §3 / WO-516 (restart cadence; AMCP watchdog nudge),
[WO-398](./398_WO_RUNSH_1HZ_FORK_LOOP.md) (introduced the 10 s healthy poll in run.sh), WO-337 (unchanged gate,
operator-restart marker), WO-401 F6 (no xrandr forks on the request path).

No code was changed. Nothing was applied or restarted for this investigation: every number below is either read
from the journal of applies the owner already ran, or a read-only probe timed on the box.

---

## 1. Investigation

### 1.1 Godot side — the button

| step | file:line | what |
|---|---|---|
| button | `godot/client/features/devices/devices_toolbar.gd:20,75` | "Apply Caspar config (restart)" → `apply_pressed` |
| wiring | `godot/client/features/devices/devices_tab.gd:100` | `apply_pressed` → `CableGesture.apply_caspar` |
| handler | `godot/client/features/devices/cable_gesture.gd:358-372` | `busy`/`applying` on, ONE `await api.post_json("/api/caspar-config/apply", {"force": true})`, then status line. No timers, no sleeps, no reload, no second request. |
| progress | `cable_gesture.gd:376-382` | WS `log_line` `[Full apply] …` lines shown as "Applying: Step N" while it runs |
| HTTP timeout | `godot/client/core/api.gd:12,24` | `TIMEOUT_S := 15.0` on every pooled `HTTPRequest` |

The client adds no waits of its own. **But its 15 s HTTP timeout is shorter than the apply itself often is** (§2):
when the request passes 15 s, Godot reports *"server did not answer in time"* (`core/net_util.gd:21-22`), the button
shows an error and `restart_dirty` stays set, while the server keeps going and finishes the apply anyway.

### 1.2 Node side — the command stack

`POST /api/caspar-config/apply` → `src/api/router.js:99` → `src/api/routes-caspar-config.js:297-328` (`force:true`)
→ `applyCasparConfigToDiskAndRestart` (`routes-caspar-config.js:184`) → `applyFullServerConfig`
(`src/utils/full-config-apply.js:34`). The HTTP response is sent only when the whole chain below is done.

| # | step | file:line | waits / constants |
|---|---|---|---|
| 0 | operator-GUI port flags (WO-412), config save | `full-config-apply.js:45-64` | none |
| 1 | generate + atomic write `casparcg.config` (serialized mutex) | `full-config-apply.js:99-110`, `routes-caspar-config.js:83-177` | none |
| 2 | canvas check, then `applyX11Layout({live:false, persist:true})` | `full-config-apply.js:112-166` → `os-config-xrandr-apply.js:47` | custom-mode create via sync `xrandr --newmode/--delmode/--addmode` (`:170`, `xrandr-custom-mode.js:194-215`); `persistLayoutScript` (`:281`, sync `sudo -n install`, fails without sudo); **`writeSystemInventoryFile` (`:358`) — fully synchronous** |
| 3 | `applyX11Layout({live:true})` again, then `applyOperatorDisplaySession` | `full-config-apply.js:216-224` | same custom-mode create again; xrandr apply with retry (3 attempts × **600 ms** delay on failure, `os-config-xrandr-apply.js:28-42,292-316`); verify twice (`:321`, `:369`); **`writeSystemInventoryFile` again**; primary + `xdotool mousemove --sync` (timeout **5000 ms**, `x-display-session-runtime.js:142-155`); **NVIDIA policy script, blocking** (`x-display-session-runtime.js:166-169` → `nvidia-display-policy.js:54-64`, timeout **15 000 ms**; retry timer **20 000 ms** at `:172` only on failure) |
| 3b | `caspar-env` GL-sync file | `full-config-apply.js:227-234` | none |
| 4 | `reloadCasparAfterConfigWrite` | `full-config-apply.js:250-271` → `caspar-restart.js:364` | see below |
| 5 | NVIDIA policy again, **deferred** (fire-and-forget, after the response) | `full-config-apply.js:273-299` | retry after fixed **6000 ms** if the first run fails (`:285`); 30 s timeouts. Does not block the button. |

Step 4 in detail (`src/utils/caspar-restart.js`):

| wait | file:line | constant |
|---|---|---|
| write `/tmp/caspar-operator-restart` marker (run.sh fast-relaunch flag) | `:389-393` | — |
| AMCP `RESTART`, then `waitForAmcpDisconnect` | `:395-407`, `:139-147` | cap **4000 ms** (`HIGHASCG_CASPAR_APPLY_DISCONNECT_WAIT_MS`, `:248-253`), poll **250 ms** |
| "is it still up?" settle loop: `pgrep` + `ss` per tick | `:409-419` | up to **5 × 200 ms** |
| fast kill if still up (`caspar-kill-main.sh`) | `:420-429` | 12 s exec timeout + 5 s disconnect wait — not hit in recent applies |
| `systemctl is-active` | `:433` | — |
| `waitForAmcpReady` | `:449` → `:82-132` | cap **45 000 ms** (`:255-260`); poll **400 ms**; after port-up an extra `sleep(min(400,800))`; with `acceptPortListening` needs **3** consecutive port-up polls unless the client reconnects first |

And the part that is not in node at all — **run.sh, the Caspar supervisor** (`/bin/sh` = dash):

| wait | file:line | constant |
|---|---|---|
| hang detector around the running Caspar: `while kill -0 child; do …; sleep "$_poll"; done` | `run.sh:146-170` | **`_poll=10` while healthy** (`:151`, WO-398). The loop only notices the child has exited when the current `sleep 10` ends. |
| `caspar_ensure_fully_stopped` | `run.sh:221`, `casparcg-supervisor-lib.sh:208-218` | port-free poll 1 s; TERM/KILL sleeps only if stuck |
| hard-fail exit code → `caspar_clear_cef_cache` | `run.sh:225-227`, lib `:49-53` | Caspar segfaults on its way out after RESTART (journal: `Received signal 11 SEGV_MAPERR` after "Successfully shutdown", every apply), so exit 139 → the CEF cache is wiped on every Apply |
| operator marker → fast relaunch | `run.sh:231-238` | fixed **`sleep 1`** |
| grace | `run.sh:203-212` | skipped once by the marker (default 2 s) |
| pre-launch: `enforce-screen-consumer-policy.js` (a node start), `unmute-hdmi-audio.sh`, stray-main check | `run.sh:96-117` | up to 50 × 0.1 s pid wait (immediate here) |

### 1.3 Work done twice on one Apply

1. **`applyX11Layout` runs twice** (persist-only in step 2, live in step 3). Each run re-queries xrandr, re-creates the
   custom mode (both attempts fail with X `BadName`/`BadMatch` because the mode already exists — harmless, every
   time) and **writes the system inventory** (`os-config-xrandr-apply.js:358`). The persist call does not need the
   inventory at all.
2. **`writeSystemInventoryFile` is synchronous** and can build its payload twice in one call
   (`src/bootstrap/system-inventory-file.js:129,137` — when the device-graph boot sync reports `updated`, which it did
   today: `[device-graph] boot hardware sync applied in memory`). It enumerates PortAudio in-process
   (`naudiodon.getDevices()`, `audio/audio-devices.js:293-294`), ALSA, xrandr --verbose, NIC, DeckLink. It **blocks the
   node event loop** (WS, OSC, HTTP) for its whole duration, twice per Apply.
3. **NVIDIA display policy runs twice**: blocking inside step 3 (`applyOperatorDisplaySession`) and again deferred
   after the restart (step 5). `full-config-apply.js:21` says the policy must run after the restart because "xrandr/Caspar
   clear MetaMode", so the blocking pre-restart run is the redundant one.
4. `verifyXrandrMatchesLayout` twice inside the live call (`os-config-xrandr-apply.js:321` and `:369`) — cheap (~20 ms).

## 2. Measurements

### 2.1 How

- **Journal of real applies** (no apply was run): `journalctl -u highascg` `[Full apply]` / `[Caspar restart] Apply`
  lines, 88 applies since 03.09, parsed into per-step durations; `journalctl -u casparcg-server` for Caspar's own
  shutdown / start lines (exit → next start, 44 restarts since 01.10); `/tmp/caspar.log` (run.sh supervisor log,
  second resolution).
- **Read-only probes timed on the box** (`date +%s%N` around each): `xrandr --query` 13-14 ms, `xrandr --verbose` 13 ms,
  `ss -tln` 16 ms, `pgrep -af <config>` 13 ms, `systemctl is-active` 4 ms, `aplay -l/-L` 3/8 ms,
  `journalctl -k -n 400` 10 ms, `lspci -nn` 21 ms warm (1516 ms cold), `nvidia-settings -q CurrentMetaMode` 91-98 ms.
  `tools/runtime/highascg-nvidia-x-apply.sh` calls `nvidia-settings` ~15 times → ~1.1-1.4 s, matching the journal.
- **Not timed directly, and why:** the NVIDIA script itself (it assigns MetaMode / SyncToVBlank — changes the live
  display); `writeSystemInventoryFile` and `naudiodon.getDevices()` in isolation (writes the runtime inventory file;
  PortAudio enumeration opens ALSA PCMs and the DM3 is single-open); the apply itself (restarts Caspar). Those parts
  are timed from the journal stamps around them instead.

### 2.2 Today's Apply (29.10 10:14:07, the owner's), step by step — 16.10 s total

| t (s) | span | what | class |
|---|---|---|---|
| 0.00-0.03 | 0.03 | flags, generate + write casparcg.config | (a) |
| 0.03-0.16 | 0.13 | step 2: custom mode create (fails, X errors) | (c) duplicate of step 3 |
| 0.16-0.16 | 0.01 | persist apply-layout.sh (+ failed sudo install) | (a) |
| 0.16-1.32 | **1.16** | step 2: `writeSystemInventoryFile` (payload built twice) | (c) |
| 1.32-1.46 | 0.14 | step 3: custom mode create again | (c) |
| 1.46-1.55 | 0.09 | xrandr apply + verify | (a) |
| 1.55-2.15 | **0.60** | step 3: `writeSystemInventoryFile` again | (c) |
| 2.15-2.23 | 0.08 | primary output + pointer | (a) |
| 2.23-3.63 | **1.39** | NVIDIA policy, blocking (re-run after restart anyway) | (c) |
| 3.63-4.15 | 0.52 | AMCP RESTART → Caspar shut down (exits with SIGSEGV at 11.29) | (a) |
| (4.15-4.38) | (0.23) | node side, in parallel with the next row: disconnect wait + pgrep/ss settle loop | (b) small, overlapped |
| 4.15-~13.0 | **~8.9** | **Caspar process gone, run.sh still in `sleep 10`** — node logs `still waiting (5s)…caspar=stopped`, `(10s)…caspar=stopped`; run.sh logs the marker at `10:14:20` | (b) |
| ~13.0-~14.0 | **1.0** | run.sh marker `sleep 1` | (b) |
| ~14.0-14.58 | ~0.5 | pre-launch scripts (policy node script, unmute) + exec | (a) |
| 14.58-15.70 | 1.12 | Caspar boot → AMCP accepts (22.838) | (a) |
| 15.70-16.10 | **0.40** | node notices 0.4 s later (`waitForAmcpReady` poll sleep) | (b) |

### 2.3 Across all recorded applies

| | n | total mean | > 15 s (Godot timeout) | layout persist (step 2) | xrandr + op-session (step 3) | RESTART → exit | relaunch → AMCP back |
|---|---|---|---|---|---|---|---|
| since 03.09 | 88 | 13.14 s | **25** | 0.83 | 3.74 | 0.65 | **7.89** |
| since 17.10 | 33 | 14.67 s (median 13.27) | **12** | 0.95 | 3.83 | 0.86 | **9.02** |

Caspar exit → next "Starting CasparCG" (44 restarts since 01.10): **min 1.39 s, median 6.00 s, mean 6.47 s, max
18.26 s**. The floor (1.4 s = marker `sleep 1` + pre-launch) is reached only when the 10 s poll happens to wake just
after the exit; otherwise the wait is uniform in 0-10 s on top — exactly what a polled `sleep 10` produces. Caspar's
own boot (start → modules initialised) is 0.5-2.9 s, median ~1.3 s; it is not the slow part.

Step 3 occasionally takes 6-14 s (11 of 88 applies); not explained in this pass — candidates are the xrandr retry
loop (600 ms × 2) and the 5 s `xdotool --sync` timeout. Needs the `[OS-Config]` lines of one of those applies.

## 3. Cause ranking (by time, today's apply; means in brackets)

| rank | cause | today | typical | where |
|---|---|---|---|---|
| 1 | **run.sh notices Caspar's exit only when its 10 s healthy-poll `sleep` ends** | ~8.9 s | 0-10 s, mean ~4.6 s (exit→start median 6.0 s minus the 1.4 s floor) | `run.sh:151,169` |
| 2 | **Godot's 15 s HTTP timeout below the apply time** — not a wait, but it turns a slow apply into an apparent failure | — | 25/88 applies (12/33 recent) > 15 s | `godot/client/core/api.gd:12` |
| 3 | **System inventory written twice, synchronously** (blocks the event loop) | 1.76 s | ~1-2 s | `os-config-xrandr-apply.js:358` ×2 via `full-config-apply.js:166,217`; `system-inventory-file.js:129,137` |
| 4 | **NVIDIA policy blocking before the restart, then re-run after it** | 1.39 s | ~1.0-1.4 s | `x-display-session-runtime.js:166-169` (called from `full-config-apply.js:221`) |
| 5 | run.sh fixed `sleep 1` on the operator marker | 1.0 s | 1.0 s | `run.sh:237` |
| 6 | node AMCP-ready poll granularity | 0.40 s | 0-0.8 s | `caspar-restart.js:107,129` (`pollMs` 400) |
| 7 | custom xrandr mode re-created twice, failing each time | 0.27 s | ~0.3 s | `os-config-xrandr-apply.js:170` |
| 8 | post-RESTART settle loop / disconnect poll | 0.23 s | 0.2-0.5 s | `caspar-restart.js:406,415-419` |

**Accounted for today: 16.10 s** = (a) necessary work ~2.4 s (config 0.03, persist 0.01, xrandr 0.09, pointer 0.08,
Caspar shutdown 0.52, pre-launch ~0.6, Caspar boot 1.12) + (b) fixed waits that could be event-driven or shorter
~10.3 s (run.sh poll ~8.9, marker sleep 1.0, AMCP poll 0.4; the node settle loop overlaps the run.sh wait) + (c) work
done twice / on the wrong side of the restart ~3.4 s (inventory 1.76, NVIDIA 1.39, custom mode 0.27). The run.sh
split (poll vs marker sleep vs pre-launch) is bounded by the second-resolution supervisor log (±0.5 s); the sum is
exact from the node and Caspar journal stamps.

A realistic target with (b) and (c) fixed: **~3-4 s** from click to "Caspar restarted" (necessary work + Caspar's own
boot), about a quarter of today's 16 s.

## 4. Proposed fixes (per cause; none applied)

1. **run.sh: wake on Caspar's exit instead of on the next poll.** Keep WO-398's fork budget (10 s healthy poll), but
   make the foreground `wait` the child, not a `sleep`: run the hang detector as a background subshell that only
   watches and kills (writing a flag file so `run_caspar` can still return 5 on a hang), and `wait "$_child"` in the
   foreground — POSIX `wait` returns the moment the child exits, in dash too. Alternative with less restructuring:
   `trap ':' CHLD`, `sleep "$_poll" & wait $!` — a trapped SIGCHLD interrupts `wait` (POSIX), so the Caspar exit ends
   the sleep early; needs a dash test because the sleep's own exit also raises CHLD. Either way: test under `/bin/sh`
   with a fake child, keep the 90/180 s hang budgets, and note that **a running run.sh only picks the change up on a
   `casparcg-server` restart**. Saves 0-10 s, ~4.6 s mean, ~8.9 s today.
2. **Godot: give the Apply request its own long timeout** (e.g. 90 s — the server's own caps are 4 s + 45 s + 20 s),
   or make the route answer 202 at once and report completion over the WS (`log_line` already streams the steps).
   `Api` has one pool-wide `TIMEOUT_S`; a per-request timeout needs a small API change (set `r.timeout` per call), so
   this is not a one-line edit. Same check for `server_flow.gd:246` (`/api/replication/apply-device-view-caspar`).
3. **Inventory: once per Apply, after the live layout, off the request path.** Pass a `skipInventory` (or similar) to
   the persist-only `applyX11Layout` call, and run the remaining write after the response (or async). Also avoid the
   second `buildPayload` in `system-inventory-file.js:137` when only the device graph changed. ~1.2-1.8 s, and two
   event-loop stalls fewer.
4. **NVIDIA policy: skip the blocking pre-restart run on the Apply path** (`applyOperatorDisplaySession(…, {
   skipNvidia: true })` from `full-config-apply.js:221`), keep the deferred post-restart run (step 5), which is the
   one that sticks. ~1.4 s. Owner/QA check: no visible tearing window between restart and the deferred run.
5. **run.sh marker sleep 1 → 0** (or 0.2): the marker already proves an operator restart, the port-free wait follows
   it. ~1 s. One-liner, but it lives in the supervisor and needs a `casparcg-server` restart to take effect — leave it
   to the run.sh change in fix 1, not done here.
6. **Node AMCP-ready: event instead of poll** — resolve `waitForAmcpReady` on the connection's `connect` event (the
   WO-516 watchdog already reconnects within ~1 s; today the client connected at 22.838 and the wait noticed at 23.238).
   ~0.4 s.
7. **Custom mode: create it only once per Apply** (persist call records the plan, live call creates), and skip
   `--newmode` when the mode already exists in the `xrandr --query` output — removes the X error spam too. ~0.15-0.3 s.
8. Side finding, not latency: **Caspar segfaults on exit after every RESTART** (`Received signal 11` after
   "Successfully shutdown"), so run.sh treats each Apply as a hard-fail exit (139) and **wipes the CEF cache** each time
   (`run.sh:225-227`). Worth its own WO if HTML templates should keep their cache across Applies.

Expected after fixes 1-4: today's 16.1 s → ~5 s; after 1-7: ~3-4 s.

## 5. What was done

Nothing in code. Investigation and measurement only (owner asked for findings first).

## 6. What was VERIFIED

- Godot button path read end to end; one POST, no client waits; 15 s timeout confirmed in `core/api.gd:12`.
- Server path read end to end; every constant above quoted from source.
- Timings: 88 applies from the highascg journal and 44 Caspar restarts from the casparcg-server journal (scripts in the
  session scratchpad, not kept in the repo); today's apply traced line by line across node, Caspar and run.sh logs.
- Read-only probe timings on the box (§2.1).
- NOT verified: any fix; the 6-14 s step-3 outliers; the exact Caspar exit code (inferred 139 from the SIGSEGV + the
  hard-fail branch; the supervisor does not log it on the marker path).
