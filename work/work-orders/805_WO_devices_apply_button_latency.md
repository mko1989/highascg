# WO-805 — Devices tab "Apply Caspar config (restart)" is too slow: where the time goes

**Area:** devices-config
**Status: DONE (29.10, live: two Applies measured on the box — AMCP accept→back 52-55 ms, no xdotool stall, NVIDIA deferred once, XVideoSyncToDisplayID = DP-4 after the heredoc fix, 5.16 s click→NVIDIA done; fast-kill race found live and fixed offline with a negative control). Owner eye: PGM blink in the NVIDIA window; decision whether Apply should restore PGM**
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

---

## Fix (29.10, Opus)

Scope (owner): §4 fix 1 + fix 5 (run.sh exit detection, marker sleep) and §4 fix 3 (inventory once per Apply).
NOT in this pass: the NVIDIA policy ordering (§4 fix 4, `x-display-session-runtime.js` / step 3 — separate pass),
the Godot timeout (fix 2), the AMCP-ready poll (fix 6), the custom mode (fix 7).

### Findings written before the change

**F1 — run.sh sees Caspar's exit up to 10 s late.** `run.sh:147-171`: the hang detector IS the foreground loop
(`while kill -0 "$_child"; do … sleep "$_poll"; done`), and `_poll=10` once AMCP is up (`:152`). The exit is only
noticed when the current `sleep 10` (`:170`) returns. Before: exit → noticed 0-10 s later (today ~8.9 s).
After (planned): the detector moves to a background watcher (`caspar_hang_watch`, same 1 s / 10 s polls, same
`CASPAR_HANG_SEC` 90 / `CASPAR_BOOT_HANG_SEC` 180 budgets, same TERM → 2 s → KILL), and the foreground does
`wait "$_child"` — POSIX `wait` returns the moment the child exits (dash included). A hang is reported back
through a flag file so `run_caspar` still returns 5. The watcher is stopped with TERM; its trap kills its own
`sleep` so no orphan sleeps stay behind. Fork budget unchanged (one `ss|grep` + one `sleep` per poll, as WO-398).
The functions go into `tools/runtime/casparcg-supervisor-lib.sh` so a test can source them with a stub child.

**F2 — the marker `sleep 1` is not needed for the port.** `run.sh:237-238`. By the time it runs:
`caspar_ensure_fully_stopped` (`run.sh:222`, lib `:207-217`) has already waited until `ss -tln` shows no
listener on :5250 and no Caspar main/CEF process is left (TERM/KILL otherwise); the loop top runs
`caspar_wait_amcp_port_free` again (`run.sh:202`); `run_caspar` waits up to 5 s for a stray main (`:113-118`).
TIME_WAIT sockets cannot block the rebind: Caspar's AMCP acceptor is
`tcp::acceptor(io, tcp::endpoint(tcp::v4(), port))` (`~/caspar-build/src-v2/src/protocol/util/AsyncEventServer.cpp:285`),
whose Boost constructor defaults `reuse_addr = true` (SO_REUSEADDR). Before: fixed 1.0 s. After: 0 (removed).

**F3 — inventory written twice per Apply.** `full-config-apply.js:166` (`applyX11Layout({live:false, persist:true})`)
and `:217` (`{live:true}`; `:202` on the nodm path) both reach `os-config-xrandr-apply.js:356-366` →
`writeSystemInventoryFile`. The persist-only call changes nothing on X, so its inventory is the same as the one the
live call writes ~0.1 s later. Before: 2 writes per Apply. After (planned): `applyX11Layout(…, {skipInventory:true})`
on the persist-only call; the live call writes it once. Other callers (`os-layout-watchdog`, `settings-os`,
`system-hardware-xrandr-layout`, `boot-screen-assignment`) call applyX11Layout once and keep their write.

