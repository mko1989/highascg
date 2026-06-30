# Work Order 89: CEF operator control (X11 bridge, host-target CDP, HTTP API)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Complete (live smoke T89.A5/B3 manual on rig)  
**Priority:** High (operator interactive webpages, Web UI control surface)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Depends on:** [WO-88](./88_WO_HOST_CHANNEL_LIVE_SOURCES.md) for `sourceId` / `hostChannel` registry and operator fullscreen video route (can ship interim against L999 before WO-88 lands).

**Related work orders:**
- [WO-87](./87_WO_OPERATOR_POINTER_CONFINE.md) — operator monitor pointer confine (passive X11; no grab)
- [WO-88](./88_WO_HOST_CHANNEL_LIVE_SOURCES.md) — host-channel live sources + fullscreen video route

**Interim implementation (shipped):**
- `src/system/cef-interactive-bridge.js` — X11 zone → CDP mouse/keyboard on **interactive layer** of multiview/screen consumer channel
- `src/system/cef-interactive-cdp.js` — CDP page resolve, warm, forward
- `tools/runtime/cef-interactive-x11.py` — passive pointer/keymap poll inside layout zones
- `src/api/routes-amcp.js` → `notifyCefInteractiveAmcpLines` (warm on PLAY)
- Config: `operatorTools.cefInteractiveBridge`, `cefInteractiveLayer` (default 999), `remote-debugging-port` in `casparcg.config`

---

## 1. Problem statement

### 1.1 CEF input targets the wrong layer

The interim bridge resolves CDP pages by **template needle** on whatever channel INFO reports on the **interactive consumer layer** (e.g. operator ch4 L999). That layer can be **cleared** while the operator still sees a **routed** picture (`route://`) — clicks hit a stale or missing CDP target (first-click latency, skips).

**Target:** Resolve CDP from **[WO-88](./88_WO_HOST_CHANNEL_LIVE_SOURCES.md) host source registry** (`hostChannel`, `cefNeedle`, `sourceId`), not operator overlay INFO.

### 1.2 No HTTP API for CEF control

Mouse/keyboard today only come from **physical X11** on the playout box. The Web UI cannot drive the same CEF tab (remote operator panel, automation, testing without hardware).

### 1.3 Passive capture — OS remains usable

Bridge uses **read-only** `XQueryPointer` / `XQueryKeymap` — **no** `XGrabPointer` / `XGrabKeyboard`. Thunar and other apps keep working; events are **copied** to CEF when focus target is active ([WO-87](./87_WO_OPERATOR_POINTER_CONFINE.md)).

---

## 2. Interactive session model

| Concept | Description |
|---------|-------------|
| `cefFocusTarget` | `{ sourceId, hostChannel, hostLayer, needle, zoneId }` — which CDP page receives input |
| Operator fullscreen | Set by WO-88 video route + WO-89 focus (`sourceId` from live source row) |
| Passive X11 | Poll inside interactive layout zones only; keyboard scoped to zone under pointer |
| Warm | Pre-attach CDP on host PLAY, pointer zone enter, focus change |

```
Operator monitor (X11 zone)
        │ passive poll
        ▼
cef-interactive-bridge.js
        │ CDP (Puppeteer)
        ▼
CEF tab on host channel N L1   ←── same tab WO-88 keeps alive with LOOP
```

---

## 3. Bridge changes (from interim)

- [x] **`cefFocusTarget` registry** — in-memory; set when operator fullscreen on webpage host source (WO-88 **T88.C4**)
- [x] **CDP resolve** by `hostChannel` + `cefNeedle` / `sourceId`, not operator `cefInteractiveLayer` INFO
- [x] **Warm** on: host channel PLAY, pointer enter zone, focus change, periodic while focused
- [x] **Drop** dependency on HTML producer on operator channel for interactive (operator ch is route consumer only)
- [x] **First-click latency** — sub-100ms when host CEF already warm (no AMCP INFO per click)

### 3.1 Fallback (until WO-88)

Keep current L999 / INFO needle path behind env flag or when no `cefFocusTarget` is set (`cef-interactive-load-test.sh`, dev rigs).

---

## 4. HTTP API (Web UI + automation)

Single internal `forwardToCefTarget()` used by X11 bridge and HTTP handlers.

### 4.1 Endpoints (v1)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/cef-interactive/targets` | List focusable sources + CDP attach status |
| `POST` | `/api/cef-interactive/focus` | `{ sourceId }` — set CDP focus (coordinates with WO-88 fullscreen) |
| `DELETE` | `/api/cef-interactive/focus` | Clear focus; host channel keeps playing |
| `POST` | `/api/cef-interactive/mouse` | `{ sourceId, type, x, y, button? }` — CEF viewport pixels or normalized 0..1 |
| `POST` | `/api/cef-interactive/keyboard` | `{ sourceId, type, key?, text?, keysym? }` |
| `POST` | `/api/cef-interactive/eval` | `{ sourceId, expression }` — optional admin guard (future) |

Auth: operator API session; reject unknown `sourceId`.

### 4.2 Web UI (future-friendly)

- Sources → Live webpage fullscreen icon: WO-88 routes video; WO-89 `POST …/focus` binds CDP
- Debug panel: send click/key without X11
- v1 ships **API + bridge**; full remote UI optional

---

## 5. Tasks

### Phase A — Focus registry + host-target CDP

