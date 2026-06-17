# ALSA mixer API (server handoff)

**Server:** `src/audio/alsa-mixer.js` · **Routes:** `src/api/routes-audio.js`


Client UI: **Application Settings → Live audio → ALSA mixer** (`client/components/settings-alsa-mixer-panel.js`).

The web client exposes alsamixer-style sliders (card picker, Playback/Capture/All view, volume faders, mute, enum/switch controls). It does **not** shell out to `amixer` in the browser — the playout server must wrap ALSA on Linux.

Fallback: **Launch alsamixer** calls `POST /api/system/gui-launch` with `action: "alsamixer"` (same pattern as `nvidia-settings`). That path is optional but recommended when the REST API is unavailable or for power users.

---

## Requirements

| Item | Notes |
|------|--------|
| OS | Linux with ALSA (`/dev/snd/*`) |
| Binaries | `amixer` in `PATH` (alsa-utils). `alsamixer` only needed for gui-launch fallback. |
| User | Process user must be allowed to open mixer controls (typically member of `audio` group). |
| Non-Linux | Return **501** or **503** with a clear JSON error; client shows a warning and offers Launch alsamixer only where applicable. |

Existing `GET /api/audio/devices` (ALSA card list) is already used elsewhere; card names in the mixer API should match those entries when possible.

---

## Endpoints

### `GET /api/audio/alsa-mixer`

Query parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `card` | int | `0` | ALSA card index (`-c` for amixer) |
| `refresh` | `1` | off | Bypass server cache and re-run `amixer` |

**Response `200`** — JSON object:

```json
{
  "card": 2,
  "cards": [
    { "card": 0, "name": "HDA Intel PCH" },
    { "card": 2, "name": "USB Audio Device" }
  ],
  "controls": [
    {
      "name": "Master",
      "index": 0,
      "type": "volume",
      "playback": true,
      "capture": false,
      "min": 0,
      "max": 100,
      "value": 87,
      "percent": 87,
      "dB": -12.5,
      "mute": false,
      "channels": ["Front Left", "Front Right"]
    },
    {
      "name": "Mic",
      "type": "volume",
      "playback": false,
      "capture": true,
      "min": 0,
      "max": 100,
      "value": 60,
      "percent": 60,
      "mute": false,
      "channels": ["Capture"]
    },
    {
      "name": "Mic Boost",
      "type": "enum",
      "items": [
        { "value": "0dB", "label": "0dB" },
        { "value": "20dB", "label": "20dB" }
      ],
      "item": "0dB"
    },
    {
      "name": "Auto Gain Control",
      "type": "boolean",
      "value": 1,
      "on": true
    }
  ]
}
```

**Alternative shape** (client also accepts):

```json
{
  "card": 0,
  "cards": [ ... ],
  "playback": [ /* controls with playback: true */ ],
  "capture": [ /* controls with capture: true */ ]
}
```

Or `elements` instead of `controls`.

#### Control object fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Simple control name (amixer `sname`), e.g. `"Master"`, `"PCM"`, `"Mic"` |
| `type` | yes | `"volume"` (default), `"enum"` / `"enumerated"`, `"boolean"` / `"switch"` |
| `playback` | volume | `true` if control has playback capability |
| `capture` | volume | `true` if control has capture capability |
| `min`, `max` | volume | Raw ALSA range (optional if `percent` is always 0–100) |
| `value` | volume | Raw ALSA value **or** 0–100 percent (see below) |
| `percent` | volume | **Preferred:** 0–100 for UI slider |
| `dB` | no | Display only, e.g. `-18.06` |
| `mute` / `muted` | volume | `true` when playback/capture is off |
| `channels` | no | Human labels, e.g. `["Front Left", "Front Right"]` |
| `items` | enum | Array of strings or `{ value, label }` |
| `item` | enum | Currently selected item string |
| `index` | no | ALSA control index; use if names are ambiguous |

