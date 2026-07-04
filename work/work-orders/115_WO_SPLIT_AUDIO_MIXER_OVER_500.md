# WO-115 — Split audio mixer files over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Done  
**Priority:** **Medium**

**Touches:** `client/components/audio-mixer-panel.js`, `client/components/audio-mixer-view-console.js`

---

## 1. Problem

| Lines | File |
|------:|------|
| 553 | `client/components/audio-mixer-panel.js` |
| 539 | `client/components/audio-mixer-view-console.js` |

---

## 2. Split plan

### 2.1 `audio-mixer-panel.js` (553)

| New module | Responsibility |
|------------|----------------|
| `audio-mixer-panel-faders.js` | Per-channel fader strip DOM + drag |
| `audio-mixer-panel-meters.js` | VU meter draw/update from OSC/WS |
| `audio-mixer-panel-routing.js` | Bus assign, mute/solo, link to scene channels |

### 2.2 `audio-mixer-view-console.js` (539)

| New module | Responsibility |
|------------|----------------|
| `audio-mixer-console-layout.js` | Console grid, channel ordering |
| `audio-mixer-console-controls.js` | Fine gain, pan, EQ stub controls |

---

## 3. Tasks

- [x] **T115.0** Split panel faders vs meters; verify fader drag updates WS/API.
- [x] **T115.1** Split console view; verify meter animation still runs at playback.
- [x] **T115.2** Both originals ≤ 500 lines.

---

## 4. Verification

```bash
npm run lint
```

Manual: open Audio Mixer tab, move faders, confirm meters move during playback.

---

## Work Log

### 2026-07-03 — Created

- **Instructions for Next Agent:** Extract meter DOM/update loop first — isolated from fader gesture code.

### 2026-07-03 — Split complete

| File | Before | After |
|------|-------:|------:|
| `audio-mixer-panel.js` | 554 | 150 |
| `audio-mixer-view-console.js` | 540 | 117 |

**New modules (panel):** `audio-mixer-panel-masters.js`, `audio-mixer-panel-live-inputs.js`, `audio-mixer-panel-input-layers.js`

**New modules (console):** `audio-mixer-console-live-inputs.js`, `audio-mixer-console-input-groups.js`, `audio-mixer-console-masters.js`

Meter loop stays in parent; child modules register fills and bind fader/routing handlers. `check:file-lines` — 20 files remain over 500 (down from 22).
