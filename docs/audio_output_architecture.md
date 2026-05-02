# Audio Output Architecture Redesign & Remaining Issues

## What Changed

### 1. Audio Output Management (🔧 Fixed)

**Before:** Every PortAudio / ALSA device was auto-generated as a rear panel connector, flooding the panel with ~40 entries for 3 physical cards.

**After:** Audio outputs are **user-managed** — exactly like stream and record outputs:
- Click **+** on the Audio slot in the rear panel to add an audio output
- Click the connector to open the **inspector** with:
  - Device picker (dropdown of deduplicated `hw:CARD=...` devices from `aplay -L`)
  - Manual device name entry (for custom PortAudio strings)
  - Channel layout selector (stereo, mono, 5.1, 7.1)
  - Save / Remove buttons
  - ⚠ Warning when build profile is `stock` (PortAudio requires `custom_live`)

### 2. Device Deduplication (🔧 Fixed)

**Before:** `aplay -L` returned every PCM variant: `hw:`, `plughw:`, `default:`, `sysdefault:`, `dmix:`, `front:`, `surround*:`, `iec958:`, `hdmi:` — all for the same physical card.

**After:** Only `hw:CARD=...,DEV=N` entries are kept. Different DEV numbers are preserved (= different physical outputs). Result from your server:

| Device | Description |
|--------|-------------|
| `hw:CARD=HDSPMxa5a694,DEV=0` | RME AIO_a5a694, RME AIO |
| `hw:CARD=PCH,DEV=0` | HDA Intel PCH, ALC1150 Analog |
| `hw:CARD=PCH,DEV=1` | HDA Intel PCH, ALC1150 Digital |
| `hw:CARD=NVidia,DEV=3` | HDA NVidia, HDMI 0 |
| `hw:CARD=NVidia,DEV=7` | HDA NVidia, HDMI 1 |
| `hw:CARD=NVidia,DEV=8` | HDA NVidia, HDMI 2 |
| `hw:CARD=NVidia,DEV=9` | HDA NVidia, HDMI 3 |

### 3. Files Modified

| File | Change |
|------|--------|
| `src/audio/audio-devices.js` | Dedup `aplay -L` to `hw:CARD=` entries only |
| `src/config/device-graph-suggest.js` | Replaced auto-enum with managed `audioOutputs` from config |
| `src/config/device-graph-constants.js` | Reverted `audio_out`/`audio_in` from `AUTO_CASPAR_KINDS` |
| `src/api/settings-post.js` | Added `audioOutputs` persistence |
| `src/api/settings-get.js` | Added `audioOutputs` to GET response |
| `src/api/routes-device-view.js` | Added `audioOutputs` to device view payload |
| `web/components/device-view-inspectors.js` | Added `renderAudioOutControls` inspector |
| `web/components/device-view-caspar-render.js` | Slot renders from managed list + `+` button |
| `web/components/device-view-bands-render.js` | Added `onAddAudioOutput`/`onRemoveAudioOutput` |
| `web/components/device-view.js` | Added `removeAudioOutputConnector` handler |

---

## Still Open — Not Addressed In This Session

### Looks Editor: Screen 2 Compose Preview Missing

The compose preview cells are built from `settingsState.getSettings()?.tandemTopology?.destinations`. The logic in `preview-canvas-panel.js:getComposeCellDefs()` (lines 34-87) correctly reads destinations and creates PGM/PRV cells per main index.

**Likely cause:** `settingsState` may not be updated when destinations change in Device View. The settings state is refreshed on tab activation but may miss live changes. The fix would be to either:
- Trigger `settingsState.refresh()` after destination changes, or
- Read destinations from the `stateStore.channelMap` instead of `settingsState`

### Looks Scope Enforcement

The scope selector in `scenes-editor-edit.js` (lines 33-46) correctly sets `scene.mainScope`. The take logic in `createTakeSceneToProgram` (lines 146-152) correctly resolves `targetMains` from the scope. But if the scope is "Screen 1 only", the look still visually appears on both screens in the compose preview — the **preview rendering** doesn't filter by scope, only the **take** does.

### Multiview Add Destination

The multiview option **IS** in the dropdown (`<option value="multiview">Multiview</option>` in device-view.js line 48). If it shouldn't appear, it needs to be removed from the dropdown HTML.

### PortAudio Config Generation

The root-level `<portaudio>` block and per-channel `<portaudio/>` consumer **DO** generate correctly when `caspar_build_profile: 'custom_live'` is set. If the generated config on the server is missing PortAudio, ensure:
1. Build profile is changed to "Custom Live" in Caspar Host inspector
2. Hit "Apply" to regenerate the XML config
3. Restart CasparCG
