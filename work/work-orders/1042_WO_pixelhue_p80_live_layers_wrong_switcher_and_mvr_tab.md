# WO-1042 — PixelHue P80: Live showed one layer (another switcher's), no MVR tab

**Area:** mapping, godot-client
**Status: DONE (12.11 — Live lists the P80's 3 program layers (smoke, live read, seen on the glass); P80 MVR on in the vendored Studio, a window moved 2 px and restored on the P80)**

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
  other never asked; a host matching neither → refused (already in the curated CI list, `offline-test-files-3.js`).
- MVR (owner 12.11: "Patch vendored copy"): `src/pixelhue/vendor/pixelhue-studio` — `['P20', 'Q8']` →
  `['P20', 'Q8', 'P80']` in `lib/pixelhue.js` (capability :204, read :205, apply :221), `lib/mvr-layers.js:33` (window
  add / edit) and `lib/mvr-templates.js:18`; messages say "P20, Q8 and P80". The P80 takes the rules Studio already
  has for non-P10/P20 models (no 512 × 480 input-window cap, AUX screens allowed as sources). `VENDORED.md` lists the
  patch: a re-vendor (`tools/dev/vendor-pixelhue-studio.sh`) drops it unless it lands upstream first.

## What was verified

- Smoke 6/6 (the new case fails on the old reader: 5/1); WO-1038 look-drive smoke 11/0; eslint, format:check,
  500-line check clean.
- Live after a node restart: `/api/pixelhue/layers?scene=pgm` → `device {ip: 192.168.50.254}`; Screen 1 (3072×1024):
  Layer 1 Input 2-4 DP, Layer 3 Input 1-1 HDMI (1359×764 at 1594,130), Layer 2 Input 1-4 DP, plus the Cut & Fill cut
  layer; the four Flex screens carry `aux` layers (left out of the Live list by design, WO-1035).
- MVR after a node restart: status → `capabilities {inputs, mvr: true, audio}` (the tab polls it every 5 s and shows
  the MVR sub-tab); `state` → MVR 1 / MVR 2 (1920×1080), 11 windows with sources and aspect, 26 sources;
  `mvr-templates` → supported, layouts 0… (10, 10, 18 … windows). Reversible write through `POST …/studio/windows`
  (the panel's body): window 21168130 (Input 1-3 DP) x 965 → 967, read back 967, restored → 965, read back 965.
  WO-1039 bridge smoke 4/0. Not exercised on the P80: add / remove windows, template recall, sources swaps.
- On the glass (operator screen capture): Sources ▸ Live ▸ PixelHue layers shows Screen 1 · Layer 1 / Layer 3 /
  Layer 2. The PixelHue ▸ MVR sub-tab itself was not looked at (the client was on Settings; not driven).
