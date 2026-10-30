# WO-720 — Bugs the WO-719 GUI end-to-end run found

**Area:** testing-ci
**Status: DONE (23.10.26). Proven offline and in the sandbox: two new smokes (2/2 each; both fail without their fix),
the WO-453 smoke 7/7, the WO-308 smoke 11/11 on the box, a full `test:ci` with a
logging `pkill` shim (0 host kills, was 24), Godot units 21462/0, a sandbox boot check, and GUI e2e 27/27
with no quit hang. The new 02 step fails with the inspector fix reverted and passes with it. Nothing was probed on the
live server: the fixes reach the box on the next server restart and kiosk reload (owner QA below).**

Owner, 23.10: *"If there are any bugs you found along the way fix them"*. These are the bugs found while building
WO-719.

## Investigation

### A. A quit hang: superseded operator-GUI layout POSTs never answered (the serious one)

- **Symptom.** The e2e client sometimes did not exit after `DONE`. The runner gained a 20 s HANG kill (WO-719). The
  hang reproduced only when a real shm segment was present: copy `/dev/shm/highascg-in2` into the sandbox shm dir and
  run without `--video=feed`, a temporary runner edit.
- **gdb** (Godot launched under gdb, which has to be its parent because of ptrace_scope=1):
  - The main thread was in a futex wait, joining another thread.
  - That thread was in `__libc_recv(fd=20, len=1)`. Godot's blocking HTTPClient reads chunk and header bytes one at a
    time, so this is an `HTTPRequest` with `use_threads=true` (`core/api.gd` pool) waiting on a response that never
    came.
  - HTTPRequest joins its thread on free, so quitting blocked for good.
- **Which request.** A temporary begin/end print in `api.gd` showed one request still open at quit:
  `/api/operator-gui/layout`. It started when scenario 03 opened a media preview and never completed during the rest
  of the run.
- **Root cause.** `src/system/operator-gui-channel.js` `applyOperatorGuiLayout` debounces per channel.
  - A second call inside the window ran `clearTimeout(existing)` on the first timer. The first caller's
    `new Promise((resolve, reject) => …)` then had nothing left that could settle it.
  - `clearOperatorGuiLayout` did the same to a pending report.
  - `media_preview.gd` `_report()` runs on open and again once the source dimensions arrive, which is two POSTs inside
    the debounce window. So every media-preview open with a local shm surface leaked one request.
- **Production impact.** The kiosk client loses one of its six `Api` pool slots each time this happens. Six leaks and
  every API call waits forever. Quitting or restarting the client hangs.

### B. Devices: a new or edited screen's PGM/PRV channels stayed unknown to clients

- `POST /api/device-view` (`src/api/routes-device-view.js`) saves add / update / remove destination edits. The
  channel map clients use (`buildChannelMap(ctx)`, `src/config/channel-map-from-ctx.js`) changes with them.
- Nothing broadcast the new map. It went out only on a settings POST or a Caspar INFO CONFIG change.
- The e2e saw a new PGM/PRV screen with no PRV/PGM channel in the Godot Store until some unrelated save. This is the
  same class of bug as WO-506 (the rename broadcast in `routes-screens.js`).

### C. Devices inspector: a pick made while a reload landed was lost

- The tail of an add or save reloads Devices (`_dests._busy`, `devices_tab._loading`). That rebuilds the destination
  inspector.
- With a video-mode OptionButton list open, the rebuild freed the popup under the operator's pointer, and the pick
  never reached the server.
- Re-picking the already-selected row also sent a redundant `patch` and another save/reload round.

### D. Sim mode regenerated the whole Caspar config five times a second

- In the sandbox server log, "[OS-Config] Layout plan: no assigned outputs" (`os-layout-calculator.js:17`) appeared as
  a pair every 200 ms, from boot onwards and before any client connected.
- The source is the WO-453 sim OSC feeder (`sim-osc-feeder.js`, 200 ms tick). It calls `AmcpSimulated.channelModes()`,
  and that ran `buildConfigXml(buildCasparGeneratorFlatConfig(config))` (two layout plans) on every tick.
- This happens only with `--no-caspar` / `offline_mode`. The live box (real Caspar) logs none of it: 0 matches in the
  journal over 2 min.

### E. The WO-308 smoke failed on this box only

- `smoke-wo308-pointer-confine-split` 'auto' asserted `no_operator_monitor_and_multiview_off` / `pointerConfineMultiview`
  for configs with no operator flag.
- `evaluateOperatorPointerConfineDesire` called `resolveOperatorMonitorPort(config)` with no hardware, so it probed.
  On the playout box the lone connected display is the operator monitor (WO-246), so every case answered
  `operator_monitor_port_N`. CI passed only because CI has no displays.

### F. `npm run test:ci` on the box killed the live operator's pointer-barrier daemon

- Found while comparing the live-box fingerprint around the e2e work.
  - `confine-pointer-barriers.py` had been restarted by the live server (PID 457387, never restarted) at 21:19:24,
    21:21:00, 22:02:12 and 22:14:13 UTC. Each restart was a journal `[Pointer confine] RUN — operator_monitor_port_3`
    plus a fresh `[pid=N] Pointer confine for DP-5` in `~/.highascg/log/confine-pointer-barriers.log`.
  - The old helper never logged "Pointer confine released", so it was killed by a signal.
  - Every time matches a gate run of the offline suite in this session.
  - The sandbox runs did NOT kill it: they are gated by `isSandbox()` (WO-719).
