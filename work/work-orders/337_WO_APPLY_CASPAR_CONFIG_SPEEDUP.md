# WO-337 — Apply Caspar config: ~18 s wall clock, most of it avoidable

**Source:** owner report 2026-07-26 — "i need a good look at apply caspar config button. the whole process seems to take longer than it should."

**Status: CLOSED 2026-07-27 — top-5 implemented 2026-07-26; residue resolved: template copy already per-file-mtime-gated (bd89484), TLS-before-CINF reorder REFUSED (CINF callbacks populate mediaDetails that the TLS callback consumes — reordering would pass empty data), final deferred item landed 2026-07-28 (owner authorized restarts): applyX11Layout is fully ASYNC (promisified xrandr execs + async retry sleeps — the sync execs froze the whole API/WS server during applies), all 6 callers await, watchdog tick rejection-guarded. NVIDIA fire-and-forget and the 1.5s stable-wait were already in. Live-verified: xrandr apply 0.3s HTTP with verify OK; unchanged-config full apply short-circuits in 0.12s via the skip gate.** Top-5: (commits e70fc01, 387149f, e51c7ed, 83f01b1):
(1) toolbar button busy state + `[Full apply] Step N` streaming; (2) duplicate
`applyOperatorDisplaySession` eliminated via `skipOperatorSession` (~5s); (3) operator-restart
marker `/tmp/caspar-operator-restart` skips run.sh's 5s + 2×2s damping (activates at the next
casparcg-server service restart); (4) 1s settle-poll before the fast-kill (~2s); (5)
skip-if-unchanged gate — **live-verified 79 ms** response with `step:no_changes`, Caspar PID
untouched. Remaining: NVIDIA dedupe/fire-and-forget, nodm stable-wait shrink, CINF ordering,
template-copy mtime compare, async xrandr exec. Original investigation below.

**Status (original): investigated and measured, not fixed.** Six apply cycles measured from the journal; typical apply = **~18 s** to HTTP response (~19 s to system ready). Caspar's actual shutdown+boot is only ~4 s — the rest is fixed sleeps, a duplicated call timing out, and redundant work.

## Measured breakdown (most recent apply, 2026-07-26 16:25)

| Step | Time | What |
|------|------|------|
| 1. write casparcg.config | 0.06 s | fine |
| 2. xrandr layout persist | 0.18 s | fine |
| 3. display session apply | **5.9 s** | xrandr done in 0.08 s; then a **duplicate `applyOperatorDisplaySession`** runs `xdotool mousemove --sync` twice concurrently — the second times out at exactly its 5 000 ms limit (`src/utils/x-display-session-runtime.js:148`). Applies without the stall take 1.3 s. |
| 4. Caspar restart | **11.3 s** (10.6–12.1 across six applies) | RESTART→shutdown 0.3 s; `caspar-kill-main.sh` fast-kill burns 2.15 s of `sleep 1`×2 **against an already-exited process**; then `run.sh` `sleep 5` (`CASPAR_RESTART_SLEEP`) + `sleep 2` grace (`casparcg-supervisor-lib.sh:255-258`) = **7 s of pure sleep**; Caspar boots ~3.5 s; AMCP back. |
| 5. NVIDIA policy | 0.6 s | 3rd in-process invocation of the same script this apply; the script backgrounds two more at +6/+18 s. |
| post-reconnect gather+routing | ~1.5 s | serial CINF storm (up to 100) runs before routing; template dir copied unconditionally. |

The nodm/resolution-change path adds `waitForDisplayStable` ≈ 11.9 s (4 s settle + 1.5 s × up to 12 polls, `src/utils/display-stable-wait.js:20-22`).

## Fix direction (ranked by ratio)

1. **Client feedback (cheapest, perceptual):** `device-view-events.js:59-65` fires the POST with no busy state, no spinner, nothing for 18 s. Disable the button, show "Applying — restarting Caspar…", and stream the existing `[Full apply] Step N` log lines (already on the WS via `logBuffer.setOnNewLine`, `index.js:316-326`) or `caspar.connection` events into the status area. The config-editor modal already does this (`caspar-config-modal.js:132-134`); the toolbar button must too.
2. **De-duplicate `applyOperatorDisplaySession` (~5 s):** `applyX11Layout(live:true)` fires it internally (`os-config-xrandr-apply.js:327-336`) and `full-config-apply.js:175` awaits a second one — two concurrent `xdotool mousemove --sync`, the loser eating the full 5 s timeout. Suppress the internal one via a flag (or drop the outer), and cut that xdotool timeout to ~1500 ms.
3. **Operator-restart sleep override (~6 s):** the `run.sh` `sleep 5` + 2 s grace exist for crash-loop damping, which `caspar_crash_loop_backoff` already handles. For an operator-initiated apply, export `CASPAR_RESTART_SLEEP=1` / `CASPAR_RESTART_GRACE_SEC=0` (plumb through the systemd env or a marker file the supervisor checks).
4. **Skip-if-unchanged gate (<1 s for the common re-click):** `writeCasparConfigToDiskUnserialized` (`routes-caspar-config.js:95`) writes unconditionally and `applyFullServerConfig` always restarts. Compare generated XML to on-disk; if identical and `verifyXrandrMatchesLayout` passes → return "no changes" without touching Caspar.
5. **Kill-script polling (~2 s):** `caspar-kill-main.sh:16-19` sleeps 1 s twice even when Caspar already exited (measured: kill started 58 ms *after* "Successfully shutdown"). Re-check process/port before invoking; poll for exit instead of fixed sleeps.
6. Smaller: make NVIDIA policy fire-and-forget after Step 4 and single-invocation (`full-config-apply.js:218-237`, `nvidia-display-policy.js:43-44`); shrink `waitForDisplayStable` settle to ~1.5 s / 400 ms polls; run TLS/INFO/routing ahead of the CINF batch (`query-cycle.js:216-232`); mtime-compare before the full `template/` copy each reconnect (`routing-setup.js:66-75`); make the two `applyX11Layout` passes share the computed layout and use async exec (current `execFileSync` freezes the whole API/WS server, `os-config-xrandr-apply.js:22-29`).

Items 1+2+3+5 take a typical apply from ~18 s to roughly **5–6 s** (Caspar boot + gather = the true floor); item 4 makes the "did I already apply?" click sub-second.

## Acceptance

- Toolbar button shows busy + step progress for the whole cycle; re-enabled on completion/failure.
- Typical apply (config changed, no resolution change) ≤ ~7 s to AMCP-ready; unchanged-config apply returns "no changes" in < 1 s without restarting Caspar.
- Crash-loop damping unaffected: an actually crashing Caspar still backs off via `caspar_crash_loop_backoff`.
- No regression on the nodm/resolution-change path (WO covers it only via the shortened stable-wait).

## Constraints

- `run.sh`/`casparcg-supervisor-lib.sh` changes affect every restart path incl. crash recovery — the sleep override must be scoped to operator-initiated applies only.
- Step 3/5 display calls run as root-adjacent helpers on the live X session; test on the box, not just by reading.
