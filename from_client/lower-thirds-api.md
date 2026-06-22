# Lower-Third Templates Playout API

This API enables client applications to discover, load, style, play, update, and clear lower-third graphic templates on CasparCG.

## Summary of Endpoints

| Method | Endpoint | Description |
|:---|:---|:---|
| **GET** | `/api/lower-thirds/templates` | List all templates and check availability |
| **GET** | `/api/lower-thirds/active` | Retrieve current playout and data state |
| **POST** | `/api/lower-thirds/load` | Load data + style into a template on CasparCG |
| **POST** | `/api/lower-thirds/update` | Update text and styling on-the-fly |
| **POST** | `/api/lower-thirds/play` | Animate the graphic onto the screen |
| **POST** | `/api/lower-thirds/stop` | Animate the graphic off the screen |
| **POST** | `/api/lower-thirds/next` | Advance to the next item (multi-step graphics) |
| **POST** | `/api/lower-thirds/previous` | Go back one item (multi-step graphics) |
| **POST** | `/api/lower-thirds/clear` | Stop playout and completely clear state/graphics |
| **GET** | `/api/lower-thirds/fonts` | List custom uploaded fonts |
| **POST** | `/api/lower-thirds/fonts` | Upload a custom `.ttf` or `.otf` font file |
| **POST** | `/api/lower-thirds/fonts/delete/:filename` | Delete an uploaded font file |

---

## 1. Catalog & State

### `GET /api/lower-thirds/templates`
List all templates cataloged on the server and check if their physical HTML files exist.

**Response (200):**
```json
{
  "templates": [
    {
      "id": "lt-classic-box",
      "name": "Classic Box",
      "htmlPath": "lower-thirds/lt-classic-box.html",
      "available": true
    },
    {
      "id": "lt-slide-bar",
      "name": "Slide Bar",
      "htmlPath": "lower-thirds/lt-slide-bar.html",
      "available": true
    }
  ]
}
```

### `GET /api/lower-thirds/active`
Retrieve the current configuration and playout state of the lower third.

**Response (200):**
```json
{
  "templateId": "lt-classic-box",
  "data": [
    { "name": "Alex Rivera", "title": "Lead Designer" }
  ],
  "style": {
    "primaryColor": "#00bcd4",
    "textColor": "#ffffff",
    "position": "left",
    "speed": 1
  },
  "playing": true,
  "activeStep": 0
}
```

---

## 2. Playout Commands

### `POST /api/lower-thirds/load`
Pre-loads a template onto a CasparCG channel and layer, preparing its styling and content without showing it.

**Request Body:**
```json
{
  "templateId": "lt-classic-box",
  "data": {
    "name": "Alex Rivera",
    "title": "Lead Designer"
  },
  "style": {
    "primaryColor": "#00bcd4",
    "textColor": "#ffffff",
    "position": "left",
    "speed": 1.2,
    "customFont": "Roboto-Bold.ttf"
  },
  "channel": 3,
  "layer": 20,
  "templateHostLayer": 1
}
```

#### Playout Parameters
* **`templateId`** *(string, required)*: The template identifier (e.g. `lt-classic-box`).
* **`data`** *(object or array, optional)*: Single object or array of objects containing text keys. See [Data Schema](#data-schema) below.
* **`style`** *(object, optional)*: Style configuration parameters. See [Style Options](#style-options) below.
* **`channel`** *(integer, optional, default: `1`)*: The active CasparCG channel to target.
* **`layer`** *(integer, optional, default: `20`)*: The CasparCG layer to load the template into.
* **`templateHostLayer`** *(integer, optional, default: `1`)*: CasparCG internal flash/CEF template host index.

---

### `POST /api/lower-thirds/update`
Dynamically update content and/or styles while the graphic is active or loaded. The server forwards a `CG UPDATE` to CasparCG.

**Request Body:**
```json
{
  "data": {
    "name": "Jane Doe",
    "title": "Director"
  },
  "style": {
    "primaryColor": "#ff5722"
  }
}
```
*Note: Fields inside the `style` object are merged with existing styling; only specify fields that are changing.*

---

### `POST /api/lower-thirds/play`
Animates the loaded lower third template into view.

**Request Body (optional):**
```json
{
  "channel": 3,
  "layer": 20,
  "templateHostLayer": 1
}
```

---

### `POST /api/lower-thirds/stop`
Animates the graphic out of view (runs the template's out-transition).

**Request Body (optional):**
```json
{
  "channel": 3,
  "layer": 20,
  "templateHostLayer": 1
}
```

---

### `POST /api/lower-thirds/next` / `POST /api/lower-thirds/previous`
Advance or reverse when using multi-step datasets (e.g. loading a list of people in a single load command). Performs transition animations.

---

### `POST /api/lower-thirds/clear`
Instantly removes the template container from CasparCG and resets server-side lower-thirds state.

---

## Data Schema & Variable Mapping

To ensure compatibility with custom templates, standard CasparCG controllers, and legacy clients, the template engine supports multiple key mappings for content. In descending order of priority, the template resolves elements to:

### Primary Text (e.g., Person's Name)
1. **`f0`** — Standard CasparCG client field label.
2. **`name`** — Recommended field name for name-based lower thirds.
3. **`title`** — Falls back to `title` only when `name` is undefined (useful for general announcements).

### Secondary Text (e.g., Role / Location)
1. **`f1`** — Standard CasparCG client field label.
2. **`subtitle`** — Recommended field name for subtitle / location / details.
3. **`title`** — Acts as secondary text when `name` is also present (e.g., `{ "name": "John", "title": "Producer" }`).
4. **`role`** — Alternate fallback.
5. **`description`** — Alternate fallback.

#### Example Payload using recommended fields:
```json
{
  "data": {
    "name": "Alex Rivera",
    "title": "Lead Designer"
  }
}
```

---

## Style Options

* **`primaryColor`** *(string)*: Branding accent color. Supports Hex (`#00bcd4`) or standard CSS names (`red`).
* **`textColor`** *(string)*: Color applied to primary text.
* **`position`** *(string)*: Vertical/horizontal alignment. Supported values: `left` (default), `center`, `right`.
* **`speed`** *(number)*: Animation speed multiplier. E.g., `1.5` speeds up GSAP timelines by 50%.
* **`displayDurationSec`** *(number)*: Seconds on air after animate-in before auto animate-out. Default **`10`**. Set **`0`** to hold until `POST /api/lower-thirds/stop` or CG STOP.
* **`customFont`** *(string)*: The filename of an uploaded font (e.g. `Montserrat-Regular.ttf`).

---

## Custom Font Management

### `GET /api/lower-thirds/fonts`
List all custom fonts saved in the template fonts directory.

**Response (200):**
```json
{
  "fonts": [
    { "name": "Roboto-Bold.ttf", "url": "fonts/Roboto-Bold.ttf" }
  ]
}
```

### `POST /api/lower-thirds/fonts`
Upload a new font file using standard `multipart/form-data`.

* **Request Field:** `file` containing the binary font file.
* **Response (200):**
  ```json
  { "ok": true, "filename": "Montserrat-Regular.ttf" }
  ```

### `POST /api/lower-thirds/fonts/delete/:filename`
Remove a custom font.

* **Response (200):**
  ```json
  { "ok": true }
  ```
