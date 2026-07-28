# WO-378 — one source vocabulary: `channel_<N>` for channels, `program_<N>` only as a screen label

**Status: DONE (28.07.26 — server side complete and verified; the client source pickers still do not OFFER host channels, §5. SERVER change: needs a highascg restart.)**

Source: `work/work-orders/todos28.07.26`, owner, 28.07, in response to WO-377's closing note that
host channels still could not feed stream/record outputs:

> host channels must be able to feed any and all outputs.
> the vocabulary is wrong by calling casparcg channels programs. program should be only used as a
> label/id of a pgm screen. the rest should be dealt in channels terminology

Direct follow-up to [WO-377](./377_WO_host_channel_cable_ignored_by_output_mapping.md), which made
a cabled host channel reach the **virtual camera** only.

## 1. Investigation

### 1a. The owner is describing a real category error in the code

"What feeds this output" was expressed exclusively as `program_<N>` / `preview_<N>` / `multiview`.
Those three name **screen buses** — they mean "the PGM bus of screen N", which is a mapping
question answered by `getChannelMap()`. There was no way to say **"Caspar channel N"** at all. So
anything that is just a channel — a decklink input bus, a live-audio bus, an encode bus — was
unnameable, and the code reached for `program_1` as the stand-in. That is exactly the conflation
the owner is calling out, and it is why WO-377's symptom was "it defaults to 1".

### 1b. Three copies of the same regexes, two silent fallbacks to channel 1

| resolver | file | unknown name → |
|---|---|---|
| `resolveInputTargetToChannel` | `src/config/rtmp-output.js` | `null` |
| `resolveRecordSourceChannel` | `src/api/routes-streaming-channel-shared.js` | **`map.programCh(1)`** |
| `resolveStreamOutputCasparChannel` | `src/config/routing-map.js` | **`map.programCh(1)`** |

Each carried its own `^program[_-]?(\d+)$` / `^preview[_-]?(\d+)$` pair. None understood a channel
name. Two answered "channel 1" to anything they could not parse — silently.

### 1c. The vocabulary already existed on the client, wired to nothing

`client/lib/device-view-host-channels-destination-utils.js` had:

```js
/** Token stored on recordOutputs[].source / streamingChannel.videoSource when cabled from a host destination. */
export function hostChannelVideoSourceToken(dest) {
	const ch = parseInt(String(dest?.casparChannel ?? dest?.pgmChannel ?? ''), 10)
	if (Number.isFinite(ch) && ch >= 1) return `channel_${ch}`
	return 'program_1'
}
```

Someone had already reached the same conclusion — `channel_<N>` — and **nothing ever called it**
(one re-export in `device-view-host-channels.js`, no consumers). Had it been wired, it would have
made things worse, not better: the server did not understand `channel_<N>`, so those two fallbacks
would have turned it into channel 1 anyway.

This is the WO-367 failure class again, and it slipped past that WO's own gate — the
unwired-export check counts a name appearing anywhere outside its file as "referenced", and a
re-export is exactly that. A known, documented false negative; now demonstrated in the wild.

## 2. What was done

**New `src/config/output-source-name.js`** — the single vocabulary, split by MEANING:

| name | means | resolution |
|------|-------|-----------|
| `channel_<N>` | a Caspar channel, named directly | `N`, with **no screen-count bound** — host/encode channels live outside the screen range |
| `program_<N>` | the PGM bus **of screen N** — a screen label, the only thing "program" may mean | through the channel map |
| `preview_<N>` | the PRV bus of screen N | through the channel map |
| `multiview` | the multiview bus | through the channel map |

`resolveOutputSourceToChannel(map, name)` takes a **map**, not a config, so it stays free of config
plumbing and the switcher-aware record path can pass its own. It returns `null` for anything
unknown — callers keep their own fallbacks, because they legitimately disagree (the record path
would rather record *something* than refuse).

**All three resolvers now delegate to it**, keeping their individual fallbacks. The duplicated
regexes are gone.

**Host-channel edges are now named.** `collectDestinationOutputEdges()` emits
`videoSource: channelSourceName(hostChannel)` (e.g. `channel_4`) instead of WO-377's interim
`null`, so a cabled host channel flows into `recordOutputs[].source` and
`streamingChannel.videoSource` like any other source. The virtual camera keeps working through the
same name.

**Dead client helper removed.** `hostChannelVideoSourceToken()` and its re-export are gone: the
token is now produced server-side from the graph edge, which is the only place that knows which
cable won. Leaving it would have been a second, drifting source of the same string.

## 3. What was VERIFIED

- **A host channel feeds all three output kinds**, from the owner's own cable shape
  (`dst_in_host_decklink_input_4 → sink`):
  record `source` → `channel_4`, stream `videoSource` → `channel_4`, virtual camera
  `channel` → `4`.
- **The name round-trips**: what the mapping writes resolves back to the same channel through the
  shared resolver (`resolveInputTargetToChannel(cfg, 'channel_4') === 4`).
- **Every resolver speaks it**: `resolveInputTargetToChannel('channel_4') → 4`;
  `resolveRecordSourceChannel` on a `channel_4` output → **4** (it used to give 1);
  `resolveStreamOutputCasparChannel({videoSource:'channel_4'}) → {attach, ch:4}`.
- **Screen semantics preserved**: `preview_2` → the PRV channel of screen 2 (not channel 2);
  `program_9` on a 2-screen box → `null`, not a channel number; a screen destination cabled to a
  record output still writes `program_1`.
- **Junk is still junk**: `''`, `null`, `channel_0`, `program_0`, `nonsense`, `channel_x` → `null`,
  and the record path still falls back rather than failing.
- New smoke `tools/smoke/smoke-wo378-channel-source-vocabulary.test.js` (8 tests, curated FILES list).
- **Two assertions in WO-377's smoke were INVERTED on purpose** and annotated: they pinned the
  interim "a host channel has no name / must not touch a record source", which this WO
  deliberately supersedes. (CLAUDE.md: repoint smokes, never weaken them — here the behaviour
  genuinely changed, so the tests state the new contract and say why.)
- **Full suite: 1645 tests, 1643 pass / 0 fail / 2 skip.** Lint 0, prettier clean, unwired-export
  gate clean, 500-line gate clean.

## 4. Owner QA owed

**Needs a highascg restart.** Then, with the decklink-4 host channel cabled to a record or stream
output, that output should capture the DeckLink input — and `Record start requested on ch<N>` in
the log should name channel 4, not 1.

## 5. Not done — the client still does not OFFER host channels

The server now accepts and resolves `channel_<N>` from any source, and Device View cabling
produces it. What is **not** built is a picker: the stream/record source dropdowns in the UI still
list only screen buses, so `channel_<N>` can be arrived at by cabling but not chosen from a menu.
That is a client-side follow-up, and it should present host channels by their friendly label
("DeckLink input 4"), not the raw token.

Also unchanged by design: `parseOutputSourceName()` is exported for exactly this — a UI that needs
to render a stored source name sensibly should use it rather than re-deriving the shapes.
