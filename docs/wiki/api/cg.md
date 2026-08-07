# CG API — HTML templates (`CG` AMCP)

CasparCG **HTML/template CG** commands on a channel layer. Templates live under the Caspar template path; data payloads are XML/JSON strings passed on add/update.

**Caspar:** required (`503` if AMCP is down).

**Implementation:** [`src/api/routes-cg.js`](../../../src/api/routes-cg.js) · AMCP: [`src/caspar/amcp-cg.js`](../../../src/caspar/amcp-cg.js)

**AMCP table:** [`docs/reference/amcp-mapping.md`](../../reference/amcp-mapping.md)

Mixer and scene APIs: [mixer.md](mixer.md), [scene-take.md](scene-take.md).

---

## Endpoint pattern

```http
POST /api/cg/{command}
Content-Type: application/json
```

| `{command}` | AMCP | Description |
|-------------|------|-------------|
| `add` | `CG ADD` | Register template on layer |
| `remove` | `CG REMOVE` | Remove template instance |
| `clear` | `CG CLEAR` | Clear all CG on layer |
| `play` | `CG PLAY` | Play template |
| `stop` | `CG STOP` | Stop template |
| `next` | `CG NEXT` | Next step/page |
| `goto` | `CG GOTO` | Jump to label |
| `update` | `CG UPDATE` | Push new template data |
| `invoke` | `CG INVOKE` | Call template method |
| `info` | `CG INFO` | Query template state |

Unknown command → **400** `{ "error": "Unknown CG command: …" }`.

---

## Common request fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `channel` | number | `1` | Caspar channel |
| `layer` | number | — | Caspar layer hosting CG (`channel-layer`) |
| `templateHostLayer` | number | `1` | CG sub-layer index on that layer (Caspar “template layer”) |
| `template` | string | — | Template name (for `add`) |
| `playOnLoad` | boolean | `false` | `1` / `0` on `CG ADD` |
| `data` | string | — | Template data XML/JSON (add/update) |
| `label` | string | — | Goto label (`goto`) |
| `method` | string | — | Method name (`invoke`) |

AMCP shape: `CG {channel}-{layer} {SUBCMD} {templateHostLayer} …`

Example: channel `1`, layer `10`, template host `1` → `CG 1-10 ADD 1 "my_template" 1 <data…>`.

---

## Commands

### `POST /api/cg/add`

Load a template onto the layer.

```json
{
  "channel": 1,
  "layer": 10,
  "templateHostLayer": 1,
  "template": "lower_third",
  "playOnLoad": true,
  "data": "<template><text id=\"title\">Hello</text></template>"
}
```

When `data` is non-empty, the server sends **raw** AMCP (escaping handled in [`amcp-cg.js`](../../../src/caspar/amcp-cg.js)). Empty data uses typed `cgAdd`.

### `POST /api/cg/update`

Replace template data without re-adding:

```json
{
  "channel": 1,
  "layer": 10,
  "templateHostLayer": 1,
  "data": "<template><text id=\"title\">Updated</text></template>"
}
```

### `POST /api/cg/play` · `stop` · `next`

```json
{ "channel": 1, "layer": 10, "templateHostLayer": 1 }
```

### `POST /api/cg/goto`

```json
{
  "channel": 1,
  "layer": 10,
  "templateHostLayer": 1,
  "label": "slide2"
}
```

### `POST /api/cg/invoke`

```json
{
  "channel": 1,
  "layer": 10,
  "templateHostLayer": 1,
  "method": "refresh"
}
```

### `POST /api/cg/remove`

```json
{ "channel": 1, "layer": 10, "templateHostLayer": 1 }
```

### `POST /api/cg/clear`

Clears **all** CG templates on the layer (no `templateHostLayer` in AMCP):

```json
{ "channel": 1, "layer": 10 }
```

### `POST /api/cg/info`

```json
{ "channel": 1, "layer": 10, "templateHostLayer": 1 }
```

Omit `templateHostLayer` to query layer-level CG info.

---

## Examples

```bash
# Add lower third and auto-play
curl -s -X POST http://127.0.0.1:4200/api/cg/add \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": 1,
    "layer": 998,
    "templateHostLayer": 1,
    "template": "lt",
    "playOnLoad": true,
    "data": "<template><text>ON AIR</text></template>"
  }'

# Update text
curl -s -X POST http://127.0.0.1:4200/api/cg/update \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": 1,
    "layer": 998,
    "templateHostLayer": 1,
    "data": "<template><text>OFF AIR</text></template>"
  }'

# Remove
curl -s -X POST http://127.0.0.1:4200/api/cg/remove \
  -H 'Content-Type: application/json' \
  -d '{"channel":1,"layer":998,"templateHostLayer":1}'
```

```javascript
await fetch(`${apiBase}/api/cg/add`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    channel: 1,
    layer: 10,
    template: 'clock',
    playOnLoad: true,
    data: '<template></template>',
  }),
})
```

---

## Responses

**200** — Passthrough Caspar JSON (`ok`, `data`, …).

**502** — AMCP/command failure.

**503** — Caspar not connected.

---

## Templates list

Discover template names via **`GET /api/templates`** (requires Caspar) or **`GET /api/state`** → `templates` array.

---

## Related

| Doc | Topic |
|-----|--------|
| [state-and-media.md](state-and-media.md) | `/api/state`, media index |
| [mixer.md](mixer.md) | Layer opacity/fill (often combined with CG overlays) |
| [scene-take.md](scene-take.md) | Look layers may use `source.type: "cg"` |

---

## OpenAPI

[`openapi.yaml`](openapi.yaml) — `CgCommand`, `CgAddRequest`, shared `CgLayerRequest`.
