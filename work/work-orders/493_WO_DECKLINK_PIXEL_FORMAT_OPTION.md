# WO-493 — DeckLink `<pixel-format>`: WO-487's escape hatch was unreachable, 2160p had no way back

**Status: DONE (12.08 — 8 new smokes, suite 2003/2001/0, eslint clean; client built + kiosk reloaded) — owner QA: pick YUV on the 2160p output, Apply, confirm picture returns**

Owner 12.08: *"in one of your fixes you removed the yuv colorspace from the decklink output. this was
necesery for 2160p output. without that option the output does not show up and also blocks the whole
channel to display anything on any consumer. add this as an option in decklink outputs inspector."*

Attribution, for the record: the removal was **[WO-487](./487_WO_FORCED_YUV_PIXEL_FORMAT_ON_UHD_SDI.md)**
(commit `f57b432`, 11.08), not a change from the 12.08 session. That does not make it less of a
regression — see §2.

## 1. Investigation

WO-487's reasoning was sound and is preserved here: Caspar already picks by channel bit depth
(`config.cpp:124`, `default_pixel_format = is_8bit ? L"rgba" : L"yuv"`), so forcing `yuv` on an
8-bit 1080p channel buys a per-frame RGBA→YUV conversion on the consumer that owns the channel
clock. Every proven 1080p50 config on this box has no `<pixel-format>` element at all.

Its stated safety valve was: *"Now emitted only on an explicit operator override."* **That override
never worked.** `decklinkPixelFormatXml(videoMode, consumerSettings)` reads the operator's choice out
of its SECOND parameter, and both call sites passed only the first:

```js
src/config/decklink-key-fill.js:310                    decklinkPixelFormatXml(videoModeRaw)
src/config/config-generator-consumer-attach-screen.js:40
    decklinkPixelFormatXml(String(opts.videoMode || tiles[0]?.videoMode || ''))
```

`consumerSettings` was therefore always `undefined`, `resolveDecklinkPixelFormatOverride` always
returned `''`, and **no input to the system could produce a `<pixel-format>` element**. There was no
config key, no UI, and no override — the element was simply unreachable. On 1080p that is invisible;
on 2160p it means the SDI produces no picture *and* wedges its channel, so every consumer on that
channel goes dark. WO-487 was measured against an idle PGM1 and never exercised the UHD path it had
just disabled.

## 2. Why "auto" cannot simply become "yuv on UHD"

Reverting to the resolution rule would reinstate exactly the cost WO-487 removed, and the owner has
2160p and 1080p outputs on the same box. The decision has to be per output. Hence: **default auto
(unchanged from WO-487), operator-selectable per DeckLink output, with a warning when a 2160p output
is left on auto.**

## 3. What was done

**Server — the setting now exists and travels.**
`src/config/decklink-key-fill.js`: new `normalizeDecklinkPixelFormat` (`'yuv' | 'rgba' | ''`, junk →
`''` = auto); `pixelFormat: ''` added to `DEFAULT_DECKLINK_CONSUMER_SETTINGS`; carried through
`readDecklinkConsumerSettings` (flat `screen_N_decklink_pixel_format`),
`readDecklinkConsumerSettingsFromConnectorCaspar` (connector `decklinkPixelFormat`) and
`applyDecklinkConsumerSettingsFromConnector`.

**Server — the two dead call sites now pass it.** `decklinkPixelFormatXml(videoModeRaw, opts?.consumerSettings)`
in the key/fill builder, and `opts.consumerSettings` in `buildDecklinkTiledConsumersXml` — the tiled
path had `consumerSettings` in scope already and was passing only `lowLatency` from it. The tiled
consumer is the shape a pixel-mapped 2160p wall actually uses, so missing it would have left the
owner's case unfixed.

**Client — the control.** `DECKLINK_PIXEL_FORMAT_OPTIONS` + `decklinkModeNeedsYuv` in
`device-view-inspector-decklink-shared.js`; a "Pixel format" select in the DeckLink **output**
inspector (`Auto (Caspar decides)` / `YUV — required for 2160p` / `RGBA`), saved as
`decklinkPixelFormat` in the connector patch alongside the other consumer settings. When the selected
SDI format is 2160p/4320p and the choice is not YUV, an amber inline warning appears:

> This is a 2160p output — set Pixel format to YUV, or the SDI shows nothing and the whole channel
> stops rendering on every consumer.

The warning re-evaluates on both the pixel-format and the SDI-format selects.

**Not touched:** the dedicated streaming-bus DeckLink (`config-generator-consumer-attach.js:206`)
emits neither `<video-mode>` nor `<pixel-format>`; it is a different surface from the output
inspector and out of scope here.

## 4. What was VERIFIED

`tools/smoke/smoke-wo493-decklink-pixel-format-option.test.js` — **8 tests, all passing**, registered
in the curated CI list:

- default is auto → no element emitted (WO-487's 1080p win preserved);
- `yuv` reaches the key/fill consumer XML, and **both** consumers of a fill+key pair (the key-only
  consumer needs it too);
- `yuv` reaches the **tiled** consumer XML, and auto still omits it there;
- `rgba` can be forced; junk (`''`, null, undefined, `'v210'`, `0`) falls back to auto;
- full round-trip: connector `decklinkPixelFormat` → flat `screen_1_decklink_pixel_format` →
  `readDecklinkConsumerSettings` → emitted element;
- an untouched output round-trips as auto, not as a forced format;
- source contract: the inspector renders the select, saves it, warns on 2160p — **and every
  `decklinkPixelFormatXml` call site passes `consumerSettings`**, which is the exact regression that
  made the override unreachable. (That last assertion is line-based on purpose: the argument contains
  nested parens, and a naive `[^)]*` regex truncates it — the first draft of this test failed for
  that reason, not because of the code.)

Full offline gate → **2003 tests, 2001 pass / 0 fail / 2 skip** (was 1995/1993 — the 8 new tests,
nothing regressed). eslint clean on all four changed files; `check-max-file-lines` → 0 over 500.
`npm run build:client` + kiosk reload; the shipped bundle contains `decklinkPixelFormat` and the
`YUV — required for 2160p` label.

**Owner QA:** open the 2160p DeckLink output in Device View → Pixel format → **YUV**, then Apply
config and restart Caspar. Confirm the SDI shows picture and the channel's other consumers render.
The generated config should carry `<pixel-format>yuv</pixel-format>` inside that `<decklink>` block.
