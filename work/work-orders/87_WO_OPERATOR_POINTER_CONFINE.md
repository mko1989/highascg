# Work Order 87: Operator monitor pointer confine (Caspar-safe)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** **Shipped / locked** — verified on NVIDIA multi-head playout box 2026-06-29  
**Priority:** High (operator monitor must confine pointer without breaking multiview / interactive Caspar)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Related:**
- Device View GPU inspector: `client/components/device-view-inspector-gpu.js` — **Operator monitor** checkbox per rear port
- Session apply: `src/utils/x-display-session.js`, `src/system/pointer-confine.js`
- Daemon: `tools/runtime/confine-pointer-barriers.py` (canonical)
- Work launcher: `work/confine_cursor.py` (thin wrapper for manual testing)
- Smoke: `tools/smoke/smoke-interactive-operator-display.test.js`
- Setup install: `scripts/setup/09-openbox-autostart.sh` → `/usr/local/bin/confine-pointer-barriers.py`

---

## 1. Problem statement

Operators need the mouse pointer **confined to one physical monitor** (usually multiview / operator head) while:

- **Caspar multiview screen consumer stays visible and interactive**
- Cursor **auto-hides after ~2s idle** (`unclutter`) on that head
- Other PGM outputs keep **standard Caspar cursor hiding** when not interactive
- Layout apply (`apply-layout.sh`) sets **primary** on the operator port but does not break playout

**Goal:** Hard confinement at monitor edges without global pointer grab or overlay windows.

---

## 2. Canonical method (DO NOT REPLACE WITHOUT QA)

### 2.1 XFixes pointer barriers + warp watchdog

| Layer | Implementation | Why |
|-------|----------------|-----|
| **Edge stop** | `XFixesCreatePointerBarrier` on four edges of operator monitor rect | Server-side hard stop; no overlay window |
| **NVIDIA fallback** | 50ms loop: `XQueryPointer` + `XWarpPointer` if outside rect | Barriers alone can slip on some NVIDIA multi-head setups |
| **Long-lived daemon** | `confine-pointer-barriers.py` must **stay running** | Barriers are destroyed when the X client exits |
| **Node supervisor** | `src/system/pointer-confine.js` spawns daemon, PID file check, 8s watchdog restart | Survives settings save / OS watchdog without false “already running” from stale logs |
| **Idle hide** | `unclutter -idle 2 -root` — **never kill** when confine starts | Operator cursor hides after 2s on operator head |

**Canonical script:** `tools/runtime/confine-pointer-barriers.py`  
**Config key:** `casparServer.screen_N_operator_monitor` (one port at a time; Device View **Operator monitor** checkbox)  
**Also enables:** `xrandr --primary` on that output, `multiview_interactive` / `screen_N_interactive` on save

### 2.2 Operator UI (not Settings)

- **Device View → GPU port inspector → Operator monitor** — per rear port (`screen_N_operator_monitor`)
- **NVIDIA sync to display** — separate checkbox per port (`screen_N_nvidia_sync_to_display`); independent of primary
- Removed: Settings → “Confine mouse to operator display” (legacy `operatorTools.pointerConfineMultiview` still honored for migration only)

### 2.3 apply-layout.sh order (after main xrandr layout)

1. `xrandr --output <sysId> --primary` (only when operator monitor set)
2. `xdotool mousemove` (optional; needs `xdotool` installed)
3. `pkill` stale `confine-pointer-barriers.py` / `confine-cursor.py`
4. Spawn `confine-pointer-barriers.py` **or** rely on highascg service (both may run; daemon dedupes via PID)
5. Ensure `unclutter -idle 2` running
6. NVIDIA policy + optional `HIGHASCG_NVIDIA_SYNC_OUTPUT`

When **no** operator monitor: no primary/confine lines; only `pkill` stale daemons.

---

## 3. Deprecated / rejected approaches

