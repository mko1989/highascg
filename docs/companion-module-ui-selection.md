# Companion module: UI selection variables (`ui_selection_*`)

HighAsCG pushes **inspector selection** from the web UI into the same **Companion-style variable map** used for OSC, channel INFO, and app stats. A Bitfocus **Companion module** that talks to HighAsCG over HTTP/WebSocket can mirror these into Companion’s own variables for buttons, triggers, and expressions.

## Behaviour (already implemented in HighAsCG)

1. When the user selects something in the inspector (looks editor layer, timeline clip, multiview cell), the browser calls **`POST /api/selection`** with a JSON body (debounced ~100 ms). See `client/lib/selection-sync.js` (`buildSelectionPayload`, `scheduleSelectionSync`).
2. The server applies that payload with `applyUiSelectionPayloadToVariables` (`src/api/apply-ui-selection-variables.js`), which calls `state.setVariable(key, stringValue)` for each field.
3. Variables appear in **`GET /api/variables`** (full map) and **`GET /api/variables?prefix=ui_selection_`** (subset). Updates are also emitted on the WebSocket as **`variable_update`** with a partial `{ [key]: value }` object (see `src/server/ws-server.js`).

Optional: WebSocket message **`{ "type": "selection_sync", "data": <same shape as POST body> }`** calls `ctx.setUiSelection` (`index.js`) and runs the same mapper—useful if a client prefers WS over HTTP.

## Implementing in a Companion module

1. **Subscribe to changes** (recommended): open `ws://<highascg-host>:<port>/api/ws` (or `/instance/<id>/api/ws` when using the instance URL prefix). On **`variable_update`**, copy any keys starting with `ui_selection_` into Companion via `setVariableValues` / your module’s variable API.
2. **Or poll**: periodically **`GET /api/variables?prefix=ui_selection_`** and diff against the previous snapshot; push updates when values change.
3. **Define variables** in the module so they appear in Companion’s UI: register definitions for the keys you care about (or a dynamic prefix-based approach if your framework supports it). All values are **strings** (booleans use `'true'` / `'false'` / `''`).
4. **`GET /api/state`** includes a `variables` object with the full snapshot; heavier than `prefix=` query but useful for initial sync after connect.

## `ui_selection_context`

| `ui_selection_context` | Meaning | Variable prefix for detail fields |
|------------------------|---------|-----------------------------------|
| `none` | No actionable selection (details cleared) | — |
| `scene_layer` | Look editor / scene layer selected | `ui_selection_look_*` |
| `timeline_clip` | Timeline clip selected | `ui_selection_tl_*` |
| `multiview` | Multiview cell selected | `ui_selection_mv_*` |

Always read **`ui_selection_context`** first; when it changes, ignore stale keys from another prefix until new values arrive (HighAsCG clears all owned keys on each update).

## Useful keys (looks editor)

- **`ui_selection_label`** — short label (e.g. `L10`).
- **`ui_selection_look_id`** / **`ui_selection_look_name`** — look id and display name.
- **`ui_selection_look_layer_index`**, **`ui_selection_look_layer_number`**, **`ui_selection_look_caspar_layer`**, **`ui_selection_look_preview_channel`** — routing indices.
- **`ui_selection_look_fill_*`**, **`rotation`**, **`opacity`**, **`ui_selection_look_source_*`** — geometry and source.
- **`ui_selection_look_layer_json`** — full JSON snapshot of the selected layer object (effects, transition, PIP overlays, etc.). Prefer individual keys when possible; use JSON for exhaustive access.

Full key list is the `ALL_UI_SELECTION_KEYS` array in `src/api/apply-ui-selection-variables.js`.

## Companion-style URL prefix

If the UI is loaded as `http://host:port/instance/myid/`, API paths are **`/instance/myid/api/variables`**, **`/instance/myid/api/selection`**, **`/instance/myid/api/ws`** — the server accepts these without stripping the prefix.

## Related files

**See also:** [WebSocket slim bootstrap & catalog loading](./companion-websocket-catalog-bootstrap.md) — first `state` may omit `media` / `templates` when slim bootstrap is enabled.

| Area | File |
|------|------|
| Client payload | `client/lib/selection-sync.js` |
| Server → variables | `src/api/apply-ui-selection-variables.js` |
| HTTP route | `src/api/router.js` (`POST /api/selection`) |
| Variable HTTP API | `src/api/routes-state.js` |
| WS broadcast | `src/server/ws-server.js` |