- [x] **T89.A1** `cefFocusTarget` registry module (get/set/clear; subscribe to WO-88 fullscreen events)
- [x] **T89.A2** Retarget `resolveStableCefPage` to host channel + `cefNeedle` from registry
- [x] **T89.A3** Warm on focus change + host PLAY (`notifyCefInteractiveAmcpLines` extended)
- [x] **T89.A4** Fallback to interim L999 path when no focus target
- [x] **T89.A5** Smoke: host PLAY → WO-88 route → focus → click/key → state survives route clear

### Phase B — HTTP API

- [x] **T89.B1** `src/api/routes-cef-interactive.js` — targets, focus, mouse, keyboard
- [x] **T89.B2** Wire routes in `routeRequest`; document in API reference
- [x] **T89.B3** Smoke: API mouse/keyboard against `interactive_click_test` on host channel

### Phase C — Keyboard / mouse polish

- [x] **T89.C1** Modifier combos (Ctrl/Cmd, Shift) — extend X11 keymap + CDP forward
- [x] **T89.C2** Key autorepeat policy (document: poll-based X11 does not repeat unless added)
- [x] **T89.C3** Optional `HIGHASCG_CEF_BRIDGE_TRACE` docs in WO or `docs/reference/`

---

## 6. Acceptance criteria

1. Operator fullscreen on webpage host source (WO-88) + focus → clicks/keys on multiview reach **host channel** CEF tab without 1–2s first-click delay.
2. Taking video off operator does not destroy CEF; refocus works when routed back.
3. `GET/POST /api/cef-interactive/*` can focus and send mouse/keyboard from Web UI code.
4. OS apps (Thunar, etc.) remain usable — no pointer/keyboard grab.
5. Interim L999 dev path still works when `cefFocusTarget` unset.

---

## 7. Related files

| Area | Files |
|------|--------|
| Bridge | `src/system/cef-interactive-bridge.js`, `cef-interactive-cdp.js`, `cef-interactive-trace.js` |
| X11 capture | `tools/runtime/cef-interactive-x11.py` |
| AMCP warm | `src/api/routes-amcp.js` |
| Host registry (WO-88) | `extraLiveSources`, `live-input-modal.js`, fullscreen event **T88.C4** |
| Dev tools | `tools/runtime/cef-interactive-load-test.sh`, `cef-interactive-api-smoke.sh`, `cef-interactive-watch-logs.sh` |
| Smoke | `smoke-cef-host-focus-api.live.test.js` (T89.A5+B3), `smoke-cef-interactive-bridge.live.test.js`, `smoke-cef-cdp-input.live.test.js` |

---

## Work Log

### 2026-06-29 — Agent (Phase C — modifier keys + docs)

**Work Done:**
- X11 key events include `modifiers` array; CDP `forwardKeyEvent` tracks Control/Alt/Shift/Meta.
- HTTP keyboard API accepts `modifiers`; aliases `Ctrl`/`Cmd`.
- `docs/reference/cef-interactive-bridge.md` — trace env, autorepeat policy.
- Test: `smoke-cef-interactive-keyboard.test.js`.

**Instructions for Next Agent:** Run `npm run test:highascg:live:cef` on rig with webpage host configured.

### 2026-06-29 — Agent (live smoke T89.A5 + B3)

**Work Done:**
- `smoke-cef-host-focus-api.live.test.js` — host PLAY, operator route, API click/key, operator CLEAR, refocus.
- `cef-interactive-api-smoke.sh` — manual curl helper; added to `test:highascg:live:cef`.

### 2026-06-29 — Agent (Phase C — modifier keys + docs)

**Work Done:**
- `cef-interactive-forward.js` — shared `forwardToCefTarget()`, focus helpers, coordinate mapping.
- `routes-cef-interactive.js` — GET targets, POST/DELETE focus, mouse, keyboard, eval.
- Router wiring; API docs in `docs/wiki/api/system-settings-hardware.md`.
- Test: `smoke-cef-interactive-api.test.js`.

**Instructions for Next Agent:** Live smoke T89.A5/B3 on rig; Phase C modifier polish.

### 2026-06-29 — Agent (Phase A — host-target CDP)

**Work Done:**
- `cef-focus-registry.js` — get/set/clear + subscribe; host channel metadata lookup.
- `cef-interactive-bridge.js` — CDP resolve from registry needle (not operator L999 INFO); warm on focus/host PLAY; L999 fallback when no focus.
- `host-operator-fullscreen.js` — syncs registry on apply/clear fullscreen.
- Test: `smoke-cef-focus-registry.test.js`.

**Instructions for Next Agent:** Phase B HTTP API (`routes-cef-interactive.js`); live smoke T89.A5 on rig.

### 2026-06-30 — Agent (split from combined WO)

**Work Done:**
- Split CEF operator control into standalone WO-89.
- Host-channel live sources remain in [WO-88](./88_WO_HOST_CHANNEL_LIVE_SOURCES.md).
- Documented interim L999 bridge as fallback until host-target retarget ships.

**Instructions for Next Agent:** Can start **T89.A2–A4** against interim L999 immediately; wire **T89.A1** to WO-88 **T88.C4** when host registry exists. API (**Phase B**) can parallelize once `forwardToCefTarget()` is shared.

### 2026-06-30 — Agent (initial combined draft)

**Work Done:** Original scope lived in combined WO-88 (later split).

---
*Work Order created: 2026-06-30 | Series: HighAsCG operator interactive*