**F4 — payload built twice in one call.** `system-inventory-file.js:129,137`: when
`ensureDeviceGraphHardwareSyncFromLive` reports `updated`, `buildPayload(config)` runs again (all hardware probes:
xrandr, DRM, PortAudio, ALSA, DeckLink log, NIC). The sync only changes `config.deviceGraph`
(`device-graph-boot-sync.js:45`), and no field of the payload reads `deviceGraph` (grep: `buildPayload` →
`hardware-info`, `gpu-physical-map`, `gpu-topology-*`, `hardware-identity`, `decklink-enum`, `audio-devices` —
none reference it; `cm.save` gets a spread copy, `config` itself is not replaced). On the Apply path no configManager
is passed, so the sync is never persisted and the first applyX11Layout call of every Apply that edited the device
graph pays the double build. Before: 2 builds. After (planned): 1 build, written as is → same bytes.

Timed on the box BEFORE the change (standalone `writeSystemInventoryFile(log, config)` exactly as the Apply path
calls it, real hardware, output to a scratch path, config saves stubbed; script
`scratchpad/wo805/time-inv.js`): single build **466-560 ms**, with the device-graph update (double build)
**953-1052 ms**. One Apply today = double + single ≈ 1.4 s standalone (journal 29.10: 1.16 + 0.60 = 1.76 s).

### What was done

| file | lines | change |
|---|---|---|
| `tools/runtime/casparcg-supervisor-lib.sh` | 305 (+63) | new `caspar_hang_watch` (the WO-398 detector, unchanged logic, run as a background watcher; touches the flag before its TERM → 2 s → KILL sweep; TERM trap kills its own pending `sleep`) and `caspar_wait_child_or_hang` (`wait "$child"` in the foreground; stops the watcher on a normal exit, lets it finish its sweep and returns 5 on a hang; fd 9 closed in the watcher) |
| `run.sh` | 221 (−29) | `run_caspar`: the foreground `while kill -0 … sleep "$_poll"` loop → `caspar_wait_child_or_hang "$_child"`; marker branch: fixed `sleep 1` removed (F2), log text `fast relaunch (grace skipped)` |
| `src/utils/os-config-xrandr-apply.js` | 386 | inventory write gated on `opts.skipInventory !== true` |
| `src/utils/full-config-apply.js` | 320 | persist-only call passes `skipInventory: true` |
| `src/bootstrap/system-inventory-file.js` | 178 | `buildPayload` once; the post-sync rebuild removed (F4) |
| `tools/smoke/smoke-wo400-supervisor-cleanup.test.js` | 77 | WO-398 assertions repointed to `caspar_hang_watch` in the lib (same assertions) + run.sh must delegate to it |
| `tools/smoke/smoke-wo805-supervisor-exit-wait.test.js` | 198 | new, /bin/sh + stub Caspar (node script listening on a free port), temp CASPAR_ROOT |
| `tools/smoke/smoke-wo805-inventory-once.test.js` | 190 | new, mocked probes, frozen clock, golden bytes |
| `tools/ci/offline-test-files-2.js` | 29 | both new tests in the curated list |

Why a background watcher and not `trap ':' CHLD` + `sleep & wait`: the watcher keeps the WO-398 loop byte-for-byte
in logic, the foreground `wait` on one pid is plain POSIX with no signal subtleties, and it is testable by sourcing
the lib. Cost: one extra `/bin/sh` process per Caspar run; fork rate unchanged.

### What was VERIFIED

- **Offline suite** `node tools/ci/run-offline-tests.js`: **3490 tests, 3488 pass, 0 fail, 2 skipped** (baseline
  3480 / 3478 / 0; +10 new). `check-max-file-lines`: 0 over 500. `sh -n` run.sh + lib: OK. eslint on the changed JS:
  no new findings (one pre-existing warning, `readCreateMissingModes` unused). `format:check`: clean.
