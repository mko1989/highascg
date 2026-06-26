# WO-56: DeckLink SDI — custom PGM / ch1 output (OPEN — unresolved)

> **Status:** 🔴 **OPEN / UNRESOLVED** — parked 2026-06-26. Do not treat as fixed on production until items below are verified on hardware.

**Related:** [WO-55 DeckLink standard resolution inherit](./55_WO_DECKLINK_OUTPUT_STANDARD_RESOLUTION_INHERIT.md), [WO-28 DeckLink I/O](./28_WO_DECKLINK_INPUT_OUTPUT_ROUTING.md), [WO-36 PortAudio / DeckLink channel fix](./36_WO_DEVICE_VIEW_PORTAUDIO_DECKLINK_CHANNEL_FIX.md)

---

## Operator report (still failing)

- **PGM / PRV ch1** (custom canvas, e.g. 3072×1728) cabled to DeckLink SDI does **not** output as expected.
- SDI inspector should expose: `embedded-audio`, `channel-layout`, `latency`, `buffer-depth`, `color-space`, and **explicit SDI format** (no auto / nearest mapping).
- SDI should show upstream channel **1:1** (no scaling): larger canvas overflows SDI raster; smaller canvas does not fill SDI.

**Pass 2 attempt (2026-06-26):** Removed auto-nearest mapping; added required SDI format picker, consumer XML options, and `<subregion>` passthrough in generator. **Operator confirms issue not resolved** — moving on; track here.

---

## Todo list (update as work proceeds)

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T56.1 | Reproduce on hardware: PGM ch1 custom → DeckLink SDI; capture `casparcg.config` PGM channel block + Caspar log on startup | ⬜ pending | Include device index, SDI format chosen, cable graph JSON |
| T56.2 | Verify `buildCasparGeneratorFlatConfig` sets `screen_1_decklink_device` + `screen_1_decklink_output_video_mode` from cabled connector | ⬜ pending | `applyDecklinkOverridesToScreens`, `applyDecklinkConsumerSettingsFromConnector` |
| T56.3 | Confirm `<decklink>` emitted on PGM ch1 when connector has `decklinkOutputVideoMode` | ⬜ pending | `tools/smoke/smoke-decklink-output-resolve.js` covers model only |
| T56.4 | Validate Caspar accepts channel custom mode + decklink consumer `<video-mode>` + `<subregion>` together (no format mismatch error) | ⬜ pending | May need channel video-mode policy change in `channelVideoModeForDecklinkConsumer` |
| T56.5 | Confirm GPU screen + DeckLink coexist: `decklink_replace_screen=false` when GPU cabled | ⬜ pending | `reconcileDecklinkScreenConsumerFlags` |
| T56.6 | Device View: SDI jack not red-blocked when format set; cabling PGM ch1 → decklink allowed in graph | ⬜ pending | `device-graph-edges.js`, rear panel status |
| T56.7 | Runtime: after Apply + Caspar restart, AMCP `INFO` on PGM channel lists decklink consumer | ⬜ pending | |
| T56.8 | If subregion 1:1 wrong in Caspar build: document required Caspar version / fork behaviour | ⬜ pending | Compare with working `config/casparcg copy.config` tiled example |
| T56.9 | Operator doc: SDI format required for custom PGM; 1:1 crop/letterbox semantics | ⬜ pending | `docs/reference/` |
| T56.10 | Add integration smoke with full device graph from production `device_graph.json` fixture | ⬜ pending | |

---

## Code touched (pass 2 — incomplete fix)

| Area | Files |
|------|--------|
| SDI resolver (no auto) | `src/config/decklink-output-resolve.js` |
| Consumer XML + subregion | `src/config/decklink-key-fill.js`, `src/config/config-generator-consumer-attach.js` |
| Graph → flat config | `src/config/build-caspar-generator-config.js` |
| Inspector | `client/components/device-view-inspector-decklink.js` |
| Smoke | `tools/smoke/smoke-decklink-output-resolve.js` |

---

## Work log

### 2026-06-26 — Parked unresolved

**Work done:** Pass 2 implementation (no auto, explicit SDI format, 1:1 subregion, inspector controls). Smoke tests pass in CI model; **operator reports ch1 → DeckLink still broken**.

**Instructions for next agent:** Start with **T56.1** on the playout machine. Do not close this WO until hardware verification passes. WO-55 remains partially done; this WO tracks the **custom PGM ch1** regression specifically.
