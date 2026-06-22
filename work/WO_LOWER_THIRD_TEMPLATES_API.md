# Work Order: Lower Third Templates — API & Server Integration

> **Date:** 2026-06-22
> **Status:** ✅ Templates created · ✅ API routes implemented · ✅ Router wired
> **Files:**
> - Templates: [`template/lower-thirds/`](file:///home/casparcg/highascg/template/lower-thirds)
> - API routes: [`src/api/routes-lower-thirds.js`](file:///home/casparcg/highascg/src/api/routes-lower-thirds.js)
> - Router: [`src/api/router.js`](file:///home/casparcg/highascg/src/api/router.js) (updated)
> - Album: [`work/LOWER_THIRD_ALBUM.md`](file:///home/casparcg/highascg/work/LOWER_THIRD_ALBUM.md)

---

## 1. API Endpoints

All endpoints are prefixed with `/api/lower-thirds/`.

### `GET /api/lower-thirds/templates`

List all available lower-third template variants.

**Response:**
```json
{
  "templates": [
    {
      "id": "lt-classic-box",
      "name": "Classic Box",
      "htmlPath": "lower-thirds/lt-classic-box.html",
      "available": true
    },
    ...
  ]
}
```

---

### `GET /api/lower-thirds/active`

Get the current lower-third state (what's loaded, playing, etc).

**Response:**
```json
{
  "templateId": "lt-frosted-glass",
  "data": [
    { "title": "John Smith", "subtitle": "Executive Producer" }
  ],
  "style": {
    "primaryColor": "#4fc3f7",
    "textColor": "#ffffff",
    "position": "left"
  },
  "playing": true,
  "activeStep": 0
}
```

---

### `POST /api/lower-thirds/load`

Load a template with data and styling. Sends `CG ADD` to CasparCG.

**Request body:**
```json
{
  "templateId": "lt-slide-bar",
  "data": [
    { "title": "Jane Doe", "subtitle": "Director" },
    { "title": "Bob Ross", "subtitle": "Artist" }
  ],
  "style": {
    "primaryColor": "#00bcd4",
    "textColor": "#ffffff",
    "position": "left"
  },
  "channel": 1,
  "layer": 20,
  "templateHostLayer": 1
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `templateId` | string | — | ID from the template catalog (e.g. `lt-frosted-glass`) |
| `data` | object / array | `[]` | Title/subtitle pairs; array for multi-step |
| `style.primaryColor` | string | `lightblue` | Accent / brand color |
| `style.textColor` | string | `#ffffff` | Text color |
| `style.position` | string | `left` | `left` · `center` · `right` |
| `style.customFont` | string | — | Filename of uploaded font (e.g., `MyFont.ttf`) |
| `style.speed` | number | `1.0` | Animation speed multiplier (e.g., `2.0` for 2x speed) |
| `style.gradientMid` | string | — | Middle gradient stop (gradient-wave only) |
| `style.gradientEnd` | string | — | End gradient stop (gradient-wave only) |
| `channel` | number | `1` | CasparCG channel |
| `layer` | number | `20` | CasparCG layer |
| `templateHostLayer` | number | `1` | CG template host layer |

---

### `POST /api/lower-thirds/update`

Update the text and/or style of the currently loaded lower third. Sends `CG UPDATE`.

**Request body:**
```json
{
  "data": { "title": "Updated Name", "subtitle": "New Title" },
  "style": { "primaryColor": "#ff6f00" }
}
```

> [!TIP]
> You can update just `data`, just `style`, or both. Existing style properties are merged (not replaced).

---

### `POST /api/lower-thirds/play`

Animate the loaded lower third into view. Sends `CG PLAY`.

**Request body (optional):**
```json
{ "channel": 1, "layer": 20, "templateHostLayer": 1 }
```

---

### `POST /api/lower-thirds/stop`

Animate the lower third off screen. Sends `CG STOP`.

**Request body (optional):**
```json
{ "channel": 1, "layer": 20, "templateHostLayer": 1 }
```

---

### `POST /api/lower-thirds/next`

Advance to the next data entry (animate out → apply next → animate in). Sends `CG NEXT`.

---

### `POST /api/lower-thirds/previous`

Go back one data entry. Sends `CG INVOKE "previous"`.

---

### `POST /api/lower-thirds/clear`

Remove the graphic entirely. Sends `CG REMOVE`. Resets all state.

---

### `GET /api/lower-thirds/fonts`

List available custom fonts uploaded to `template/fonts/`.

**Response:**
```json
{
  "fonts": [
    { "name": "Roboto-Bold.ttf", "url": "fonts/Roboto-Bold.ttf" }
  ]
}
```

---

### `POST /api/lower-thirds/fonts`

Upload a custom font file using `multipart/form-data`. The file is saved to `template/fonts/`.

**Response:**
```json
{ "ok": true, "filename": "Roboto-Bold.ttf" }
```

---

### `DELETE /api/lower-thirds/fonts/:filename`

Delete a specific font file.

**Response:**
```json
{ "ok": true }
```

---

## 2. WebSocket Events

When state changes, the server broadcasts via the existing WebSocket:

| Event | Payload |
|---|---|
| `lower-third.state` | Full or partial state object (`templateId`, `data`, `style`, `playing`, `activeStep`) |

**Client subscription** — the standard HighAsCG WebSocket already receives these as `{ type: 'lower-third.state', payload: {...} }`.

---

## 3. HTTP Polling (Template-side)

Templates support `?poll=<url>&interval=<ms>` query parameters. When loaded in CasparCG with these params, the template polls the server for content updates (useful for non-AMCP setups):

```
http://localhost:8080/templates/lower-thirds/lt-frosted-glass.html?poll=http://localhost:8080/api/lower-thirds/active&interval=2000
```

---

## 4. Client Usage Examples

### curl — Load and play a lower third

```bash
# Load
curl -X POST http://localhost:8080/api/lower-thirds/load \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "lt-frosted-glass",
    "data": { "title": "John Smith", "subtitle": "CEO" },
    "style": { "primaryColor": "#4fc3f7" }
  }'

# Play
curl -X POST http://localhost:8080/api/lower-thirds/play

# Update text on the fly
curl -X POST http://localhost:8080/api/lower-thirds/update \
  -H 'Content-Type: application/json' \
  -d '{ "data": { "title": "Jane Doe", "subtitle": "CTO" } }'

# Stop
curl -X POST http://localhost:8080/api/lower-thirds/stop

# Clear
curl -X POST http://localhost:8080/api/lower-thirds/clear
```

### JavaScript client

```javascript
async function showLowerThird(name, role, template = 'lt-frosted-glass') {
  await fetch('/api/lower-thirds/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      templateId: template,
      data: { title: name, subtitle: role },
      style: { primaryColor: '#00bcd4' }
    })
  });
  await fetch('/api/lower-thirds/play', { method: 'POST' });
}

// Update text dynamically
async function updateLowerThirdText(name, role) {
  await fetch('/api/lower-thirds/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { title: name, subtitle: role }
    })
  });
}

// List available templates
async function listTemplates() {
  const res = await fetch('/api/lower-thirds/templates');
  const { templates } = await res.json();
  return templates;
}
```

---

## 5. What Was Done (Server Side)

| Item | File | Status |
|---|---|---|
| 9 lower-third HTML templates | `template/lower-thirds/lt-*.html` | ✅ Created |
| Shared animation engine | `template/lower-thirds/lt-engine.js` | ✅ Created |
| API route handler | `src/api/routes-lower-thirds.js` | ✅ Created |
| Router integration | `src/api/router.js` | ✅ Wired (before Caspar gate) |
| Template album catalog | `work/LOWER_THIRD_ALBUM.md` | ✅ Created |

---

## 6. Remaining / Optional Work

| Item | Priority | Notes |
|---|---|---|
| Client UI panel for lower thirds | Medium | Dropdown for template, text fields, color picker, play/stop buttons |
| Preset system | Medium | Save/recall named presets (name+style combos) to disk |

---

## 7. Template File Map

```
template/lower-thirds/
├── lt-engine.js              ← shared engine (CasparCG + animation queue + HTTP poll)
├── lt-classic-box.html       ← SVG-bordered box (original style)
├── lt-slide-bar.html         ← horizontal bar sliding from left
├── lt-minimal-fade.html      ← no background, accent bar + fade
├── lt-split-color.html       ← dual panels sliding from opposite sides
├── lt-frosted-glass.html     ← glassmorphism / backdrop blur
├── lt-underline-reveal.html  ← gradient underline reveal
├── lt-tag-badge.html         ← colored badge + name panel
├── lt-gradient-wave.html     ← diagonal clip-path gradient
└── lt-corner-bracket.html    ← four animated corner brackets (esports)
```
