# WO-1035 — PixelHue: read layer positions; placeholder layers for PIP borders over the key + fill pair
**Area:** mapping, godot-client, devices-config
**Status: DONE (11.11 — box: live read of the P20, list + drop + inspector built; client tests + `--check`; owner used it on the glass and reported the follow-ups fixed here and in WO-1037)**

Owner, 11.11: *"would it be possible to get a read from pixelhue what layers and what positions the layers have on the
screen so i can match them with on overlay from highascg to for instance display a border effect"*; then: a separate
list in Live sources whose rows drop as placeholders; the connection in Devices "similar to servers and lighting
consoles"; the list only "when a pixelhue is added and connected"; and after trying it: too many media settings in the
inspector, and the list "overtake[s] the whole browser view".

## Investigation

- `docs/reference/PIXELHUE_API.md`: discovery `https://{host}:19998/unico/v1/ucenter/device-list`, token = HS256 JWT of
  `{SN}` with `String(startTime)`, `GET /unico/v1/layers/list-detail` + `screen/list-detail`.
- Live read of the owner's P20 (control port on .15, device .7:8088): 7 screens, 22 layers; the wall (Screen 1,
  3072×1024) carried a background input and a Cut & Fill pair (layer types 256 fill / 128 cut), later a PIP.
- Look layers hold `fill {x, y, scaleX, scaleY}` as fractions of the channel; a colour source `#00000000` with
  `isPlaceholder` plays nothing on fill or key; PIP overlays hang off the layer's fill.

## What was done

- Server: `src/pixelhue/pixelhue-read.js` (discover, token, cached read, layers with a ready `fill`),
  `src/api/routes-pixelhue.js` (`GET /api/pixelhue/layers`, `/config`; address in `~/.highascg/pixelhue.json`,
  machine-local).
- Godot: Devices ▸ PIXELHUE panel (add / test / edit / remove); Sources ▸ Live ▸ "PixelHue layers" list inside the
  live sources' scroll, shown only while the switcher answers, without MVR tiles / AUX / cut layers; a row dropped on a
  look adds an empty placeholder on that rectangle, dropped on a layer it moves the layer; layer inspector "Position
  from" drop-down; an empty placeholder hides the media rows and sections.
- Performance overlay (same session): process CPU reads "290% of 1 core (10.4% of box)".

## Verified

- `tools/smoke/smoke-wo1035-pixelhue-layer-read.test.js` (fake switcher), Godot `test_pixelhue_match.gd`,
  `test_look_layer_drop_wo816.gd`; `run-client.sh --check` boots clean.
- Box: `GET /api/pixelhue/layers?screen=1&scene=pgm` returned the wall's layers with fills; the owner dropped a
  placeholder and took the look (border: WO-1037).
- Not seen by me on the glass: the Devices panel, the list, the trimmed inspector (owner used them).
