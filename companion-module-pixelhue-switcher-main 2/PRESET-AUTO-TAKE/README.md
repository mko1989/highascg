# Preset → Program (Auto-Take)

Isolated code for recalling a PixelHue preset to Preview and then taking it to Program.

## Flow

1. `POST /unico/v1/preset/apply` — load preset to **Preview** (`targetRegion: 4`).
2. `PUT /unico/v1/screen/take` — TAKE on screens tied to that preset.

## Files

| File | Role |
|------|------|
| `constants.ts` | `LOAD_IN_PROGRAM_AUTO` (`-1`) for the Companion action dropdown |
| `executePresetProgramAutoTake.ts` | Core async sequence (load PVW → take) |
| `api-reference.md` | Example HTTP bodies |

## Integration

- **Action:** `loadPreset` in `src/actions.ts` — when `loadIn === LOAD_IN_PROGRAM_AUTO`, calls `executePresetProgramAutoTake`.
- **Button presets:** `src/presets/PresetDefinitions.ts` — category `PRESET_CATEGORY.PROGRAM_AUTO`, `loadIn: -1`.
- **Category label:** `src/utils/constants.ts` — `PROGRAM_AUTO: 'Presets in Program (Auto-Take)'`.

## Build

This folder is included in `tsconfig.build.json`; compiled output lives under `dist/PRESET-AUTO-TAKE/`.
