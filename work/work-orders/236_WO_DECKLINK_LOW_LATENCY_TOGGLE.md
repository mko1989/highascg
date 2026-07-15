# WO-236 — DeckLink low-latency mode toggle (per host channel), default OFF (current behavior)

**Status:** Completed | **Date:** 2026-07-15
**Source:** owner: "the decklink host channel needs to have a low latency mode enable toggle. default what is now so off."
**Enabler:** the new 2.6-dev binary supports it (decklink_consumer.cpp:63-72 `set_latency`, config `<latency>low</latency>`; default/normal = today's behavior).

## Tasks
- [x] T236.1 Config model: per-screen/output boolean `decklinkLowLatency` (default false) stored where the decklink output options (keyer/videoMode) already live — found source in applyDecklinkConsumerSettingsFromConnector & readDecklinkConsumerSettings, added parseDecklinkLowLatency, passed through connector → config via standard pattern.
- [x] T236.2 Generator: when the flag is true emit `<latency>low</latency>` inside EVERY `<decklink>` consumer block for that output (tiled + non-tiled paths); when false emit NOTHING (byte-identical config to today) — updated buildDecklinkTiledConsumersXml, buildDecklinkKeyFillConsumersXml, all call sites in buildScreenPairChannels, buildMultiviewChannel, buildStreamingChannel.
- [x] T236.3 UI: toggle next to the existing decklink output options (device-view-inspector-decklink-output.js); persisted same way as embeddedAudio via setCasparRestartDirty(true) for config-change affordance.
- [x] T236.4 Smokes: 8 new tests in smoke-wo236-decklink-low-latency.test.js — flag off ⇒ no `<latency>`, flag on ⇒ `<latency>low</latency>` in both tiled & key-fill paths. All pass. eslint clean.
- [ ] A236.1 owner: toggle on host channel → regen config → caspar restart → caspar log shows "Enabled low-latency mode." (acceptance test — manual validation by owner)

## Implementation Summary
- **Config model field:** `decklinkLowLatency` boolean (default false/absent)
- **Connector settings:** `conn.caspar.decklinkLowLatency` → applied to `screen_N_decklink_low_latency`/`multiview_decklink_low_latency` via connector flow
- **UI:** Low-latency toggle in SDI consumer settings section, device-view-inspector-decklink-output.js, line 192
- **Generator:** Emits `<latency>low</latency>` only when true (byte-identical when false)
- **Tests:** 8 passing tests covering all builders + both enabled/disabled states