| Approach | Result | Verdict |
|----------|--------|---------|
| **`confine-cursor.py` / XGrabPointer** | Confines pointer but **breaks multiview** (invisible consumer, interactive flash) | **Do not use** except `HIGHASCG_POINTER_CONFINE_XGRAB=1` emergency opt-in |
| **InputOnly confine window** | `BadWindow` on NVIDIA grab | Broken |
| **InputOutput full-screen overlay** | Grab works but blocks / occludes Caspar | Broken |
| **xdotool-only polling** | `ENOENT` on playout box (xdotool not installed); weak vs hard edges | **Fallback only** if barriers daemon fails |
| **Stale log file “Pointer barriers active”** | highascg thought confine was on while **no process** ran | Fixed: PID file + `pgrep` + live PID check |

---

## 4. Verification (operator box)

```bash
# Process must be running (not just log lines)
pgrep -af confine-pointer-barriers
cat ~/.highascg/run/confine-pointer-barriers.pid
# e.g. "2215125 DP-2"

tail -3 ~/.highascg/log/confine-pointer-barriers.log
# → "Pointer barriers active (4 edges) + warp watchdog"

# highascg journal
journalctl -u highascg.service -n 20 | rg 'Pointer confine'
# → "XFixes barriers on DP-2 @ …"
```

**Manual test:** Move mouse left past DP-6/DP-4 — pointer stops at DP-2 left edge or warps back within ~50ms. Multiview picture remains; interactive works after Caspar restart for `<interactive>true</interactive>`.

---

## 5. File map (do not fork logic)

| Path | Role |
|------|------|
| `tools/runtime/confine-pointer-barriers.py` | **Canonical daemon** — edit here |
| `work/confine_cursor.py` | Manual launcher → canonical script |
| `src/system/pointer-confine.js` | Spawn, watchdog, dedupe, unclutter |
| `src/utils/x-display-session.js` | Operator rect resolve, apply-layout shell lines |
| `client/components/device-view-inspector-gpu.js` | Operator monitor + NVIDIA sync UI |

**Legacy (do not wire into production path):** `tools/runtime/confine-cursor.py`, `work/confine_cursor.py` history as XGrabPointer experiment.

---

## 6. Dependencies

- `libX11`, `libXfixes` (system packages; no `python3-xlib` required for barriers)
- `python3` on playout box
- `unclutter` (openbox autostart + pointer-confine ensure)
- Optional: `xdotool` for pointer park / GUI raise only (`apt install xdotool`)

---

## 7. Task checklist

- [x] **T87.1** XFixes barriers daemon (`confine-pointer-barriers.py`)
- [x] **T87.2** Warp watchdog inside daemon (NVIDIA slip)
- [x] **T87.3** PID file + process-alive checks in `pointer-confine.js`
- [x] **T87.4** 8s watchdog restart in Node
- [x] **T87.5** Device View **Operator monitor** per GPU port; remove Settings confine checkbox
- [x] **T87.6** apply-layout shell: barriers spawn + unclutter; no XGrabPointer in shell
- [x] **T87.7** Smoke tests `smoke-interactive-operator-display.test.js`
- [x] **T87.8** Verified on live box (DP-2 operator, DP-6/DP-4 PGM) 2026-06-29
- [ ] **T87.9** Docs wiki cross-link (optional follow-up)

---

## Work Log

### 2026-06-29 — Shipped & locked (cursor confine working on operator box)

**Context:** Iterated through XGrabPointer (`confine-cursor.py`), xdotool polling, and XFixes barriers. User confirmed **barriers + warp watchdog** works: pointer cannot leave operator monitor; multiview consumer stays visible.

**Root causes fixed along the way:**
1. `python3-xlib` + InputOnly → `BadWindow` on NVIDIA; InputOutput grab broke Caspar.
2. xdotool confine never ran (`spawn xdotool ENOENT` — not installed on playout image).
3. Stale `confine-pointer-barriers.log` caused false “active” without running process.
4. Barriers destroyed when daemon exits — must keep process alive + watchdog.

**Instructions for next agent:**
- **Do not** switch production back to `confine-cursor.py` / XGrabPointer without full multiview interactive QA.
- **Edit confinement only in** `tools/runtime/confine-pointer-barriers.py` and `src/system/pointer-confine.js`.
- If confine “stops working”, first check `pgrep -af confine-pointer-barriers` and PID file — not log tail alone.
- Deploy: `sudo cp tools/runtime/confine-pointer-barriers.py /usr/local/bin/ && sudo systemctl restart highascg`
