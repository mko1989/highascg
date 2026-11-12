# WO-1042 — PixelHue P80: Live showed one layer (another switcher's), no MVR tab

**Area:** mapping, godot-client
**Status: IN PROGRESS (12.11 — Live reads the P80 again (fixed, smoke + live read); MVR tab waits on the owner's choice: P80 is gated out inside the vendored Studio)**

Owner, 12.11: *"i've connected a pixelhue p80. its missing mvr tab at all. only one layer shows up in the live tab."*

## Investigation

- `GET /api/pixelhue/studio/status` → `model P80, modelId 30006, host 192.168.50.254`,
  `capabilities {inputs: true, mvr: false, audio: true}`.
- **Live (one layer).** Sources ▸ Live's "PixelHue layers" (`godot/client/features/live/pixelhue_layers_list.gd`) reads
  `/api/pixelhue/layers` → `src/pixelhue/pixelhue-read.js`, NOT Studio. Its answer said `device {ip: 192.168.50.11}`:
  an MVR screen + 12 pooled layers fed by "OPT1-1" / "HDMI 1", Layer 1 enabled, 2–12 `enable 0` — the list drops
  disabled rows, so one row. The P80's discovery service (`https://.254:19998/unico/v1/ucenter/device-list`) lists
  **every** switcher on the network: `.11` (modelId 25132, mac …1A:96:27) first, `.254` (30006, "System1") second.
  `resolveDevice` took `[0]` — the Live tab (and the WO-1038 look drive's writes, when switched on) went to `.11`.
  Studio connects to the configured host directly, so the PixelHue tab itself was on the P80.
- **MVR tab.** `pixelhue_tab.gd` hides a sub-tab whose capability is false. Studio sets it in
  `src/pixelhue/vendor/pixelhue-studio/lib/pixelhue.js:204` — `mvr: ['P20', 'Q8'].includes(this.model)` — and refuses
  P80 reads / writes in `:205`, `:221` and `lib/mvr-layers.js:33` ("Multiviewer editing is available for P20 and Q8").
  The P80 has a multiviewer: `screen/list-detail` (GET) → screens 1 "MVR 1" and 2 "MVR 2" with `screenIdObj.type 8`
  (what Studio's MVR model reads); MVR 1 has 11 windows (Input 1-1 HDMI, 1-3/1-4/2-3/2-4/3-4 DP, 1-5/1-6/2-5 SDI,
  Screen 1 PGM/PVW), MVR 2 is empty; Flex 4 shows "MVR 1". Studio's model rules are per model (P10/P20 512×480 input
  window cap, no AUX sources in the MVR) and none are written for the P80; its MVR writes were never tried on one.

## What was done

- `src/pixelhue/pixelhue-read.js` `resolveDevice`: the discovery entry at the configured host's address wins; one
  entry = a control PC naming its switcher (as before); several with none at the host → an error naming them
  instead of a guess.
- `tools/smoke/smoke-wo1035-pixelhue-layer-read.test.js`: two switchers listed, the second at the host → that one, the
  other never asked; a host matching neither → refused. The smoke and WO-1038's were not in the curated CI list —
  both added (`tools/ci/offline-test-files-2.js`).
- MVR: nothing changed yet — enabling it means editing the vendored Studio's model gates (owner's call).

## What was verified

- Smoke 6/6 (the new case fails on the old reader: 5/1); WO-1038 look-drive smoke 11/0; eslint, format:check,
  500-line check clean.
- Live after a node restart: `/api/pixelhue/layers?scene=pgm` → `device {ip: 192.168.50.254}`; Screen 1 (3072×1024):
  Layer 1 Input 2-4 DP, Layer 3 Input 1-1 HDMI (1359×764 at 1594,130), Layer 2 Input 1-4 DP, plus the Cut & Fill cut
  layer; the four Flex screens carry `aux` layers (left out of the Live list by design, WO-1035).
