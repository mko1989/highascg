# Work Order 31: Stage Auto-Follow — PTZ Cameras & Moving-Heads from Tracking

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Module context

Part of the **Previs & Tracking optional module** — see [WO-30](./30_WO_PREVIS_TRACKING_MODULE.md) for packaging, feature flag, and directory boundary. This WO is inert unless `HIGHASCG_PREVIS=1` or `config.features.previs3d === true`.

Depends on: [WO-19](./19_WO_PERSON_TRACKING.md) (source of person positions) and [WO-17](./17_WO_3D_PREVIS.md) (3D stage model for zone definition).

---

## Goal

Turn tracked person positions into **automated pan/tilt/zoom commands for external devices** (PTZ cameras, moving-head lights, follow-spots) by streaming position data to **Bitfocus Companion**, which fans out to each device using its native protocol.

Concretely, the operator should be able to:

1. Calibrate each device once (its physical position + how "stage left/right/up/down" maps to its command space).
2. Pick a tracked person, hit **"Start Follow Person N"**.
3. All calibrated devices lock onto that person and track them in real time while they stay inside a defined zone (typically the stage area drawn on the 3D model).
4. When the person leaves the zone or is lost for >N seconds, all devices return to a per-device **Home** state.

HighAsCG owns **tracking math + state**. Companion owns **device protocols**. The bridge is a small set of Companion variables + actions, updated continuously over the existing HighAsCG↔Companion WebSocket.

---

## Architecture

```
 WO-19 tracker  ──► tracking:persons (WS)
                           │
                           ▼
      ┌───────── src/autofollow/engine.js ──────────┐
      │   follow state: { activePersonId, ... }     │
      │   for each enabled device:                  │
      │     • fetch stagePos of active person        │
      │     • zone check → if exited → home         │
      │     • compute command via device mapping     │
      │     • emit autofollow:<deviceId>:cmd event  │
      └─────────────────────────┬───────────────────┘
                                │
                                ▼
                     autofollow:<deviceId>:cmd (WS)
                                │
                                ▼
          companion-module-highpass-highascg
                                │
                ┌───────────────┼────────────────┐
                ▼               ▼                ▼
           Companion vars  Companion actions  Companion feedbacks
                (pan, tilt,     (Start/Stop     (IsTracking,
                 zoom, home)     Follow N)       InZone)
                │
        Operator-bound buttons send protocol-specific
        commands to each physical device (VISCA-over-IP,
        Art-Net, sACN, NDI PTZ, ONVIF, Pelco-D, etc.)
```

Key principle: **HighAsCG never speaks a device protocol directly.** We emit a normalised command stream; Companion turns it into the dialect each fixture speaks. That keeps HighAsCG dependency-free of the long tail of PTZ/lighting vendors.

---

## Device model

Each device has a record in `highascg.config.json → features.autofollow.devices[]`:

```jsonc
{
  "id": "ptz-stage-left",
  "label": "PTZ Camera — Stage Left",
  "kind": "ptz",                      // "ptz" | "moving-head" | "follow-spot" | "generic"
  "physicalPosition": { "x": -5.0, "y": -3.0, "z": 2.4 }, // meters in stage coord (WO-30)
  "aim": { "pan0": 0, "tilt0": 0 },   // device-native pan/tilt when pointed at stage origin
  "range": {
    "pan":  { "min": -170, "max": 170, "unit": "deg" },
    "tilt": { "min": -30,  "max": 90,  "unit": "deg" }
  },
  "zoom":  { "enabled": true, "min": 0, "max": 100 }, // optional
  "home":  { "pan": 0, "tilt": -10, "zoom": 20 },
  "mode":  "absolute",                // "absolute" | "delta"
  "deltaGain": { "pan": 1.0, "tilt": 1.0 }, // only when mode === "delta"
  "zoneId": "stage",                  // when person leaves this zone → go home
  "companionBinding": {
    "varPrefix": "af_ptz_stage_left_", // Companion vars will be af_ptz_stage_left_pan, _tilt, etc.
    "triggerAction": "autofollow.tick"  // Companion action name invoked on every update
  }
}
```

### Modes

