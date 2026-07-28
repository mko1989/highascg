# WO-377 — a host-channel cable was invisible to the output mapping: the virtual camera stayed on channel 1

**Status: DONE (28.07.26 — root cause proven against the owner's own live graph, before/after measured on it, fixed. SERVER change: needs a highascg restart.)**

Source: `work/work-orders/todos28.07.26`, owner lines added 28.07:

> i connected decklink input 4 host channel to a virtual camera output and on the output there is
> channel 1 output instead of decklink.
> if i change the id to 4 it starts with the correct channel but it defaults to 1 instead of using
> the connection to determine the channel.

The second line is the precise diagnosis: **the bridge works, the cable does not feed it.**

## 1. Investigation

### 1a. The cable exists — read off the live box

`GET /api/device-view`, 28.07:

```
dst_in_dst_mrzemj1s_1        (destination_in) -> gpu_p0    (gpu_out)
dst_in_dst_mrzeocxh_1        (destination_in) -> gpu_p3    (gpu_out)
dst_in_dst_mrzeocxh_1        (destination_in) -> gpu_p1    (gpu_out)   note={"outputLayer":2}
dst_in_host_decklink_input_4 (destination_in) -> vcam_1    (v4l2_out)     ← the owner's cable
```

and the source connector carries everything needed:

```json
{ "id": "dst_in_host_decklink_input_4", "kind": "destination_in",
  "externalRef": "host_decklink_input_4",
  "caspar": { "hostRole": "decklink_input", "hostChannel": 4, "slot": 4 } }
```

### 1b. …and was dropped one line into the mapping

`collectDestinationOutputEdges()` resolves each edge's source through the persisted destination
list ([device-graph-output-mapping.js](../../src/config/device-graph-output-mapping.js)):

```js
const destination = byDestId.get(destinationId)
if (!destination) return null            // ← here
```

`screenDestinations.destinations` on this box holds exactly `['dst_mrzemj1s_1', 'dst_mrzeocxh_1']`.
**Host-channel destinations are VIRTUAL** — Device View builds them from the channel map
(`listHostChannelDestinations`, `client/lib/device-view-host-channels.js`) and they are never
persisted. So `host_decklink_input_4` missed the lookup and the whole edge was discarded.

With the edge gone, `applyVirtualCameraMappingsFromGraph()` saw **zero** `v4l2_out` edges, returned
`{ changed: false }`, and `virtualCamera.channel` kept its stored value — 1. Exactly "there is
channel 1 output instead of decklink", and exactly why editing the id by hand worked: that writes
the number the mapping was supposed to derive.

### 1c. Why it cannot be fixed by naming the source

The other consumers of this function (`streamingChannel.videoSource`, `recordOutputs[].source`)
store a source **string** — `program_N` / `preview_N` / `multiview` — later resolved by
`resolveInputTargetToChannel()`, which understands only those three forms. A host channel has no
such name. The virtual camera is different: it takes a channel **number** (`virtualCamera.channel`),
so it can honour a host channel today while the string-based consumers cannot.

## 2. What was done

1. `collectDestinationOutputEdges()` no longer discards a source that is missing from
   `screenDestinations`. If the connector carries `caspar.hostChannel`, it yields an item with
   `hostChannel` set, `videoSource: null` and `mode: 'host_channel'`. A host connector with no
   usable channel is still dropped, as before.
2. `applyVirtualCameraMappingsFromGraph()` prefers that explicit channel:
   `winner.hostChannel || resolveInputTargetToChannel(config, winner.videoSource)`.
3. **Guard for the string consumers**: the stream and record loops skip an edge whose `videoSource`
   is null, so an unnameable source can never blank a working `recordOutputs[].source` /
   `streamingChannel.videoSource`. Without this, teaching the collector about host channels would
   have introduced a new bug in the path WO-373 just fixed.

## 3. What was VERIFIED

**Before and after, on the owner's own graph** (the live `/api/device-view` payload, fed straight
into the mapper):

| | v4l2 edges seen | result | `virtualCamera.channel` |
|---|---|---|---|
| at `HEAD` (pre-fix) | **0** | `{changed:false}` | **1** ← the reported bug |
| after | **1** (`hostChannel: 4`) | `{changed:true, channel:4}` | **4** |

- New smoke `tools/smoke/smoke-wo377-host-channel-virtual-camera.test.js` (5 tests, curated FILES
  list), fixtured from that same live graph: the edge survives, the channel comes off the
  connector, a normal screen destination still resolves via `program_1`, a host-channel cable
  landing on a RECORD sink leaves `recordOutputs[].source` untouched, and a host connector without
  a channel is still ignored.
- **Full suite: 1637 tests, 1635 pass / 0 fail / 2 skip.** Lint 0, prettier clean, 500-line gate clean.
- Nothing on the box was re-cabled and no config was written — the mapper was exercised against a
  copy of the payload.

## 4. Owner QA owed

**Needs a highascg restart** (`kill -TERM $(systemctl show -p MainPID --value highascg)`) — this is
server-side config mapping. Then: with the decklink-4 → virtual cam cable in place, the virtual
camera should come up on channel 4 without anyone typing the id, and the output should show the
DeckLink input rather than PGM.

## 5. Related, deliberately not done

- Host channels still cannot feed **stream** or **record** outputs — those store a source string
  and there is no name for a host channel. If the owner wants that, the fix is a vocabulary
  addition (`host_<N>`) in `resolveInputTargetToChannel()` plus the writers, which is a config
  semantics change and should be its own WO.
- The same virtual-camera bridge is what [WO-376](./376_WO_shader_camera_channel.md) proposes
  routing into shaders; that WO's §2 decision (which source "camera" means) interacts with this
  one — cabling the bridge is now the way to point it at something other than PGM.
