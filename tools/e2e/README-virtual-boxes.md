# Virtual boxes (WO-1029)

A bed of N HighAsCG boxes on this machine, for linked-server scenarios that need to see **what each box's screens
show and who put it there**. Nothing touches the live box: every node is a sandbox (own temp root, own loopback alias,
ephemeral ports), every Caspar is fake.

## What it models

| Part | File | What it is |
|---|---|---|
| Box | `virtual-boxes.js` | a real node (`sandbox-server.js`) on `127.0.1.x` + its own fake Caspar on `127.0.2.x` + its own device graph (which destinations are cabled on its outputs) + the shared show (destinations, two looks per destination) |
| Caspar | `fake-caspar.js` | AMCP server: `VERSION`, `INFO`, `INFO <ch>` (stage XML the catch-up check parses), `INFO CONFIG`, `CLS`/`CINF` (`LOOK_A`, `LOOK_B`, `LOOK_C`, `E2E_*`), `REQ`/`RES`, `BEGIN…COMMIT`. A **screen model** per channel/layer (fg/bg source and kind, playing, CG template, MIXER) and an append-only **write log** `{ seq, t, from, who, channel, layer, line }` of every mutating line. `who` = the box whose node process holds the connection (found via `/proc/net/tcp` → socket inode → `/proc/<pid>/fd`; loopback sources are all 127.0.0.1) |
| Apply helpers | `virtual-boxes-apply.js` | `bed.baseline()` (one plain apply per box so the Caspar runs the generated config: dirty starts false), `bed.touch(id, { via })` (dirty a box without moving content), `bed.cable`, `bed.dirtyOf` / `planOf` / `apply` (`GET /api/caspar-config/dirty`, `GET /api/cluster/apply-plan`, `POST /api/cluster/apply`), `bed.screens(id)` (every cabled destination's layers with clip positions), `bed.waitRestored`, `bed.restartsOf` / `restartOrder` (restart markers after a `bed.mark()`), `bed.refreshChannels` |
| Fan-out | `src/api/routes-cluster.js` `fanoutOf` | a sandbox master forwards only when `HIGHASCG_SANDBOX_FANOUT=1` (set by the bed), and a sandbox never opens a socket to `:5250` or a non-loopback address |
| Operator client | `remote-client.js` | what the Godot client on a laptop does: Bearer password on HTTP + WS, its own source alias `127.0.3.x`; take / test card / FTB / raw AMCP / media play / video feed; handover (`learnTargets`, `decide` → `handoverDecision`, `moveTo`) |
| Invariants | `virtual-boxes-checks.js` | `assertOnlyWriters`, `assertNoStrays` (every cabled destination: only its own box wrote, unless a scenario allows more), `wrote`, `topClip` |

Layouts: `oneBox()` (LED wall + Stream PGM on one box), `twoBoxes({ backup })` (A: LED wall, B: Stream PGM, optional
destination cabled on both), `threeBoxes()` (plus C with nothing cabled — a master that owns no screen). Names follow
`two-box/scenario.js` (`LED_ID`, `STREAM_LABEL`).

## What it cannot tell you

- No pictures: the fake Caspar plays nothing. The video feed (WO-670 P1) is checked only for an accepted upgrade.
- No DeckLink, no GPU outputs, no audio; the graph's outputs are named `vb_out_N` and the boot hardware sync is off
  (`HIGHASCG_BOOT_DEVICE_GRAPH_SYNC=0`), so the real box's DP ports never leak in.
- Timing: replies are instant; a real Caspar answers `INFO` slower and a take batch takes frames. Fades complete at once.
- One machine: loopback, no packet loss. A "cut" is a frozen process (SIGSTOP: connects queue, nothing answers) or a
  paused forwarder (`bed.forwarder(id)`, resets); the signed hello (P1a) re-addresses a link around a forwarder, so a
  forwarder cut between two NODES does not hold — use it for a client path, freeze for a node.
- The fake Caspar accepts every line; it rejects only unknown clips (404) and channels above its count.

## Adding a scenario

```js
const { startVirtualBoxes, twoBoxes, DEST } = require('../e2e/virtual-boxes')
const { assertNoStrays, assertOnlyWriters, topClip } = require('../e2e/virtual-boxes-checks')

const bed = await startVirtualBoxes(tmp, twoBoxes({ base: 140 }))   // a free alias base per bed
await bed.linkAll(); await bed.makeMaster('vb-a'); await bed.shareShow(); await bed.waitForwarding('vb-a')
const m = bed.mark()
await bed.box('vb-a').node.post('/api/scene/take-look', { sceneId: bed.look('stream'), target: 'program', forceCut: true })
await bed.waitScreen('vb-b', DEST.stream.id, () => topClip(bed, 'vb-b', DEST.stream.id) === 'LOOK_A', 'forwarded')
await bed.settle()                        // forces polls (= fan-out refresh + catch-up), waits until the Caspars are quiet
assertNoStrays(bed, m, (box, dest) => (dest === DEST.stream.id ? ['vb-a', 'vb-b'] : [box]))
await bed.stop()
```

- Wait with deadlines (`waitFor`, `waitScreen`, `waitMaster`, `waitForwarding`, `settle`), never fixed sleeps.
- Give each bed its own `base` (aliases `127.0.1.<base+n>`), so beds in one file can run concurrently.
- End every window in which no cross-box press was made with `assertNoStrays`: that is what catches the next stray.
- Thaw frozen nodes in `finally` / `after`; `bed.stop()` closes nodes, forwarders and fake Caspars.
- Each smoke file stays under 60 s (failover alone is 12 s).

## Restart, playback model, the hook (WO-1029 apply)

**Restart.** `fake.restart({ channels?, downMs?, fromConfig? })` (also AMCP `RESTART`/`KILL`, and the control endpoint below):
every connection is dropped (`fake.dropped()` counts the ones the fake dropped itself), the listener closes (the node sees a
real disconnect), the screen model and the AMCP-added consumers are forgotten, and after `downMs` (default 300) it listens
again on the SAME address. The channel list comes from the new `casparcg.config` the node wrote (bed: `configFile` = the
node's `<root>/casparcg.config`; INFO CONFIG shows the file as it was at the last start), or from `channels` (a count, or a
list of video modes: numbering = position). The write log survives and gets a marker `{ seq, restart: true, n, channels,
line: 'RESTART', channel: null }` (so per-channel filters skip it); `fake.restarts(sinceSeq)`; `fake.rejected(sinceSeq)` =
mutating lines the fake refused (reply >= 400, e.g. a write to a channel that does not exist yet).

**Playback model** (`fake-caspar-model.js`). A clip has a position that advances with the clock (`opts.now`, or
`fake.advance(ms)` to skip time) at one second per second, wraps modulo its length when looping, holds the last frame
otherwise. Length: `opts.lengths[NAME]` / `opts.clipLengthS` (default 600 s). This build: `SEEK n` (as a `PLAY`/`LOADBG`/`LOAD`
argument and `CALL ch-l SEEK n`) = n x CHANNEL fps (fps from the channel's video mode: 1080p5000 = 50, 720p2500 = 25).
`LOADBG / LOAD / PLAY / PAUSE / RESUME / STOP / CALL SEEK / CALL LOOP` update it; `fake.clip(ch, layer)`,
`fake.position(ch, layer)`. `ADD ch[-idx] <consumer> …` / `REMOVE` are listed in INFO and `fake.consumers(ch)`.
`INFO <ch>` follows the real state tree (src-v2 av_producer.cpp / output.cpp): `channel.{format, framerate,
stage.layer.layer_N.{background, foreground.{producer, file.{name, path, time=position, time=length, clip, clip}, loop,
paused, route.{channel, layer}}}, output.port.port_N.consumer}`. `fake.set({ refuseInfo: true })` makes `INFO <ch>` answer 500.

**The hook.** The bed starts every node with `HIGHASCG_SANDBOX_CASPAR_RESTART_URL` = the loopback control endpoint of THAT
box's fake (`fake.control.url`: `POST /restart`, `GET /state`). In a sandbox, `applyFullServerConfig`
(`src/utils/full-config-apply.js`, sandbox branch) writes the config and then `reloadCasparViaSandboxHook`
(`src/utils/caspar-restart.js`) POSTs there, waits for the node's AMCP client to see the disconnect, then for the
reconnect (the fake says when it listens again), and answers `{ attempted, restartSent, disconnected, reconnected }`.
Without the variable (or a non-loopback / :5250 URL) a sandbox apply still only writes the config. Never systemctl, never a process.

**Making a box dirty.** A cable change on a virtual box does not alter the generated casparcg.config (its outputs are not
GPU / DeckLink heads), so the box is not dirty; `bed.touch()` flips the video mode of a destination that is not cabled on
that box, which does (through the box's own device-view API, or another box's relay with `via`).

**Look banks (WO-1029).** Program looks alternate between bank A (Caspar layers 10-99) and bank B (110-199): a take plays
the incoming look on the bank opposite the node's pointer (`programLayerBankByChannel`, exposed at
`GET /api/state` → `scene.programLayerBankByChannel[<program channel>]`), flips it and clears the outgoing look. Odd takes
from a fresh box leave the look on bank B, even ones on bank A. The fake treats layers >= 110 like any other: `INFO <ch>`
lists every layer under its physical number with clip name and position / length, and every verb acts on exactly the layer
named, so a second copy of a clip on the other bank is visible. `assertOneCopy(box, channel, clip, { n, layers })`
(`virtual-boxes-checks.js`) asserts how many layers of a channel show a clip, whatever bank; the apply scenarios use it
after every restore. The "program look on bank B / bank A" scenarios in `smoke-wo1029-virtual-apply.test.js` take looks
through the real take route, put the previous look back by hand on the other bank (a fading outgoing look), Apply, and
expect one layer per look clip on the same bank, position within 1.5 s, `via: 'look'`, the leftover in `restored.skipped`,
the pointer equal to the bank on Caspar, and a normal next take. Before 87f8643b they fail with
`2 layer(s) of ch 1 show LOOK_A (want 1) — channel has [10:LOOK_A 110:LOOK_A]`.