- **Proof.** A `pkill`/`killall` shim first on PATH logged its caller chain and killed nothing. During
  `xvfb-run -a npm run test:ci` it saw 12× `pkill -f confine-pointer-barriers.py` and 12× `pkill -f confine-cursor.py`
  from `smoke-wo645-startup-mode`, `smoke-wo308-pointer-confine-split`, `smoke-wo244-stream-secret-preserve`,
  `smoke-wo619-settings-editor-defaults-persist` and `smoke-wo249-audio-pair-select`.
- **Path.** These tests POST settings → `settings-post.js:409` `syncOperatorPointerConfine` → `stopPointerConfine` →
  `stopBarrierProc`. That runs a pattern pkill, which hits the host's real helper whichever process asks.
- **Impact.** On every on-box test run the operator's mouse was unconfined until the live 8 s watchdog restarted the
  helper. A config that *desires* confine could even start a helper from the test process.

## What was done

- **A** — `src/system/operator-gui-channel.js`:
  - Each channel keeps `debounceWaiters` (all callers of the apply that has not fired yet).
  - When the timer fires, or a clear cancels it, `settleWaitersWith(ch, next)` settles every waiter with the outcome
    of the apply that actually ran. A superseded report gets the newer plan, because that is what is now applied.
  - The test reset clears the waiters.
  - The fix is on the server rather than a client-side abort, because the server broke the HTTP contract and any
    client (web UI, cluster peers) would leak the same way.
- **B** — `src/api/routes-device-view.js` `announceChannelMap(ctx)`: after a successful add / update / remove
  destination it broadcasts `change channelMap`. A broadcast failure is swallowed so it never fails the edit.
- **C** — `godot/client/features/devices/destination_inspector.gd`:
  - When a select's popup is open, `show_destination` stores the new payload in `_pending` and rebuilds on that
    popup's `popup_hide` (one-shot, deferred).
  - `_send` drops a pending rebuild.
  - `_select` records the selection on `about_to_popup` and ignores `item_selected` for the same row.
- **D** — `src/caspar/amcp-simulated.js` `_configXml()` is memoised on `JSON.stringify(config)`. That is about 19 KB at
  5 Hz, trivial next to a generator run. Any config edit regenerates.
- **E** — `evaluateOperatorPointerConfineDesire(config, hw)` passes `hw` through. Production callers are unchanged. The
  smoke pins `NO_HW = { displays: [], connectors: [] }`.
- **F** — `src/system/pointer-confine.js`: the module's `isSandbox` is now a local
  `sandbox.isSandbox() || Boolean(process.env.NODE_TEST_CONTEXT)`. `node --test` sets `NODE_TEST_CONTEXT` in every
  file process. The three WO-719 guards (stop / start / sync) therefore also cover test processes, and the WO-719
  smoke's source pins still hold unchanged. The change is narrow on purpose: the other `isSandbox()` gates also
  redirect paths that tests assert on, and there is no evidence the suite trips them.
- **Tests:**
  - New `smoke-wo720-operator-gui-debounce-settles` (superseded report and clear-cancelled report both settle).
  - New `smoke-wo720-device-view-announces-channel-map` (add / update / remove each broadcast; a rejected edit does
    not).
  - New `smoke-wo720-tests-never-touch-host-confine`: stubs `child_process`, then stop / start / sync run nothing.
  - All three are in the `run-offline-tests.js` FILES list.
  - WO-453 sim smoke: added a cache test.
  - GUI e2e `02_outputs`: added the step "A reload while the list is open keeps the pick". It reloads Devices while
    the video-mode list is open, through `e2e_ui.choose(…, while_open)`.

## What was VERIFIED

- **A:**
  - The smoke passes 2/2 with the fix and fails 2/2 ("never settled") without it.
  - Full GUI e2e with the shm repro (a copy of in2 in the sandbox shm dir, client in shm mode): before the fix, HANG
    and `/api/operator-gui/layout` still in flight at quit. After the fix, 27/27, the client quit on its own, and
    nothing was in flight.
- **B:** the smoke passes 2/2. With the announce line removed, the add/update/remove test fails.
- **C:** GUI e2e `02_outputs` alone, with the inspector reverted to HEAD: FAIL "1080p2500 not stored after a reload
  during the pick". With the fix: 8/8.
- **D:** the WO-453 smoke 7/7. The sandbox server log's `[OS-Config] Layout` lines over a full e2e run dropped from 437
  to 31.
- **E:** the WO-308 smoke 11/11 on the box.
- **F:**
  - The new smoke fails without the guard and passes with it (the shim stayed on PATH during the revert check, so
    nothing real could fire).
  - Full `test:ci` with the shim: 0 kill calls (was 24). The live helper PID 570675 survived the run.
- **Gates:** `xvfb-run -a npm run test:ci` (3065 tests: 3063 pass, 0 fail), lint (0 errors), format:check, max-file-lines (0 over), Godot units
  21462/0, and a sandbox boot check (status 0).
- **Owner QA after the server restart and kiosk reload:**
  - Open a media preview a few times. The client must keep responding and quit or restart cleanly.
  - Add a PGM/PRV screen in Devices. Its channels must show at once.
  - Open the video-mode list during a save. The pick must stick.
