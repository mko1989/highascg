# WO-487 — we force `<pixel-format>yuv</pixel-format>` on UHD SDI; Caspar would have chosen better

**Status: OPEN (11.08.2026 — change made, hypothesis NOT yet measured on the box)**

## 1. Investigation

Chasing PGM1's slow playback (~80% of realtime, ~50% once DeckLink inputs were added, realtime with
the DeckLink consumer removed). The owner's position — this class of setup is built, tested and
works, so *something broke* — is the right frame: the question is what differs from a rig that works.

The proven rig is in the repo: `config/casparcg copy.config`, a 5120x1024 channel driving four
1080p5000 cards. Diffing its `<decklink>` block against the one generated for `.28`:

| | proven (1080p50 x4) | .28 (2160p50 x2) |
|---|---|---|
| `<pixel-format>` | **absent** | **`yuv`** |
| `<embedded-audio>` | `true` | absent |
| `<latency>` | `normal` | absent |
| subregion pattern | region = SDI frame, packed | identical |

The subregions are the same shape in both (see WO-485, deprecated). The standout is
`<pixel-format>yuv</pixel-format>`, which **we** add — and only ever for UHD:

```js
// decklink-key-fill.js, before this WO
if (/^2160p/.test(mode) || /^dci2160p/.test(mode)) return true   // -> emit <pixel-format>yuv
```

CasparCG already decides this correctly by itself (`consumer/config.cpp:124`):

```cpp
auto is_8bit              = channel_info.depth == common::bit_depth::bit8;
auto default_pixel_format = is_8bit ? L"rgba" : L"yuv";
auto pixel_format         = ptree.get(L"pixel-format", default_pixel_format);
```

The choice belongs to the **channel's bit depth**, not its resolution. On an ordinary 8-bit channel
the native path is `rgba` — Caspar's frames already are RGBA — and forcing `yuv` buys a per-frame
RGBA→YUV conversion **on every card**. At 2160p50 × 2 that is a large, permanent cost, paid by the
consumer that owns the channel's synchronization clock
(`decklink_consumer.cpp:1266` returns true where `screen_consumer.cpp:1020` returns false), so the
whole channel slows to whatever is left.

It fits the shape of the symptom: a throughput deficit rather than a clean halving (~80%, not 50%),
worse when more DeckLink work is added, gone when the consumer is removed. And it explains why the
owner's tested rigs never showed it — they are 1080p50, and this branch only ever fired at UHD.

## 2. What was done

`decklinkPixelFormatXml()` no longer emits anything based on resolution. The element is written only
when the operator explicitly sets `pixelFormat: 'yuv' | 'rgba'` in the DeckLink consumer settings;
otherwise it is omitted and Caspar applies its own bit-depth default — which is what every proven
config in this repo does.

`decklinkRequiresYuvPixelFormat()` is kept (callers and a smoke still reference it) but no longer
drives emission.

## 3. What was verified

- Suite **1972 tests, 1970 pass, 0 fail, 2 skip**; the generator now emits no `<pixel-format>` for
  2160p50 and still honours an explicit override.
- The claim about Caspar's default is read from the source the running binary was built from, not
  from memory.

**NOT verified: the hypothesis itself.** PGM1 has been idle every time I sampled it over AMCP, so I
have never measured the slow playback, let alone this change's effect on it. This is a differential
argument from a known-good config, not a measurement. Owner QA: re-apply the Caspar config on .28
(`<pixel-format>` should disappear from the `<decklink>` blocks), play the timer clip on PGM1, and
measure. If it is still ~80%, the next candidates from the same diff are `<embedded-audio>` and
`<latency>normal</latency>`, both present in the proven config and absent here.
