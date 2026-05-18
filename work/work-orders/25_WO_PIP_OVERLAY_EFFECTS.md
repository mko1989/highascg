# Work Order 25: PIP Overlay Effects — Borders, Shadows & Edge Strips via CasparCG HTML Templates

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Add **PIP overlay effects** — customizable borders, drop shadows, and animated edge strips — to HighAsCG. These effects run as **CasparCG HTML templates** on a dedicated overlay layer above each PIP source, driven by `CG ADD` / `CG UPDATE` with JSON parameters.

Unlike WO-22 mixer effects (which use `MIXER` AMCP commands on the source layer itself), PIP overlay effects are **separate CasparCG layers** that composite HTML graphics on top of or around the PIP content.

**Key principles:**
- Each PIP overlay effect is an **HTML template** deployed to Caspar's `/opt/casparcg/template/` directory
- HighAsCG **auto-deploys** templates and **verifies** their presence on connect (like `black.html` and `multiview_overlay.html`)
- Effects are **customizable** — border width, color, corner radius, shadow blur/offset, animated strip speed/color
- Effects use `CG ADD` + `CG UPDATE` to apply and adjust parameters in real-time
- The overlay layer sits **above** the PIP content layer using `MIXER FILL` matching the PIP's position
- Data model: `layer.pipOverlay` object on scene layers, persisted in scene state

---

## Architecture

### Layer Strategy

For a PIP on Caspar layer N (e.g. layer 10), the overlay goes on layer **N+100** (e.g. 110). This avoids collisions with other content layers while keeping overlay–source pairs discoverable.

```
Layer  10: PLAY 1-10 "my_video"              ← PIP content
Layer  10: MIXER 1-10 FILL 0.6 0.0 0.4 0.5   ← position/scale
Layer 110: CG 1-110 ADD 0 "pip_border" 1 <data>  ← HTML overlay
Layer 110: MIXER 1-110 FILL 0.6 0.0 0.4 0.5   ← same position
Layer 110: MIXER 1-110 KEYER 1                 ← alpha key
```

### Overlay Layer Offset

```js
const PIP_OVERLAY_LAYER_OFFSET = 100
function overlayLayer(contentLayer) { return contentLayer + PIP_OVERLAY_LAYER_OFFSET }
```

Reserved layer range: content layers 10–99, overlays 110–199.

### HTML Template Architecture

Each template is a self-contained HTML file that:
1. Fills the full CG layer viewport (matches the PIP `MIXER FILL` rect)
2. Draws the effect using CSS (borders, shadows, animations) — no canvas/WebGL
3. Exposes `window.update(jsonString)` for parameter updates via `CG UPDATE`
4. Has transparent background (`background: transparent`) so only the effect composites

### Data Model

```js
// Added to layer config (scene-state.js defaultLayerConfig):
pipOverlay: null   // or { type, params }

// Example:
pipOverlay: {
  type: 'border',
  params: {
    width: 4,
    color: '#e63946',
    radius: 0,
    opacity: 1,
  }
}
```

### Template Types

| Type | Template File | Description |
|------|--------------|-------------|
| `border` | `pip_border.html` | Solid or gradient border with configurable width, color, radius, opacity |
| `shadow` | `pip_shadow.html` | Drop shadow effect (CSS box-shadow inset or outset simulation) |
| `edge_strip` | `pip_edge_strip.html` | Animated strip that runs along one or more edges of the PIP |
| `glow` | `pip_glow.html` | Animated pulsing glow around PIP edges |

---

## Tasks

### T1: HTML Templates

- [x] T1.1: Create `pip_border.html` — solid/gradient border with `update()` API
- [x] T1.2: Create `pip_shadow.html` — drop shadow with configurable blur, offset, color
- [x] T1.3: Create `pip_edge_strip.html` — animated strip running along configurable edges
- [x] T1.4: Create `pip_glow.html` — pulsing glow effect around PIP border

### T2: Template Auto-Deploy & Verification

- [x] T2.1: Add PIP overlay templates to `setupAllRouting()` auto-deploy (routing.js)
- [x] T2.2: Verify template presence on connect — log warnings if missing from `/opt/casparcg/template/`
- [x] T2.3: Add `GET /api/pip-overlay/templates` endpoint to check template status

### T3: PIP Overlay Registry (Client & Server)

- [x] T3.1: Create `pip-overlay-registry.js` (shared definitions — type, label, defaults, schema)
- [x] T3.2: Server-side `buildPipOverlayAmcpLines()` in scene-take-lbg.js
- [x] T3.3: Wire into `runSceneTakeLbg()` — CG ADD overlay after content PLAY

### T4: Scene State & Data Model

- [x] T4.1: Add `pipOverlay` to `defaultLayerConfig()` in scene-state.js
- [x] T4.2: Migrate existing scenes (null default)
- [x] T4.3: Include pipOverlay in copy/paste layer style

### T5: Inspector UI