- **Supervisor tests (stubs, /bin/sh = dash):** exit at 2.5 s while AMCP is up (watcher in its `sleep 10`) →
  `caspar_wait_child_or_hang` returns 139 at ~2.6 s, all supervisor `sleep` pids dead afterwards; boot hang
  (`CASPAR_BOOT_HANG_SEC=2`) → stub killed, returns 5, log `hang (2s, amcp_seen=0)`; AMCP drop after up
  (`CASPAR_HANG_SEC=2`) → returns 5 after the ≤10 s healthy window (13.1 s), log `amcp_seen=1`; full run.sh with
  the stub returns with the stub's code at **2.59 s**. **Negative control:** the same e2e test against the
  pre-change run.sh + lib (`git show HEAD:`) took **11.1 s** and failed.
- **Inventory tests:** both full-apply paths (canvas fits, nodm) call applyX11Layout twice, only the live call
  writes; with the device-graph update every probe runs once (old module: twice — same test against the pre-change
  copy); file bytes equal the golden with and without the update, and the pre-change module produces the same golden.
- **Inventory on real hardware** (standalone, same call as the Apply path, 4 runs each, after node restart of the
  code): single build 472-581 ms before and after; device-graph-update case **953-1052 ms before → 472-558 ms
  after**. All four output files (before/after × update/no update) are identical apart from `collectedAt`
  (md5 of the rest `8c8d1a9c…`). Per Apply: ≈1.43 s (double + single) → ≈0.5 s (one single), journal-equivalent
  1.76 s → ~0.6 s. There is no HTTP route on the read side that triggers the write (`GET /api/device-view` only
  reads the file), so it was timed standalone.
- **Node** restarted (`kill -TERM`, 12:31): startup wrote the inventory once, API 200, no errors.
- **Real Caspar, operator-style restart** (marker `/tmp/caspar-operator-restart` + AMCP `RESTART`, i.e. the Apply's
  step 4 only — no config, display or output change; timed by a 10 ms `/proc` poll, script `scratchpad/wo805/op-restart.js`):

  | supervisor | Caspar exit → new main started | RESTART → AMCP listening again |
  |---|---|---|
  | old run.sh (2 runs, 12:31-12:32) | 5094 ms, 2760 ms | 7108 ms, 5215 ms |
  | new run.sh (3 runs, 12:33, after `systemctl restart casparcg-server`) | **252, 257, 256 ms** | **2221, 2116, 2649 ms** |

  The remaining ~0.25 s is the pre-launch helpers (screen policy node script + HDMI unmute). Watcher seen live as a
  `/bin/sh run.sh` child of the supervisor with one `sleep 10`; no stray sleeps after the restarts; node reconnected
  (WO-516 watchdog) and re-applied state each time.
- **NOT verified:** a full Apply from the Devices tab (not clicked; owner QA) — expected saving ≈ 8-10 s of run.sh
  wait + ~1 s marker sleep + ~1.2 s inventory on today's 16.1 s trace; a real hung Caspar on the box (covered only
  by the stub tests); the NVIDIA ordering, Godot timeout, AMCP-ready poll and custom-mode items (not in this pass).

---

## Fix 2 (29.10, Opus) — NVIDIA ordering, xdotool `--sync`, AMCP-ready wake, Godot timeout, custom mode

Scope (owner): the four items left open by the first pass (§4 fixes 4, 2, 6, 7). Not clicked live: another agent was
running PGM tests; no node/Caspar restart, no Apply, no touch of the Godot client on :0.

### Findings written before the change

Post-fix-1/3/5 live Applies today (POST → "AMCP back"): 12:42 **4.71 s**, 13:14 **6.12 s**, 13:15 **10.86 s**.
The 13:14 one, step by step: custom mode (step 2) 0.57 s · live xrandr 0.5 s · inventory 0.55 s · primary + pointer
0.07 s · **NVIDIA blocking 1.42 s** · RESTART → "waiting" 0.76 s · relaunch → back 2.1 s · (deferred NVIDIA after the
answer 1.38 s).

