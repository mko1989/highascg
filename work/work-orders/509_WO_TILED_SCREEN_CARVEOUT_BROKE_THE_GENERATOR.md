# WO-509 — Generator regression: the tiled-screen carve-out caused BOTH reported faults

**Status: DONE in repo (13.08.2026 — 6 smokes, suite 2086/2084/0, eslint 0, prettier clean). NOT deployed.**
**Priority:** HIGH (one symptom is two channels on one card — Caspar cannot open it twice)
**Source:** owner `todos13.08.26`: *"the yuv setting in decklink output doesnt land in the generated caspar config. the config generator doesnt register that a connection has been changed and tries to run two channels on the same decklink outputs. do a thorough investigation into config generator as i see it has regressed."*
**Related:** [WO-493](./493_WO_DECKLINK_PIXEL_FORMAT_OPTION.md) (added the pixel-format option — correct, but never reached tiled outputs), [WO-491](./491_WO_REMOVE_DESTINATION_LEAVES_DECKLINK_BOUND.md)/[WO-494](./494_WO_REMOVE_MAPPING_NODE_LEAVES_DECKLINK_BOUND.md)/[WO-496](./496_WO_APPLY_READS_ACTUAL_CABLING.md) (the release family), [WO-507](./507_WO_DECKLINK_OUTPUT_ON_AN_INPUT_CARD_RESTART_LOOP.md) (same-day sibling)

## 1. Evidence from the box (192.168.0.37)

Generated config vs the saved connectors — read live, not inferred:

```
ch1  6144x1536   screen, decklink dev=1 mode=2160p5000 pf=ABSENT
ch3  2160p5000   screen, decklink dev=1 mode=2160p5000 pf=ABSENT     <-- SAME CARD as ch1
ch4  2160p5000           decklink dev=2 mode=2160p5000 pf=ABSENT
```

```
dlsdi_1 caspar = { ioDirection:'out', outputBinding:{type:'screen',index:2}, mainIndex:1,
                   decklinkOutputVideoMode:'2160p5000', decklinkPixelFormat:'yuv', … }
```

Two independent facts: **device 1 is claimed by two channels**, and **`decklinkPixelFormat:'yuv'` is
saved on the connector but absent from every generated `<decklink>` block**.

A false start worth recording: `/api/settings` shows no `screen_N_decklink_pixel_format` key, which
looks like the translation never runs. It is not evidence — those flat keys are written into
`merged` at generate time and never persisted (same lifetime as `screen_N_decklink_tiles`, WO-494).
The real discriminator was `decklinkOutputVideoMode`, set by the *same* applier call: it DOES reach
the XML, proving the applier runs and the fault is elsewhere.

## 2. One root cause, two symptoms

Both come from the tiled-screen special case in `build-caspar-generator-config-decklink.js`. A tiled
(LED-wall) screen owns its card through `screen_N_decklink_tiles`, not `screen_N_decklink_device`,
and the code carved that out in two places:

**(a) It never released.** `releaseDecklinkDeviceFromOtherTargets`:

```js
const tiles = merged[`screen_${n}_decklink_tiles`]
if (Array.isArray(tiles) && tiles.length > 0) continue      // ← never gives the card up
```

Move a cable to another screen and the new target is assigned the device while the tiled screen
keeps its claim. Both emit `<device>1</device>`. That is the owner's *"doesn't register that a
connection has been changed"*, exactly.

**(b) It never received consumer settings.** `assignDecklinkToScreen`:

```js
if (Array.isArray(existingTiles) && existingTiles.length > 0) return   // ← before the applies
…
applyDecklinkConsumerSettingsFromConnector(merged, `screen_${n}_`, connector)
```

The early return skipped `applyDecklinkConsumerSettingsFromConnector`, so
`screen_N_decklink_pixel_format` was never written and `readDecklinkConsumerSettings` had nothing to
emit. **WO-493 was not wrong** — it wired the option correctly through the flat key and the tiled
consumer builder (verified end-to-end here: a flat `yuv` still produces `<pixel-format>yuv</>`). The
value simply never got written for a tiled screen.

## 3. What was done

- **Release**: a tiled screen now drops the tiles bound to the moved device, keeping tiles that point
  at its other cards (a multi-card wall must not be wiped). If that empties the list, the device,
  key-device and `replace_screen` keys are cleared too.
- **Assign**: the tiled branch still refuses to set the device *key* — tiles own it, and setting both
  would double-claim — but now applies key/fill and consumer settings before returning.

## 4. What was VERIFIED

`tools/smoke/smoke-wo509-tiled-screen-releases-and-applies.test.js` — 6 tests: the unconditional
`continue` is gone; release filters by device rather than clearing wholesale; emptying the list
clears the keys; the tiled branch applies consumer settings; it still does **not** take the device
key; and an end-to-end check that a flat `yuv` reaches `<pixel-format>yuv</pixel-format>`.

Full gate **2086 tests, 2084 pass / 0 fail / 2 skip**; eslint 0; prettier clean; 0 files over 500.

**NOT verified: the live Apply.** Everything above is static plus live *reads* of the box. The
acceptance test is the owner's: Apply, then confirm each DeckLink appears on exactly one channel and
`<pixel-format>yuv</pixel-format>` is present.

## 5. Scope — what this investigation did NOT cover

The owner asked for a thorough generator review; this WO covers the two reported faults and their
shared cause. Found while reading, **not** investigated or fixed:

- **A third DeckLink emit path with no settings at all.**
  `config-generator-consumer-attach.js:206` (dedicated streaming/encode bus) calls
  `buildDecklinkKeyFillConsumersXml({ fillDevice, keyDevice, lowLatency })` — **no `consumerSettings`,
  no `videoMode`**. Any DeckLink attached to the streaming bus therefore gets no pixel-format,
  embedded-audio, latency or colour-space. Not reachable in the owner's current config, so it did not
  cause this report, but it is the same bug waiting.
- **`dlsdi_99`**, a connector with `ioDirection:'out'`, `bus:'multiview'` and no real card, sits in
  the live device graph. Smells like the WO-428 phantom-card family. Harmless-looking; unexamined.
- Fossil cleanup on write (WO-496 provenance work) — WO-507 and this WO both stop bad state reaching
  Caspar without removing it from the saved config.

## 6. Work log

- 2026-08-13 — Opened. Read the live generated config and connectors off the box, ruled out a
  misleading `/api/settings` signal, traced both symptoms to the tiled-screen carve-out, fixed both,
  6 smokes. Recorded three unexamined leads in §5.