- [x] T5.1: Add "PIP Overlay" section to layer inspector (below mixer effects)
- [x] T5.2: Type selector dropdown + parameter editors per type
- [x] T5.3: Live on PGM — debounced `/api/pip-overlay/update` (same stack shape) or remove+reapply when stack/order/types change (`inspector-pip-overlay.js` `scheduleLivePipOverlayPush`)
- [x] T5.4: Remove per overlay (+ clear stack when empty); stacked overlays with reorder

### T6: API Routes

- [x] T6.1: `POST /api/pip-overlay/apply` — manually apply overlay to channel-layer
- [x] T6.2: `POST /api/pip-overlay/update` — update overlay params (CG UPDATE)
- [x] T6.3: `POST /api/pip-overlay/remove` — remove overlay (CG REMOVE)
- [x] T6.4: `GET /api/pip-overlay/templates` — list deployed templates + verify

---

## Template Parameter Schemas

### pip_border

| Param | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `width` | float | 4 | 0–50 | Border width in px (scaled to viewport %) |
| `color` | string | `#e63946` | — | CSS color |
| `radius` | float | 0 | 0–50 | Corner radius in px |
| `opacity` | float | 1 | 0–1 | Border opacity |
| `style` | select | `solid` | solid/dashed/double/gradient | Border style |
| `gradientEnd` | string | `#457b9d` | — | Second color (for gradient style) |

### pip_shadow

| Param | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `blur` | float | 20 | 0–100 | Shadow blur radius |
| `offsetX` | float | 5 | -50–50 | Horizontal offset |
| `offsetY` | float | 5 | -50–50 | Vertical offset |
| `color` | string | `rgba(0,0,0,0.6)` | — | Shadow color |
| `spread` | float | 0 | -20–20 | Shadow spread |

### pip_edge_strip

| Param | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `edge` | select | `bottom` | top/right/bottom/left/all | Which edge(s) |
| `thickness` | float | 3 | 1–20 | Strip thickness in px |
| `color` | string | `#e63946` | — | Strip color |
| `speed` | float | 2 | 0.1–10 | Animation speed (seconds per cycle) |
| `length` | float | 30 | 5–100 | Strip length as % of edge |
| `glow` | bool | true | — | Add glow trail |
| `glowColor` | string | `#ff6b6b` | — | Glow trail color |

### pip_glow

| Param | Type | Default | Range | Description |
|-------|------|---------|-------|-------------|
| `color` | string | `#e63946` | — | Glow color |
| `intensity` | float | 15 | 1–50 | Glow blur radius |
| `pulse` | bool | true | — | Animate pulsing |
| `pulseSpeed` | float | 2 | 0.5–8 | Pulse cycle in seconds |
| `minOpacity` | float | 0.4 | 0–1 | Minimum opacity during pulse |

---

## File Map

| File | Changes |
|------|---------|
| `templates/pip_border.html` | **NEW** — HTML template |
| `templates/pip_shadow.html` | **NEW** — HTML template |
| `templates/pip_edge_strip.html` | **NEW** — HTML template |
| `templates/pip_glow.html` | **NEW** — HTML template |
| `web/lib/pip-overlay-registry.js` | **NEW** — Type definitions, schemas, defaults |
| `web/components/inspector-pip-overlay.js` | **NEW** — Inspector UI section |
| `src/engine/pip-overlay.js` | **NEW** — Server-side overlay AMCP builder |
| `src/api/routes-pip-overlay.js` | **NEW** — API routes |
| `src/config/routing.js` | **EDIT** — Auto-deploy PIP templates |
| `src/engine/scene-take-lbg.js` | **EDIT** — Wire overlay CG layer on take |
| `web/lib/scene-state.js` | **EDIT** — Add `pipOverlay` to layer config |
| `web/components/inspector-panel.js` | **EDIT** — Include PIP overlay section |

---

## Work Log

### 2026-04-22 — Agent (T5 live PGM sync + WO closure)

- **T5.3:** When `liveSceneId` matches the edited look, PIP overlay edits debounce to **`/api/pip-overlay/update`** per slot if overlay types/count/order are unchanged; otherwise **`remove`** then sequential **`apply`**.
- Inspector UI was already present (`inspector-pip-overlay.js`); work order checkboxes brought in sync.

### 2026-04-13 — Initial creation + T1–T4, T6

- Created work order document
- Implemented all four HTML templates (pip_border, pip_shadow, pip_edge_strip, pip_glow)
- Created pip-overlay-registry.js (shared type definitions and schemas)
- Created server-side pip-overlay.js (AMCP command builder)
- Added pipOverlay to defaultLayerConfig in scene-state.js
- Added auto-deploy logic to routing.js setupAllRouting
- Wired overlay CG layer into scene-take-lbg.js
- Created API routes in routes-pip-overlay.js
- **Instructions for Next Agent:** Superseded by 2026-04-22 — T5 complete.
