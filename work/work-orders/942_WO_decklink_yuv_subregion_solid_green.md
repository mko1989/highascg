# WO-942 — DeckLink outputs fed by a mapping node show solid green on yuv (v210 ignores subregions with width/height)

**Area:** video-io, mapping, caspar-build
**Status: DONE (04.11.26 — root cause read in the v2.5.1 source and proven on the second dev box's switcher; generator fix deployed there, generated config byte-identical to the switcher-proven one; smoke 4/4, offline suite 5284 pass / 3 fail (the same 3 fail on clean HEAD) / 15 skip) — the real fix (fork cherry-pick of upstream #1700) is the follow-up in §4**

Owner 04.11 on the second dev box (highascg5867, DeckLink 8K Pro ×4): *"i wanted to check how mapping two decklink outputs thru a mapping node works and it doesnt work"*, then, once the switcher was set right: *"the outputs are now just green. sending a test pattern does nothing."* and *"the solid green had something to do with the yuv i think"*.

Related: [WO-869](./869_WO_mapping_node_slices.md) (mapping node → DeckLink `direct` tiles with the slice rect's width/height), [WO-493](./493_WO_DECKLINK_PIXEL_FORMAT_OPTION.md) (2160p SDI needs `<pixel-format>yuv</pixel-format>`), [WO-485](./deprecated/485_WO_DECKLINK_TILES_OVERRUN_THE_CHANNEL_RASTER.md) (owner's rule: SDI tiles are card-sized, "the video lands where it lands"), [WO-476](./476_WO_FILL_ONLY_DECKLINK_STILL_ASKS_FOR_EXTERNAL_KEYER.md) (the keyer error in the same log — cosmetic, not this).

---

## 1. Investigation

**Rig.** One PGM/PRV destination, custom 6144×1024@50 → mapping node "Pixel Mapping 1" → out 1 → DeckLink 3, out 2 → DeckLink 4, both `2160p5000`, pixel format `yuv`. The node's rects came from the inspector's **"Propose outputs from input"** (`godot/client/features/devices/mapping_graph.gd:75` `propose_layout`: N equal side-by-side slices) → `{0,0,3072,1024}` and `{3072,0,3072,1024}`. The generated `<decklink>` (`src/config/config-generator-consumer-attach-screen.js` `buildDecklinkTiledConsumersXml`) carried `<subregion>` src-x 0 / 3072, dest 0,0, `<width>3072</width><height>1024</height>` on both ports.

**What was ruled out on the box.**
- Config, channels, consumers: `INFO 2` lists the decklink consumer (port 303, port 4 in `<ports>`), all three channels "Successfully Initialized", both cards "Initialized". (`INFO` shows `src-x 0` for port 4 — that is the `monitor.cpp` double-`src-x` bug WO-869 §1.2 noted, not the config.)
- The channel is not wedged: a temporary `ADD 2-799 SHM` consumer's `<published>` counter advanced at **49.92 fps** with 0 dropped; PGM/PRV test colours showed in the operator GUI (route layers 10/11 on ch 1).
- Keyer: `Failed to enable external keyer` is WO-476, cosmetic on the 8K Pro.
- Card profile: `/etc/blackmagic/BlackmagicPreferences.xml` `ProfileFourCC 878995556` = `'4dhd'`, four half-duplex sub-devices — devices 3 and 4 are independent outputs.
- The 19:10–19:12 `ADD 2-741 SHM … COMMAND_UNKNOWN_DATA` flood was the destination existing in the project before Apply (Caspar still had only ch 1), not this fault.

**Hardware A/B (owner watching the switcher):**

| ch2 `<subregion>` on both ports | SDI 3 / 4 |
|---|---|
| width 3072, height 1024 (generated) | solid green |
| width 3840, height 2160 (DeckLink 3 only changed) | solid green |
| **no width / height** (src-x 0 / 3072, dest 0) | **picture** ("yep. now its good") |

**Root cause — the v210 converter on the 2.5.1 line.** `VERSION` → `2.5.1 deac375bb Stable` (the WO-613 `highascg-build-v2` line, v2.5.1 + our patches). Upstream tag `v2.5.1` (`ec38d9444`, 2026-09-16), `src/modules/decklink/consumer/v210_strategies.cpp` `convert_frame`:

```cpp
// v2.5.1 :326
if (config.region_w == 0 && config.region_h == 0 && config.dest_x == 0) {
    // Fast path … pixels_to_copy = min(decklink width, channel width - src_x) …
}
// no else
```

Any `<width>`, `<height>` or non-zero `<dest-x>` skips the only branch that writes the frame; `allocate_frame_data` hands the card an untouched buffer, and an all-zero v210 frame (Y=Cb=Cr=0) is **solid green**. The BGRA path (`sdr_bgra_strategy.cpp`, rgba / auto on an 8-bit channel) honours every field — which is why the owner's older 1080p rigs (no `<pixel-format>`) worked with card-sized regions, and why WO-869's `direct` tiles with the rect's width/height only break on `yuv`. The symbols in `bin/casparcg` confirm the port-config-aware `v210_strategy::convert_frame<uint8_t/uint16_t>(…, port_configuration …)` of that era.

Upstream master fixed it in **#1700** (`7d4572901`, 2026-03-03, "complete support for subregions in decklink v210": region clamp, dest-x via 6-pixel-group alignment, black padding) and later `e48322a9e` (2026-10-14, v210 swapped R/B and Cb/Cr). Neither is on the 2.5.x line. The rest of the consumer between v2.5.1 and master is VANC / APPLY plumbing, nothing subregion-related.

So on this binary a `yuv` port can take **src-x, src-y and dest-y** only. The card then copies a full SDI-width row from src-x (rows past the channel go black): out 1 shows canvas x 0..3840 (its right 768 px repeat the start of out 2's slice), out 2 shows 3072..6144 then black — the owner's "lands where it lands" pattern (WO-485 §4).

## 2. What was done

- `src/config/decklink-v210-subregion.js` (new): `decklinkSubregionFields(tile, pixelFormat)` / `decklinkSubregionXml(…)`. On `yuv` it drops width/height and forces dest-x to 0; otherwise the block is unchanged. One gate, `v210HonoursRegion()` (false), to flip when the fork carries #1700. A module of its own because the rule is about the Caspar binary, not about tiling, and so the gate has one home.
- `src/config/config-generator-consumer-attach-screen.js` `buildDecklinkTiledConsumersXml`: `subBlock` goes through `decklinkSubregionXml` with the port's normalised `<pixel-format>` override (`normalizeDecklinkPixelFormat(consumerSettings.pixelFormat)`). HighAsCG never writes `<color-depth>`, so channels are 8-bit and Caspar picks v210 only on an explicit `yuv`.
- Untouched on purpose: `screen_N_decklink_tiles` (the planner / WO-869 tile data and its smokes stay as they are — only the XML for v210 ports changes); `buildDecklinkSubregionXml` in `decklink-key-fill.js` (its `passthroughSubregion` has no caller).
- Not chosen: emitting card-sized width/height (the owner's first guess) — the A/B proved 3840×2160 green as well; any non-zero width/height trips the bug.

## 3. What was verified

- **Box (highascg5867, 04.11):** the three-row A/B above, read by the owner on the switcher. Deployed `decklink-v210-subregion.js` + the attach-screen change into `~/highascg/src/config/`, restarted node (`kill -TERM` MainPID), `GET /api/caspar-config/generate` before vs after differs only by the four width/height lines, and the after-XML is **byte-identical** to the hand-edited `config/casparcg.config` the owner confirmed ("generated == hand-tested live config"). Apply is safe again on this box.
- `tools/smoke/smoke-wo942-v210-subregion.test.js` (curated, `offline-test-files-3.js`) **4/4**: the box rig's exact XML on yuv; dest-x forced / dest-y kept; rgba and auto keep the full block (WO-869 placement); the gate is closed.
- Related smokes WO-493 / 869 / 509 / 494 / 236 / 507-508: **66/66**.
- Offline suite (`tools/ci/run-offline-tests.js`): **5302 tests, 5284 pass, 3 fail, 15 skip**; clean HEAD on the same box: 5298 / 5280 / **the same 3 fail** (REAL ffmpeg frame-rate encode, WO-40a multiview head shift, graph-bound 3-head layout — box-dependent, not touched here). eslint clean; prettier clean on the new files; max-file-lines 0 over; require-integrity OK; unwired-exports no new orphans.
- **Owner QA:** a mapping node whose slice is *placed* (dst x ≠ 0) on a yuv output now lands at x 0 — expected on this binary; say so if that matters before §4.

## 4. Follow-up (not done here)

- **Caspar fork:** cherry-pick upstream `7d4572901` (#1700) and `e48322a9e` (v210 colour fix) onto the 2.5.x fork, rebuild, swap the binary on the boxes, then set `v210HonoursRegion()` to true (or probe it) and update the smoke. That restores black padding, true slice widths and dest-x placement on yuv. The fork source is on the build machine, not on this box.
- Inspector hint (minimal): on a yuv DeckLink output, the mapping inspector could note that width/height/x-placement are ignored on this Caspar build. Left until the owner decides whether §4's rebuild comes first.
