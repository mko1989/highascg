# WO-473 — a fresh box still comes up with two audio outputs and a record output

**Status: DONE (11.08.2026, verified: offline suite 1947/1945 pass/0 fail/2 skip — the two
standing failures are cleared too, eslint 0 errors, 0 files over 500 lines, dist-web rebuilt)
— owner QA: next fresh install + one New project**

Successor to [WO-470](./470_WO_SC60_MONITOR_LEAKS_INTO_FRESH_INSTALLS.md) (audio half, which left a
manual re-seed as owner action) and narrows [WO-393](./393_WO_ALLOW_ZERO_STREAM_RECORD_OUTPUTS.md)'s
"key absent → seed one default" rule for record outputs.

## 1. Investigation

Owner 11.08: *"the audio fix didnt land — the other machine started with 2 audio outputs already
created and filled with a device. fresh project shouldnt have audio outputs created as well as
record output."*

Three separate carriers, all live at once. WO-470 closed only the first.

**(a) The operator volumes still carry this box's audio outputs.** WO-470 blanked the committed
`config/audio_outputs.json` and recorded the re-seed as owed owner action — it never happened, and
nothing structural stopped it happening again:

```
/home/casparcg/bridge/configs/audio_outputs.json
  audio_1            portaudio    hw:0,0
  audio_monitor_usb  system-audio sc60mon   role: monitor
```

The `bridge-modular-config` / `usb-modular-config` sync pairs copy `configs/` in **both**
directions and excluded only `replication*.json`, `hardware-identity.json`,
`device-identity.json`. So this box pushed its audio devices to the stick and bridge on every save,
and any box seeded from those volumes pulled them back at boot. A named ALSA/PortAudio alias is
machine-local by construction — `sc60mon` means nothing on another machine, which is exactly the
Caspar `Failed to initialize audio device` WO-470 chased.

**(b) The committed device graph still shipped this box's hardware.** Found by pointing the WO-470
gate at committed content instead of the working tree — `git show HEAD:config/device_graph.json`
carried **seven** connectors where the factory ships zero:

```
rec_1, audio_1, audio_monitor_usb (externalRef "sc60mon"), gpu_p0, gpu_p1, gpu_p2, gpu_p3
```

That alone puts two audio bands and a Rec band, pre-filled with devices, into a fresh install's
device view. WO-470's gate never saw it: its `sc60` scan read the **working tree**, and this box's
live graph happens to have no connectors at all, so the committed leak was invisible from here.

**(c) A record output is a shipped default, and four fallbacks re-create it.**
`src/config/defaults-core.js` shipped `recordOutputs: [rec_1 → program_1]`, and even with that
blanked, four sites re-materialised a literal `rec_1` whenever the key was absent:

| site | effect |
| --- | --- |
| [src/api/settings-get.js](../../src/api/settings-get.js) | `/api/settings` invents rec_1 |
| [src/config/device-graph-suggest.js](../../src/config/device-graph-suggest.js) | device view draws a rec_1 band |
| [client/lib/settings-state.js](../../client/lib/settings-state.js) | GUI renders "Rec1" **before the server answers** |
| [client/components/device-view-bands-render.js](../../client/components/device-view-bands-render.js) | first "Add record output" would create Rec2 |

**Why the gate went unheard.** `config/` is simultaneously the repo's factory defaults and the LIVE
config of whatever box the repo is checked out on. WO-470's gate asserted on the working tree, so
on this box it failed permanently — `npm run test:ci` had been sitting at 2 failures for a day, and
a permanently red gate is a gate nobody reads. That is how (b) survived in plain sight.

## 2. What was done

**Stop the leak riding the volumes** — `config/exfat-sync.json` (+ the bridge's copy, which wins at
boot via `bootPrefer: exfat`): both modular-config pairs now exclude `audio_outputs.json` and
`audio_capture.json`. The exclude predicate is applied on both the push and the pull walk
(`src/system/exfat-sync.js:104,161`), so neither direction carries them again. The bridge's
`audio_outputs.json` was blanked to `[]`. **The stick is unplugged** (pulled 10:01 today) — it still
holds the old copy and needs the same blanking on next insert, though the exclude now stops it
reaching `config/` regardless.

**Ship the factory shapes.** `config/device_graph.json` (→ caspar_host only, no connectors) and
`config/record_outputs.json` (→ `[]`) are now committed as the factory emits them. This box's own
values were left untouched in its working tree — that split is the point, and the gates below were
moved to match it.

**No record output by default.** `defaults-core.js` → `recordOutputs: []`, and all four fallbacks
above → `[]`. A fresh box and a New project show no Rec band until the operator adds one; the first
Add now creates Rec1.

**Gates judge what is STAGED, not the working tree** — new
`tools/smoke/lib/committed-config-slice.js` (`git show :path`), used by the WO-470 gate, the
WO-425 gate and the new one. On a non-git install it degrades to skipping that assertion, since
nothing can be committed from there anyway. This both un-sticks the suite on live boxes and is what
exposed leak (b).

**New standing gate** `tools/smoke/smoke-fresh-box-no-record-output.test.js` (registered in the
curated `FILES` list): factory + New-project hardwareConfig carry zero record outputs; the staged
`record_outputs.json` is empty; the staged `device_graph.json` has no connectors and only
`caspar_host`; and none of the four sites may re-introduce a literal `rec_1`. It also pins
`audio_outputs.json` into both sync excludes, so removing that exclude fails CI.

**WO-393 narrowed, not weakened.** Its "key absent → seed one default" rule still holds for stream
outputs; for record outputs the seed is gone, and its source-text guard was repointed to the new
`: []` form with the reason recorded in the test.

### Not done, deliberately

Diffing every committed slice against the factory turned up four more that drift —
`general.json` (GPU port naming, an `audioCapture` block, `configVersion`), `osc.json`,
`ui.json`, `caspar_server.json` (`screen_count: 0` vs `1`, `vsync` flips). None are machine-identity
leaks of this class, and rewriting them blind would change fresh-box boot behaviour I cannot verify
offline. Worth its own WO.

The bridge's `record_outputs.json` was left carrying this box's `rec_1`: it is this box's real
setup and not device-bound, and blanking it would delete the owner's recorder at the next boot
sync. Factory-produced sticks (`pack-exfat-starter-zip.sh` → `buildFactoryModularConfig`) now carry
none.

## 3. What was verified

- `npm run test:ci` — **1947 tests, 1945 pass, 0 fail, 2 skip**. The two long-standing failures
  (WO-425 + WO-470 audio gates reading this box's live config) are gone.
- Factory + New project probed directly: `factory recordOutputs=[] audioOutputs=undefined`,
  `new-project hw recordOutputs=[] audioOutputs=undefined` (audio left `undefined` on purpose — a
  New project must not wipe the audio devices an operator configured on the box, cf. WO-443).
- Staged content re-read after commit prep: `record_outputs.json` = `[]`, `device_graph.json` =
  0 connectors / `[caspar_host]`; the box's live files unchanged on disk.
- `eslint` 0 errors (1 pre-existing warning in device-graph-suggest.js), 0 files over 500 lines,
  `npm run build:client` rebuilt dist-web.

**Not verified live:** `highascg.service` is down and no stick is inserted, so neither device view
nor a real fresh install was observed. Owner QA: on the next produce/install, confirm device view
opens with no audio and no record bands, and that "New project" adds none.