**N1 — the NVIDIA policy runs twice per Apply, the first one blocking.** `full-config-apply.js` (HEAD :208 / :222)
called `applyOperatorDisplaySession`, which ran `applyNvidiaDisplayPolicy` synchronously
(`x-display-session-runtime.js` HEAD :166-169, `tools/runtime/highascg-nvidia-x-apply.sh`, ~15 `nvidia-settings`
calls). Then the deferred run after the restart (HEAD :274-282) did it again. Blocking run 1.33-1.58 s since 17.10
(0.4-0.6 s in September); deferred run 1.0-1.41 s. The pre-restart run cannot stick: the restart's own xrandr/Caspar GL
init is what the deferred run re-asserts. **Bug found on the way:** the deferred run used the bare
`displaySessionEnv()` (HEAD :282). It lacked `HIGHASCG_NVIDIA_SYNC_OUTPUT`, so the one run that sticks never set
XVideoSyncToDisplayID for a ticked "NVIDIA sync to display" port (a read-only query showed -1 with port 3 / DP-4 ticked).
Also, HEAD gated the deferred run on `preApplied || postApplied` only; a live xrandr call that ran but did not verify
(it may still have reset MetaMode) got no NVIDIA run at all.

**N2 — `xdotool mousemove --sync` loses exactly 5 s when the pointer is already there.** `--sync` waits for a pointer
MOTION event; a warp to the current position produces none, so xdotool sits until the 5 s execFile timeout
(`x-display-session-runtime.js` HEAD :155; also the apply-layout.sh line HEAD :105 and
`x-display-session-gui-windows.js` HEAD :21). Reproduced on a private Xvfb :97: same position → rc 124 after
**4006 ms**, any other move ~33 ms. Journal: of the 79 Applies since 03.09, **6 had step 3 over 5 s**. Four were this
xdotool failure after exactly 5 s (17.10, 21.10, 25.10, 29.10 13:15; the 13:15 Apply came 30 s after a successful
park, so the pointer was already at the centre). The other two were NVIDIA script retries (4.4-4.5 s). The journal holds
139 xdotool failures since 01.09 (startup included). WO-337's comment already notes that a second concurrent `--sync`
loses 5 s. Nothing after the warp reads the pointer position, so `--sync` buys nothing.

**N3 — AMCP-ready noticed 0.44-0.76 s late.** `caspar-restart.js` HEAD :82-129, `waitForAmcpReady` with `pollMs`
400: the port poll (`ss -tln`) every 400 ms, then on port-up a reconnect nudge followed by a **fixed**
`sleep(min(pollMs, 800))` (HEAD :107). The client connects within ms of the nudge, but the wait only looks again
after that sleep. Journal: Caspar "Initialized controllers" → AMCP accept 0.04-0.36 s; accept → node
"AMCP back" **exactly 0.40 s every time** (12:42, 13:14, 13:15, 10:14); listen → back 0.44-0.76 s.

**N4 — Godot gives up at 15 s while the server is still working.** `godot/client/core/api.gd` HEAD :15
`TIMEOUT_S := 15.0` is pool-wide. The server's own waits cap near ~100 s (RESTART, kill, 45 s AMCP wait, retry). Before
fixes 1/3/5, 25 of 88 Applies took over 15 s. The client then reported "no answer" while the server finished the Apply
fine. The node relay (`cluster-relay.js` HEAD :18, 14 s) has the same cap for a linked server's Apply. There are two
callers: `features/devices/cable_gesture.gd:364` (Devices Apply) and `features/devices/server_flow.gd:246`
(hot-backup `apply-device-view-caspar`).

**N5 — the custom mode is re-created on both layout calls of every Apply and always fails on NVIDIA.**
`os-config-xrandr-apply.js:170` → `xrandr-custom-mode.js` `tryAddXrandrModeFromCvt` (HEAD :187): `cvt` +
`--newmode` (BadName, the mode already exists) → strip → `--newmode` → `--addmode` (**BadMatch: NVIDIA refuses RandR
user modes**) → `--delmode` + `--addmode` → null → falls back to the EDID 3840x1792. Per attempt min 30 / median 139 /
mean 205 / max **804 ms** (n = 36 since 01.10), ×2 per Apply. The strip (HEAD :125) also **switches the live output to
the first listed WxH** before `--rmmode`. Here that happens to be the current mode. On a rig whose first listed mode
differs, it is a real modeset of a live output on every Apply. The mode it strips is not even attached: on this box
`3840x1792_50.00` dangles unattached, while DP-0's EDID already lists 3840x1792@50.

