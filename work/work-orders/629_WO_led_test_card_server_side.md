# WO-629 — LED test card: settings + master switch in node, Godot header switch + dialog (WO-608 header slice 3)

**Status: DONE (20.10 — box: dialog edits stored in node, channel 7 Show on/off, header master off/on/off; smoke 15/15)**

Part of the WO-593 / WO-608 Godot port ("work on filling the top bar like it is in the webui"). Under owner directive D
(everything is composed in the node server, every function is an endpoint), the client-side test card had to move to
the server first.

## Investigation

- Web: `client/components/header-bar-led-test.js` (checkbox + "Test card…"), `client/components/led-test-modal.js`
  (dialog; all settings in **browser localStorage**, 15 keys) and `client/lib/led-test-apply.js`. The last one picks
  the target channels, builds each per-channel body (including an "Output: Screen N …" connector label) and POSTs
  `/api/led-test-card` once per channel. The master on/off is also localStorage.
- Server: `POST /api/led-test-card` (`routes-led-test-card.js`) paints or clears `led_grid_test` on layer 999 for one
  channel and maintains `ctx._ledTestPatternActive`, which reaches clients as `state.ledTestPatternActive` and the WS
  `change`. The startup card (`startup-led-test-pattern.js`) sets the same flag.
  - The route already names the output itself from the operator's screen label + GPU connector (WO-506). The web's
    client-built label overrode that with the generic "Output: Screen N".
- So a second client (Godot, another browser) never saw the settings, and the checkbox showed that browser's
  memory, not what is on air.

## What was done

- `src/engine/led-test-card-control.js`:
  - One box-wide settings record (persistence key `ledTestCard`, `.highascg-state.json`; test runs use a temp file),
    normalised and clamped with the web modal's defaults and ranges. The bunny builder falls back to the plain grid
    without a full-grid channel (WO-588).
  - `planTargets`, ported from `led-test-apply.js`:
    - on → the picked channels; **none picked → every program channel** (the checkbox tooltip's promise; the web
      refused with NO_CHANNELS instead);
    - off → program + multiview + picked;
    - explicit channels win.
  - `cardBody`: no connectorLabel, so the WO-506 server label shows.
  - `applyCard`: serialised, so overlapping toggles never interleave CG ADD / CLEAR on layer 999. Only the last body
    of a master-off carries `masterOff`.
  - `setChannel`: the dialog's per-channel Show. It is remembered, and switching the last channel off turns the master
    off.
- `src/api/routes-led-test-control.js` + `router.js` (registered before the Caspar-only `/api/led-test-card/*`):
  - `GET /api/led-test-card/settings` → `{settings, active, patterns, channels}`. Channel rows come from
    `configComparison.serverChannels`.
  - `POST …/settings` (works without Caspar; re-applies while the card is up), `…/master {enabled}`,
    `…/channel {channel, enabled}`. These answer 502 with `failures` when no channel took it.
- Godot:
  - `app/header_tools.gd`: "Test card" checkbox + "Test card…" before FTB. The checkbox mirrors
    `state.ledTestPatternActive` (WS), so the startup card and other clients show here too. Toggling it POSTs the
    master; on failure it shows a notice and goes back to the server truth.
  - `app/led_test_dialog.gd`: pattern (builder disabled without a full-grid channel; bunny count / speed shown when
    they apply), circle / crosshair, grid geometry, title + label checkboxes, and per channel "Show" (switches right
    away) + "Full LED grid". Edits POST 0.4 s after the last change, and closing flushes a pending edit.
  - `app/led_test_model.gd`: pure helpers.
  - `header_project.gd`: notices gained a `warn` tone (partial failures).

## What was VERIFIED

- `tools/smoke/smoke-wo629-led-test-control.test.js` (curated): 15/15 pass. Covers defaults, clamping, builder rule,
  merge-save, targets on / off / none-picked / explicit, body shape, masterOff only on the last body, partial / total
  failure, serialisation, channel toggle → master off, route payloads, 503 / 400 / 404, and route order.
  `tests/test_led_test_model.gd`; Godot suite 16176 pass.
- Offline suite 2902 pass / 0 fail. Lint 217 / 218, prettier, line limit (router.js 499), unwired exports: OK.
- Box, after a node restart. Tests used channels 7 / 8 (no LED wall); PGM ch1 never got layer 999.
  - API: channel 7 on → `INFO 7` shows layer 999 `html` beside its DeckLink layer 4. Off → layer 999 gone, layer 4
    untouched.
  - Godot dialog: the Columns ▲ arrow → node settings `cols 21`. Channel 7 Show → layer 999 on ch7,
    `active True {'7': True}`, and the header checkbox ticked itself.
  - Header checkbox off → on (targets only ch7, the picked one) → off; `INFO` matched each step.
  - Restored afterwards: `cols 20`, no picked channels, card off.

## Open

- The web client still keeps its own localStorage settings and master flag. Moving it onto these endpoints is a
  follow-up; until then a web toggle and a Godot toggle drive the same layer 999 from different settings.
- FTB does not clear layer 999 (unchanged). The web only unticked its own checkbox; here the checkbox follows the
  server, so it stays ticked while the card is up.