**View filtering (client-side):** Playback view shows controls with `playback: true` (or name heuristics). Capture view shows `capture: true`. Enum/boolean controls appear in all views.

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{ "error": "invalid card" }` | Bad `card` query |
| 404 | `{ "error": "card not found" }` | No such ALSA card |
| 501/503 | `{ "error": "ALSA mixer not available on this host" }` | Non-Linux or no `amixer` |
| 500 | `{ "error": "..." }` | `amixer` failed |

---

### `POST /api/audio/alsa-mixer`

Set one control. Body (JSON):

```json
{ "card": 2, "name": "Mic", "percent": 75 }
```

| Field | Type | Description |
|-------|------|-------------|
| `card` | int | ALSA card index (required) |
| `name` | string | Control name (required unless `index` given) |
| `index` | int | Optional ALSA control index |
| `percent` | int 0–100 | Set volume by percentage (volume controls) |
| `value` | number | Raw ALSA value **or** `0`/`1` for boolean |
| `mute` | bool | `true` → mute, `false` → unmute (volume controls) |
| `item` | string | Enum item name (enum controls) |

The client sends:

- Slider drag: `{ card, name, percent }` (debounced ~100 ms)
- Mute toggle: `{ card, name, mute: true|false }`
- Enum change: `{ card, name, item: "20dB" }`
- Switch: `{ card, name, value: 0|1 }`

**Response `200`:**

```json
{ "ok": true, "card": 2, "name": "Mic", "percent": 75, "mute": false }
```

Optional: return the updated control object in the same shape as GET.

**Errors:** same as GET; add `404` if control name not found, `409` if control is read-only.

---

## Suggested server implementation (amixer)

### List cards

```bash
# Card names (pick one approach)
aplay -l
# or parse /proc/asound/cards
```

Reuse logic from existing `GET /api/audio/devices` if it already enumerates ALSA cards.

### List controls (GET)

```bash
amixer -c <card> scontents
```

Parse “Simple mixer control” blocks:

- Name from `Simple mixer control 'Master',0`
- Capabilities: `pvolume`, `cvolume`, `pswitch`, `cswitch`, `penum`, `cenum`, …
- Limits: `Limits: Playback 0 - 65536` / `Limits: Capture 0 - 65536`
- Values: `Front Left: Playback 32768 [50%] [-18.06dB] [on]`

Map to JSON:

- `type: "volume"` when `pvolume` or `cvolume`
- `playback: true` if `pvolume` or `pswitch` in capabilities
- `capture: true` if `cvolume` or `cswitch`
- `percent` from `[50%]` in amixer output (simplest for the client)
- `mute: true` when channel shows `[off]`
- `type: "enum"` when `penum`/`cenum`; items from `Item0: '0dB'` lines
- `type: "boolean"` for on/off switches without volume range

**Mono controls:** single channel line still yields one `percent` / `mute`.

**Caching:** optional short TTL (1–2 s) unless `refresh=1`.

### Set volume (POST percent)

```bash
amixer -c <card> sset '<name>' <percent>%
```

### Set mute (POST mute)

```bash
amixer -c <card> sset '<name>' mute
amixer -c <card> sset '<name>' unmute
# or toggle: amixer -c <card> sset '<name>' toggle
```

### Set enum (POST item)

```bash
amixer -c <card> sset '<name>' '<item>'
```

### Set boolean (POST value)

```bash
amixer -c <card> sset '<name>' on
amixer -c <card> sset '<name>' off
```

Use `name` with proper quoting; prefer `sset 'Mic'` over numeric index unless names collide.

---

## `POST /api/system/gui-launch` — `alsamixer`

Client payload:

```json
{ "action": "alsamixer", "password": "<optional nuclear password>" }
```

Expected behaviour (mirror `nvidia-settings`):

1. Honour nuclear password gate if configured.
2. Run on display `:0`, e.g. `DISPLAY=:0 alsamixer -c <defaultCard>` in background.
3. Response: `{ "ok": true, "exe": "alsamixer" }` or similar.

If only one card matters, default to card `0` or the card from server settings / `default_alsa_card`.

---

## Security and ops

- Mixer changes affect **machine-wide** ALSA levels (capture gain, headphone volume). Restrict API to the same trust boundary as other `/api/audio/*` routes.
- Avoid shell injection: never interpolate unsanitized `name` or `item` into a shell string; use `execFile('amixer', ['-c', String(card), 'sset', name, ...])`.
- Log set operations at info level (`card`, `name`, `percent`/`mute`/`item`) for support.
- PipeWire/Pulse systems: `amixer` may target a different layer than PipeWire volume; document host behaviour if both are present. Prefer the card USB devices use for Caspar `alsa://hw:N,M` capture.

---

## Client files (reference)

| File | Role |
|------|------|
| `client/lib/alsa-mixer-api.js` | GET/POST wrappers + response normalization |
| `client/components/settings-alsa-mixer-panel.js` | Settings UI |
| `client/components/settings-live-audio-panel.js` | Mounts mixer under Live audio tab |
| `client/components/settings-modal.js` | **Live audio** settings tab |

---

## Test checklist

1. `GET /api/audio/alsa-mixer?card=0` returns `cards` + non-empty `controls` on a Linux box with USB audio.
2. `POST` with `{ "percent": 50 }` moves hardware level; `GET` reflects new `percent`.
3. `POST` with `{ "mute": true }` mutes; UI shows **M** on refresh.
4. Capture view: `Mic` / `Capture` controls visible when `capture: true`.
5. Invalid card → 404 JSON error (client shows warning).
6. macOS/Windows dev → 501 (client shows fallback message).
7. `gui-launch` + `alsamixer` opens terminal UI on `:0` when REST API missing.

---

## Minimal stub (for integration tests)

Until full parsing exists, a stub that returns one fake control will render UI but sliders will fail on POST. Minimum viable product:

1. Parse `amixer -c N scontents` into `controls[]` with `name`, `type`, `percent`, `mute`, `playback`, `capture`.
2. Implement POST `percent` + `mute` only (covers Master/PCM/Mic).

Enum/boolean can follow in a second pass; the client already renders them when present.
