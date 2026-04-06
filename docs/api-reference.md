# AMCP REST API Reference

HighAsCG maps subset functionality of the underlying CasparCG AMCP protocol into an easy-to-use HTTP REST JSON API. All endpoints are accessible via `http://localhost:<PORT>/api`.

All server responses include standard headers and use the `application/json` format.

## Table of Contents
1. [Basic Playback Commands](#1-basic-playback-commands)
2. [Mixer Commands](#2-mixer-commands)
3. [CG (Template) Commands](#3-cg-template-commands)
4. [Data & Project Commands](#4-data--project-commands)
5. [State & Query Commands](#5-state--query-commands)
6. [Thumbnail & Media Commands](#6-thumbnail--media-commands)
7. [System & Control Commands](#7-system--control-commands)

---

## 1. Basic Playback Commands

### `POST /api/play`
Play a clip on a channel and layer.
- **Body:**
  ```json
  {
    "channel": 1,
    "layer": 10,
    "clip": "AMB",
    "loop": true,
    "transition": "MIX",
    "duration": 50,
    "tween": "easeInCubic",
    "auto": false,
    "parameters": ""
  }
  ```
- **Example:**
  ```bash
  curl -X POST -H "Content-Type: application/json" -d '{"clip":"AMB","loop":true,"channel":1,"layer":10}' http://localhost:8080/api/play
  ```
  ```javascript
  fetch('/api/play', { method: 'POST', body: JSON.stringify({ clip: 'AMB', channel: 1, layer: 10, loop: true }) })
  ```

### `POST /api/load`, `POST /api/loadbg`
Loads a clip (or loads it into the background) onto a channel and layer. Wait for `POST /api/play` to trigger if BG.
- **Body Schema:** Same as `/api/play`.

### `POST /api/pause`, `POST /api/resume`, `POST /api/stop`, `POST /api/clear`
Controls the playback state or clears the layer content entirely.
- **Body:** `{ "channel": 1, "layer": 10 }`

### `POST /api/print`, `POST /api/log/level`, `POST /api/log/category`
Controls CasparCG disk writing/logging settings.
- **Bodies:**
  - `print`: `{ "channel": 1 }`
  - `log/level`: `{ "level": "trace" }`
  - `log/category`: `{ "category": "calltrace", "enable": true }`

---

## 2. Mixer Commands

Mixer commands can be accessed via `POST` (to mutate) or `GET` (to query properties).

### `POST /api/mixer/:command`
Changes mixer configurations for a layer.
- **Path parameters:** `command` can be `keyer`, `blend`, `chroma`, `invert`, `straight_alpha`, `opacity`, `brightness`, `saturation`, `contrast`, `levels`, `fill`, `clip`, `anchor`, `crop`, `rotation`, `volume`, `mastervolume`, `grid`, `commit`, `clear`.
- **Body Defaults:** `{ "channel": 1, "layer": 10 }`
- **Example (`opacity`):**
  ```json
  {
    "channel": 1, 
    "layer": 10,
    "opacity": 0.5,
    "duration": 25,
    "tween": "linear"
  }
  ```

### `GET /api/mixer/:command?channel=X&layer=Y`
Queries the value of the mixer property (e.g. `GET /api/mixer/opacity?channel=1&layer=10`).
- **Response:**
  ```json
  {
    "ok": true,
    "data": "0.5"
  }
  ```

---

## 3. CG (Template) Commands

Controls HTML and Flash templates running in the CG layer.

### `POST /api/cg/add`
Adds a template to a specific host layer.
- **Body:**
  ```json
  {
    "channel": 1,
    "layer": 20,
    "templateHostLayer": 1,
    "template": "my-template",
    "playOnLoad": true,
    "data": "<templateData><componentData id=\"f0\"><data id=\"text\" value=\"Hello World\"/></componentData></templateData>"
  }
  ```

### `POST /api/cg/update`
Updates template parameters.
- **Body:** `{ "channel": 1, "layer": 20, "templateHostLayer": 1, "data": "<xml...>" }`

### `POST /api/cg/play`, `POST /api/cg/stop`, `POST /api/cg/next`, `POST /api/cg/invoke`
Controls playback of templates, triggers animations, or invokes JS methods.

---

## 4. Data & Project Commands

Stores and retrieves raw strings to CasparCG disk (for memory caching) as well as handles project states.

### `POST /api/data/store`
- **Body:** `{ "name": "my_dataset", "data": "<dataset>..." }`

### `POST /api/data/retrieve`, `POST /api/data/remove`
- **Body:** `{ "name": "my_dataset" }`

### `POST /api/data/list`
Lists datasets stored in CasparCG.

### `POST /api/project/save`, `POST /api/project/load`
Saves and loads a full HighAsCG project payload into a Caspar dataset (`casparcg_web_project`).

---

## 5. State & Query Commands

Extracts core statuses and telemetry from CasparCG.

### `GET /api/state`
Returns the merged state tree of the HighAsCG app + Caspar variables and channels.

### `GET /api/server`, `GET /api/server/queues`, `GET /api/server/threads`, `GET /api/server/gl`
Gets information about the underlying CasparCG running server.

### `GET /api/fonts`, `GET /api/help/:command`
Returns all fonts available and documentation on commands.

### `GET /api/channels/:id`, `GET /api/channels/:id/delay`
Fetches parsed XML info arrays of what is loaded inside a channel (`INFO X`).

---

## 6. Thumbnail & Media Commands

### `GET /api/thumbnails`
Lists all available thumbnails.

### `GET /api/thumbnail/:filename`
Returns a binary PNG response of the requested media thumbnail.

### `POST /api/thumbnails/generate`, `POST /api/thumbnails/generate-all`
Commands Caspar to regenerate base64 thumb streams.
- **Generate Body:** `{ "filename": "AMB" }`

---

## 7. System & Control Commands

### `POST /api/restart`, `POST /api/kill`
Restarts the underlying AMCP connections and internal structures, or sends `KILL` to shut off the CasparCG instance entirely.
- **Body:** `{}`

### `POST /api/diag`, `POST /api/gl/gc`
Show diagnostic screens or trigger OpenGL Garbage Collection.
- **Body:** `{}`

### `POST /api/raw`
Arbitrary AMCP payload dispatching.
- **Body:** `{ "cmd": "PLAY 1-1 AMB LOOP" }`
