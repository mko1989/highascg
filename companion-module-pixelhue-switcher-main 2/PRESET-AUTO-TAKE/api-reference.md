# API reference (Preset load + Take)

## 1. Load preset to Preview

**`POST`** `{apiBase}/unico/v1/preset/apply`

Example body:

```json
{
  "auxiliary": {
    "keyFrame": { "enable": 1 },
    "switchEffect": { "type": 1, "time": 500 },
    "swapEnable": 1,
    "effect": { "enable": 1 }
  },
  "serial": 1,
  "targetRegion": 4,
  "presetId": "<preset-guid>"
}
```

- `targetRegion: 4` = Preview (PVW) — see `LoadIn.preview` in `src/interfaces/Preset.ts`.

## 2. Take (PVW → PGM)

**`PUT`** `{apiBase}/unico/v1/screen/take`

Example body (one entry per screen):

```json
[
  {
    "direction": 0,
    "effectSelect": 0,
    "screenGuid": "<guid>",
    "screenId": 1,
    "screenName": "Screen A",
    "swapEnable": 1,
    "switchEffect": { "type": 1, "time": 500 }
  }
]
```

Implementation: `ApiClient.take()` in `src/services/ApiClient.ts`.
