# WO-903 — Two operator monitors: the pointer fence goes round both heads (DP-4 + DP-6)

**Area:** devices-config, testing-ci
**Status: DONE (31.10.26 — box: node restart → journal `XFixes barriers on DP-4,DP-6 @ 0,0 3840x1080`, daemon log top/bottom barriers (-16..3856), corners sealed; XTest relative motion: DP-4 → DP-6 crosses, stops at 3839 (DP-0 edge), 0 and y 1079; smokes 28/0 incl. the 4 existing pointer-confine smokes)**

## Owner report (31.10.26)
"restart or do whats needed so ill have the two operator monitors for tests" — after DP-6 was wired as a second
operator GUI head (device graph edge `dst_in_dst_operator_gui → gpu_p3`, full apply: DP-4 0,0 · DP-6 1920,0 ·
DP-0 3840,0), the mouse could not reach DP-6.

## 1. Investigation
- Journal: `[Pointer confine] XFixes barriers on DP-4 @ 0,0 1920x1080` — the fence was the primary head only.
- `src/system/pointer-confine.js startPointerConfine` fences `resolveOperatorMonitorRect(config, layout)`
  (`src/utils/x-display-session-layout-resolve.js:301`): ONE rect for the configured operator port. The same resolver
  places the GUI window and the primary output, so widening it there would move the GUI — it stays single-head.
- `layout.operatorGui` (os-layout-calculator) already lists every operator head: `operator_gui_1 DP-4 0,0`,
  `operator_gui_2 DP-6 1920,0`.
- `tools/runtime/confine-pointer-barriers.py` takes one output name and re-reads its geometry by name on every RandR
  change; `tryBarrierConfine` only allowed `^[A-Za-z0-9._-]+$`; `isBarrierDaemonRunning`'s pgrep fallback matched by
  substring (`"DP-4"` would have matched a `DP-4,DP-6` daemon).

## 2. What was done
- **`src/system/pointer-confine-span.js` (new)** `spanOperatorHeads(rect, layout)`: joins the operator heads that
  share y and height and touch edge to edge (left and right of the primary), → `sysId "DP-4,DP-6"`, x/width of the
  union. A gap, another height or another y keeps the single head (the fence must never enclose off-screen area the
  pointer could vanish into); the multiview fence is untouched.
- **`pointer-confine.js`** — `startPointerConfine` fences `spanOperatorHeads(resolveOperatorMonitorRect(…), layout)`;
  the sysId check allows a comma list; the pgrep fallback compares the daemon's last argument exactly.
- **`confine-pointer-barriers.py get_monitor_geometry`** — a comma list = the bounding box of those outputs (None when
  one is gone → the existing "no longer connected → release" path); the maintenance loop re-reads it by the same name,
  so RandR moves keep tracking. The pid file carries the list, which `isBarrierDaemonRunning` compares as before.

## 3. What was VERIFIED
- `tools/smoke/smoke-wo903-pointer-confine-spans-operator-heads.test.js` 5/5 (join, grow left, gap / height / y
  rejected, single head + multiview untouched, wiring); pointer-confine-geometry-follow, wo845-barrier-constants,
  wo720-tests-never-touch-host-confine, interactive-operator-display still pass (28/0 together).
- Box: `kill -TERM` node → `[Pointer confine] RUN — operator_monitor_port_3` → `XFixes barriers on DP-4,DP-6 @ 0,0
  3840x1080`; pid file `… DP-4,DP-6`; `~/.highascg/log/confine-pointer-barriers.log` barrier top `(-16,0)-(3856,0)`,
  bottom `(-16,1080)-(3856,1080)`, "4 edges, corners sealed", RandR events selected. xrandr unchanged (DP-4 0,0 ·
  DP-6 1920,0 · DP-0 3840,0).
- Pointer (owner OK'd automation, dev mode; XTest relative motion — barriers ignore warps): from 1900,500 +300 →
  2200 (onto DP-6); from 3800,500 +300 → **3839** (held at DP-0's edge); 2000 −2400 → 0; 2500,1000 +300 → y 1079.
  Restored to 960,540.