- **Absolute:** HighAsCG computes the exact pan/tilt (and optionally zoom) the device should hold right now. Best when calibration is accurate.
- **Delta (as you described in #5):** HighAsCG emits per-tick `{dPan, dTilt}` relative to the last position, and the operator decides in Companion what "one unit left/right" does on each fixture. Best when a device's command surface is incremental or when calibration is intentionally loose.

---

## Calibration

Two calibrations stack: **stage calibration** (from WO-19, 4-point homography → stage meters) and **per-device aim calibration**.

### Per-device aim calibration wizard

1. Operator selects a device in the Auto-Follow panel.
2. Places a performer (or a stand-in target) at the stage origin. Clicks **"Capture origin"** → stores the device's current pan/tilt/zoom as `aim.pan0/tilt0` and `home` defaults.
3. Moves the target to stage-left reference (e.g. `x = −3 m`). Clicks **"Capture stage-left"**. Repeat for stage-right, upstage, downstage.
4. HighAsCG fits a 2D affine (pan, tilt) = f(stageX, stageY, devicePos) using least-squares; the result lives in `aim.transform`.
5. **Dry-run test:** a simulated person at various stage positions shows the expected pan/tilt values; operator eye-balls the math before arming the device.

For delta mode, calibration instead captures "move person +1 m left → increment Companion var by 1.0" so `deltaGain` matches the operator's mental model.

### Zone definition

Zones are 2D polygons on the stage floor drawn inside the **3D Previs** (WO-17) scene. Default zone is the entire stage footprint. Each device can target a specific zone; when the active person leaves that zone, the device immediately begins `home`.

---

## WS event contract

Namespaces under `autofollow:*`:

- `autofollow:state` — `{ active: boolean, personId: int|null, devicesEnabled: string[], zoneId: string|null }`
- `autofollow:tick` — `{ ts, personId, stagePos:{x,y,z}, devices: { [deviceId]: { mode:'absolute'|'delta', pan?, tilt?, zoom?, dPan?, dTilt? } } }`  emitted at 10–25 Hz, throttled to the tracking rate.
- `autofollow:zone-exit` — `{ personId, zoneId }` — followed immediately by per-device `home` commands.
- `autofollow:device-home` — `{ deviceId, reason: 'zone-exit'|'lost'|'manual' }`.

The Companion module translates each tick into variable updates and, where configured, fires an action (e.g. `autofollow.tick`) on every tick so operators can bind custom button behaviour.

---

## UI

New **"Auto-Follow"** section inside the Previs/Tracking workspace (only visible when module enabled):

1. **Device list:** table of configured devices (id, label, kind, zone, mode, status). Add / edit / delete.
2. **Device editor:** form for the record above, plus an inline calibration wizard.
3. **Zones:** an overlay mode in the 3D previs (WO-17) where the operator draws/edits floor-polygon zones; zones persist in state.
4. **Follow control:** one-click start/stop per tracked person, visible as chips on the tracking overlay.
5. **Live status:** for each enabled device, current pan/tilt/zoom, last-tick latency, "OK / CLAMPED / LOST" indicator.

Keyboard: `F` to start following the selected person, `Esc` to stop, `H` to force all devices home.

---

## Code map

| Concern | File |
|---------|------|
| Engine (tick loop, zone check, command compute) | `src/autofollow/engine.js` [NEW] |
| Device calibration math (affine fit) | `src/autofollow/calibration.js` [NEW] |
| Persistence (devices, zones) | `src/autofollow/store.js` [NEW] |
| REST routes | `src/autofollow/routes-autofollow.js` [NEW] |
| Module registration | `src/autofollow/register.js` [NEW] |
| WS namespace handler | `src/autofollow/ws-autofollow.js` [NEW] |
| Panel UI | `web/components/autofollow-panel.js` [NEW] |
| Device editor / wizard | `web/components/autofollow-device-editor.js` [NEW] |
| Zones overlay (hooks into previs canvas) | `web/components/autofollow-zones-overlay.js` [NEW] |
| Client state | `web/lib/autofollow-state.js` [NEW] |
| Styles | `web/styles/autofollow.css` [NEW] |
| Companion module bridge | `companion-module-highpass-highascg/src/autofollow-bridge.js` [NEW, sibling repo] |

---

## Tasks

### Phase 1 — Engine & data model
- [ ] **T31.1** Define the device record shape and add schema validation.
- [ ] **T31.2** Implement `src/autofollow/engine.js` subscribing to `tracking:persons`, holding `activePersonId`, and emitting `autofollow:tick` at up to 25 Hz.
- [ ] **T31.3** Implement point-in-polygon zone check (floor XY only) and `zone-exit` → per-device `home` trigger.
- [ ] **T31.4** Implement absolute and delta command modes; clamp to device `range`; emit per-device command objects.
- [ ] **T31.5** "Lost person" timeout (configurable, default 2 s) → treat as zone-exit.

### Phase 2 — Calibration
- [ ] **T31.6** Affine fit helper in `src/autofollow/calibration.js` (least-squares from ≥3 reference points).
- [ ] **T31.7** Per-device calibration wizard UI (capture origin, stage-left, stage-right, upstage, downstage, optional zoom reference).
- [ ] **T31.8** Dry-run preview: simulate a person walk and render expected device positions before arming.
- [ ] **T31.9** Zone editor inside the 3D previs (polygon draw on floor plane).

### Phase 3 — REST + WS + persistence
- [ ] **T31.10** `GET/POST/PUT/DELETE /api/autofollow/devices` + `/api/autofollow/zones` + `/api/autofollow/state`.
- [ ] **T31.11** `POST /api/autofollow/follow` `{ personId }` / `/api/autofollow/stop` / `/api/autofollow/home-all`.
- [ ] **T31.12** Broadcast `autofollow:*` events.
- [ ] **T31.13** Persistence via existing state store (namespaced under `features.autofollow`).

### Phase 4 — Companion bridge
- [ ] **T31.14** In `companion-module-highpass-highascg`, subscribe to the `autofollow:*` WS events.
- [ ] **T31.15** Auto-generate Companion variables per device: `<varPrefix>pan`, `<varPrefix>tilt`, `<varPrefix>zoom`, `<varPrefix>home_active`, plus global `af_person_id`, `af_person_x`, `af_person_y`, `af_person_z`, `af_active`.
- [ ] **T31.16** Companion actions: `Start Follow Person N`, `Stop Follow`, `Home All Devices`, `Set Device Home Now`.
- [ ] **T31.17** Companion feedbacks: `Is Tracking`, `Person In Zone <id>`, `Device Clamped`.

### Phase 5 — UI polish & safety
- [ ] **T31.18** Arming switch per device — engine ignores unarmed devices (operator protection).
- [ ] **T31.19** Global "Panic / All Home" big red button + keyboard shortcut.
- [ ] **T31.20** Rate-limit per-device command stream configurable (5/10/25 Hz).
- [ ] **T31.21** Simulation mode: run the whole engine against a scripted fake person so operators can rehearse without live cameras.

---

## Acceptance

- A PTZ camera (e.g. any VISCA-over-IP PTZ) and one moving-head fixture follow a tracked performer around the stage in real time, controlled only by Companion buttons bound to HighAsCG variables.
- When the performer walks off stage (leaves the zone), both devices return to `home` within ~200 ms.
- Disarming the device in HighAsCG immediately stops command emission; re-arming resumes without requiring re-calibration.
- Deleting `src/autofollow/` (per WO-30's deletion test) leaves the rest of the app — including tracking and previs — working normally.

---

## Open questions for next review

- Whether to ship a built-in VISCA / ONVIF driver as an opt-in alternative to Companion for installs that don't have Companion (probably "no" — explicitly out of scope for v1).
- Multi-person simultaneous follow (two performers, two PTZs each locked to one). v1 = single active person; v2 = per-device `personId` assignment.
- Predictive easing (exponential smoothing / kalman) to hide tracker jitter — prototype during T31.4, tune during T31.18.

---

## Work Log

### 2026-04-21 — Agent (Initial Work Order)

**Work Done:**
- Captured operator's follow-spot concept: calibrate each device → operator hits "Follow Person N" → HighAsCG streams per-device commands via Companion → zone-exit triggers auto-home.
- Defined device record, calibration wizard, WS event shape, Companion variable/action surface.
- Scoped the feature to live inside the optional Previs module (WO-30) so the whole thing disappears with the module.

**Status:** Work order created. Implementation pending.

**Instructions for Next Agent:** Do not start this WO until WO-19 is producing reliable `tracking:persons` events with stable IDs. The engine (T31.2) is straightforward; the calibration wizard (T31.6–T31.8) is where most operator-visible quality will come from — invest there.

---
*Work Order created: 2026-04-21 | Parent: 30_WO_PREVIS_TRACKING_MODULE.md*