### What was done

| file | lines | change |
|---|---|---|
| `src/utils/full-config-apply.js` | 337 | both `applyOperatorDisplaySession` calls pass `skipNvidia: true` (:221, :236); the deferred run is the only NVIDIA run, its env is `xDisplaySession.nvidiaPolicyEnv(ctx.config)` (:297, falls back to `displaySessionEnv()`), and it also runs when the live xrandr command ran unverified (:288 `… \|\| out.layout.postXrandrCommand`). Sandbox guard after the config write (:117, see side finding) |
| `src/utils/x-display-session-runtime.js` | 216 | `opts.skipNvidia` (:183, logs "deferred until after the Caspar restart (WO-805)"); new exported `nvidiaPolicyEnv(config, env)` (:126) shared by both runs; `--sync` dropped from the xdotool argv (:172) and the apply-layout.sh line (:106) |
| `src/utils/x-display-session-gui-windows.js` | — | `parkPointerOnOperatorDisplay` without `--sync` (:22) |
| `src/utils/caspar-amcp-wait.js` | 162 (new) | the AMCP wait helpers moved out of caspar-restart.js (it was at 500 lines). `sleepUntilConnected` (:64) checks the connected property every 25 ms, and both sleeps in `waitForAmcpReady` wake on it (:113, :135). New opts: `portStableMs` (the port-up-but-no-client fallback now also needs the port up this long, so a faster poll cannot shorten that window, :114) and an injectable `isPortListening` (tests) |
| `src/utils/caspar-restart.js` | 403 | imports + re-exports the helpers (same names); `APPLY_AMCP_POLL_MS = 150`, `APPLY_PORT_STABLE_MS = 2000` (:22-23) passed by `reloadCasparAfterConfigWrite` (:279-280). 2000 ms keeps the old 3 × 400 ms + margin |
| `src/cluster/cluster-relay.js` | 104 | `LONG_TIMEOUT_MS = 110_000` for `/api/caspar-config/apply` and `/api/replication/apply-device-view-caspar` only (:21-22, :94); other requests keep the 5-argument call / 14 s |
| `godot/client/core/api_timeouts.gd` | 14 (new) | `TIMEOUT_S` 15, `APPLY_TIMEOUT_S` 120, `request_timeout()`, all without autoload dependencies (preloading `core/api.gd` from a feature script breaks the headless test runner: `Config` is an autoload) |
| `godot/client/core/api.gd` | 135 | constants from api_timeouts.gd; `post_json` / `request` / `_send` take `timeout_s := 0.0`, `_send` sets `r.timeout = request_timeout(timeout_s)` (:84), and a pooled node goes back to `TIMEOUT_S` on release |
| `godot/client/features/devices/cable_gesture.gd` | — | Devices Apply POST with `ApiScript.APPLY_TIMEOUT_S` (:366); doc comment updated |
| `godot/client/features/devices/server_flow.gd`, `server_controls.gd` | — | hot-backup apply POST with `APPLY_TIMEOUT_S` (:248); the `_Io` adapter forwards `timeout_s` |
| `src/utils/xrandr-custom-mode.js` | 289 | `lastCreateOutcome` per `output\|mode\|timings` (:196). When this process already tried and X still shows that result (`xrandrQueryListsMode` on the caller's `xrandr --query`, :199), there are two cases. If the mode is on the output, it is reused. If it only dangles (`--addmode` was refused before), it is not retried, with an info line. Either way no X call is made (:219-231). A restarted X server has no user modes, so the mode is created again. The strip of an **unattached** mode is `--rmmode` only, with no switch-away modeset and no `--delmode` (:128) |
| `src/utils/os-config-xrandr-apply.js` | — | passes `queryText: xrandrQueryOut` (:179) |
| tests | | `tools/smoke/smoke-wo805-amcp-ready-wake.test.js` (6), `smoke-wo805-apply-nvidia-deferred.test.js` (7), `smoke-wo805-custom-mode-once.test.js` (5), all registered in `tools/ci/offline-test-files-2.js`; `godot/client/tests/test_wo805_apply_timeout.gd` (new); `test_devices_server_page.gd` FakeIo records the timeout per path and the replay asserts 120 s for the apply and 0 (default) for every other POST |

**Rejected:** running the NVIDIA policy concurrently with the Caspar restart. It would hide the remaining ~1.4 s, but
it races Caspar's GL init on the same heads (unknown effect on FCP/MetaMode). Moving it after the answer gets the same
saving on the button without that risk. Also rejected: a 202 + WS completion for the Apply (more client work; the
long timeout fixes the false failure).

**Side finding (fixed): sandbox Apply hits the live box.** `HIGHASCG_SANDBOX=1` (tools/e2e) still ran every step
after the config write against the LIVE display and Caspar: nodm restart, xrandr `--primary`, pointer, NVIDIA on :0,
the /tmp operator marker, and a fast kill based on `ss` seeing the live :5250. It now returns `step: 'sandbox'` right
after the write (`full-config-apply.js:117`). That is also why no sandbox e2e timing was run for this pass.

### What was VERIFIED

- **Offline suite** `node tools/ci/run-offline-tests.js`: **3622 tests, 3620 pass, 0 fail, 2 skipped** (baseline at
  the start of this pass 3575/0/2; +18 new here, the rest from parallel WOs). `check-max-file-lines`: 0 over 500.
  eslint on all touched JS: 0 errors; the 2 warnings are pre-existing unused imports on untouched lines.
  `format:check`: clean. `check-unwired-exports`: no new orphans (the 4 listed belong to WO-801/WO-821).
- **Godot** `run_tests.gd`: **22809 passed, 0 failed** (baseline 22750; includes the new test file and the
  server-page timeout assertions). The first run caught the autoload problem: preloading `core/api.gd` from
  server_flow.gd failed to compile under the `-s` runner. That is why `core/api_timeouts.gd` exists. `api.gd` (which
  the runner never compiles) was compile-checked with `--check-only` on a copy with `Config` stubbed: clean.
- **Negative control:** the three new smokes run against a `git archive HEAD src` copy fail **15 of 18** (the AMCP
  file fails to load, the NVIDIA/relay file fails 7/7, custom-mode fails 3/5). The 3 that pass are the "restarted
  X re-creates" and "no queryText keeps the old path" compatibility cases, which are meant to pass on both.
- What the smokes prove: AMCP back ≤ one 150 ms poll + the connect after the port comes up; with a 400 ms poll a
  connect wakes the wait in ~25 ms, where it used to take a fixed 400 ms; the no-client fallback is not earlier than
  `portStableMs`. Apply order: write → persist → live → display session (skipNvidia) → restart → NVIDIA once with
  `HIGHASCG_NVIDIA_SYNC_OUTPUT`, on both the canvas-fits and the nodm path. The real `applyOperatorDisplaySession`
  sends `xdotool mousemove <x> <y>` without `--sync`. Custom mode on a fake NVIDIA X: tried once in 4 runs, no
  `--output … --mode` on the live output; on an accepting driver it is created once and reused.
- xdotool: private Xvfb :97 (above), `--sync` same-position 4006 ms (rc 124) vs ~33 ms without `--sync`.
- **Node live:** another agent restarted highascg at 19:32:58, which loaded this code. API 200, no errors from these
  files. Its xrandr retry loop ("cannot find mode 5760x1728", 19:33:03-19:33:20) is the OS-watchdog re-applying a
  loaded project's EDID-source plan (`source=edid` in the log). It does not go through the custom-mode code and is
  unrelated.
- **NOT verified:** a full Apply on the box (not clicked: live PGM tests by another agent). Owner QA: after the
  restart, Force Composition Pipeline now arrives ~1-1.4 s after Caspar is back (deferred only). Watch for a blink or
  tearing on PGM in that window.

**Expected effect** on the 13:14 trace (6.12 s): −1.42 s NVIDIA, −~0.4 s AMCP wake, −0.57 s custom mode (both calls
skipped once this node process has tried the mode; the first Apply after a node start pays one attempt) ≈ **~3.7 s**.
The 5 s xdotool outliers (4 of 79 Applies) are gone. The button no longer reports a timeout on a slow Apply (up to
120 s).

### Live measurement plan (next round, owner or a session allowed to click Apply)

`journalctl -u highascg -u casparcg-server -f -o short-precise`, click Apply in Devices, then read off:

1. click → `[Full apply] Step 1` (client → server latency).
2. `Step 3` → `Step 4`: expect ~0.6-0.8 s. There must be **no** `xdotool mousemove failed`, and there must be a
   `NVIDIA policy deferred until after the Caspar restart (WO-805)` line.
3. `custom mode … reused (WO-805)` / `… not retried (WO-805)` on the 2nd layout call (and both calls from the 2nd
   Apply on); no `--newmode failed` spam.
4. `Step 4 — reload Caspar` → `waiting` → Caspar `Initialized controllers` → AMCP accept → node `AMCP back`:
   expect accept → back **≤ 0.2 s** (was exactly 0.40 s).
5. `AMCP back` → `NVIDIA display policy applied (deferred)`: ~1-1.4 s; and check `nvidia-settings -q
   XVideoSyncToDisplayID` shows the ticked port's display (was -1).
6. Outputs back: Caspar screen consumer initialized / PGM visible on the LED head (stopwatch or the WO-805 /proc
   script).
7. Godot: the button returns to idle with the server's status message, **no timeout toast**, total time noted.
8. PGM blink / tearing between "AMCP back" and the deferred NVIDIA line (owner eye).

## Live measurement (29.10, live e2e session — two Applies clicked in Godot Devices on :0)

`journalctl -u highascg -u casparcg-server -f -o short-precise` running; node restarted 20:04:36 (pid 1185314) with this
code. Evidence: scratchpad `live-e2e/j805.txt`, `q805_done.png`, `full805_after*.png`, `full805b_retake.png`.

| Plan item | Apply 1 (20:06:18, first after node start) | Apply 2 (20:10:55, after the fixes below) |
|---|---|---|
| 1. click → `POST …/apply` / Step 1 | 19 ms / 20 ms | ~35 ms (click logged 55.020, POST 55.053) |
| 2. Step 3 → Step 4 | 1.59 s | **0.74 s** |
| 2. `xdotool mousemove failed` | 0 | 0 |
| 2. `NVIDIA policy deferred … (WO-805)` | present (19.841) | present (55.827) |
| 3. custom mode lines | none (planned layout fits the canvas, no mode needed) | none |
| 4. Caspar `Initialized controllers` → node `AMCP back` | 27.050 → 27.105 = **55 ms** | 58.580 → 58.632 = **52 ms** |
| 5. `AMCP back` → `NVIDIA … applied (deferred)` | 1.42 s | 1.55 s |
| 5. `XVideoSyncToDisplayID` after the Apply | **-1 (FAIL, bug 1)** | **4 = DP-4, the ticked port 3** (set to 0 before the click as a marker) |
| 6. Screen consumer back on ch 1 | yes (INFO 1: port_501 portaudio, port_600 screen, port_741 shm) | yes, same list |
| 7. Godot status | "Config written; layout applied; Caspar restarted.", no toast | same |
| Total click → NVIDIA done | **10.36 s** (≈4 s lost to bug 2) | **5.16 s** |

### Bug 1 — XVideoSyncToDisplayID was never set (found live, fixed)

The deferred run did get `HIGHASCG_NVIDIA_SYNC_OUTPUT=DP-4` (`nvidiaPolicyEnv` resolves port 3 → `DP-4` through the
device graph; checked by running it against the live config). The script then parsed `nvidia-settings -q dpys` with
`… | python3 - "$_out" <<'PY'`: the heredoc **is** python's stdin, so the pipe was never read, `_dpy` stayed empty and
`_apply_sync_to_display` returned silently, on every Apply and every boot. Reproduced in bash on the box (`dpy=[]`).
Fix (`tools/runtime/highascg-nvidia-x-apply.sh`): program in `python3 -c '…' "$_out"`, and match the `[dpy:N]` target
id instead of the list index in front of it (same on this box, `[4] …[dpy:4] (DP-4)`, not in general).
Smoke `tools/smoke/smoke-wo805-nvidia-sync-display-id.test.js` (3/3) runs the function against a fake `nvidia-settings`
(`[4] …[dpy:6] (DP-4)` → assigns 6, an unlisted port assigns nothing, no heredoc feeds the parser).

### Bug 2 — the fast kill killed the relaunched Caspar (found live, fixed)

Apply 1: RESTART 19.843; the old Caspar logged "Successfully shutdown" at 21.179, then SEGV in `exit()` (shared_ptr
dispose, every exit does this, 30 times in the journal) and was still in the crash handler when the 1 s settle poll ran
out → `caspar still up — fast kill` (21.297). run.sh (WO-805 fix 1) relaunched at 21.99. `caspar-kill-main.sh`
(`CASPAR_KILL_FAST=1`) called `caspar_kill_all_processes` twice, TERM then KILL a second later, and **each call lists
the PIDs again**: the KILL hit the new instance → run.sh exited 137 (not a restart code under systemd) →
`casparcg-server.service` failed (22.40) → the node "inactive — starting via systemd" (23.455) → second start, AMCP back
27.105. Before WO-805 the relaunch took 2.8-5.1 s, so the second listing never found a new process (the 4 earlier fast
kills in 14 days of journal had no exit 137). If the KILL had missed, the following port-free wait would have
killed the new one after 5 s instead (`caspar_wait_amcp_port_free` kills the tree when `CASPAR_KILL_FAST=1`).
Fix (`tools/runtime/caspar-kill-main.sh`, fast path only): list main PIDs + their children + CEF once, TERM/KILL that
snapshot, and skip the port-free wait when a casparcg outside the snapshot (the relaunch) is already up (logged
"relaunched casparcg already up"). Smoke `tools/smoke/smoke-wo805-fast-kill-spares-relaunch.test.js` (2/2) runs the
real script against fake casparcg processes (own bin/config path/port): the instance started 0.5 s into the kill
survives, the old one is gone. **Negative control:** the same test against `git show HEAD:…/caspar-kill-main.sh`
fails ("the relaunched instance is NOT killed"). Apply 2 needed no fast kill (clean exit 1.2 s after RESTART), so
the fixed script has not yet run on the live Caspar. The offline test is the proof.

### Observed, not changed

- **PGM is black after every Apply until the operator takes again.** The restart empties Caspar. After both Applies the
  node re-staged PRV (ch 2 Intro, ch 4 blackFHD) and the operator GUI cells, but not PGM (no code re-plays program
  after a restart; it may be deliberate, since it avoids putting content on air on its own). Meanwhile Godot's PGM 1
  tile still labelled "L10 KV LOOP" while INFO 1 had no layers. Re-taking Intro → LED head showed it again
  (`full805b_retake.png`, INFO 1 layers 110-112). Owner decision whether an Apply should restore PGM.
- Step 3 → 4 took 1.59 s on the first Apply after the node start vs 0.74 s on the second.
- 8. (blink/tearing in the NVIDIA window) — owner eye, not judged here.
