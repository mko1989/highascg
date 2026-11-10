# Virtual boxes (WO-1029)

A bed of N HighAsCG boxes on this machine, for linked-server scenarios that need to see **what each box's screens
show and who put it there**. Nothing touches the live box: every node is a sandbox (own temp root, own loopback alias,
ephemeral ports), every Caspar is fake.

## What it models

| Part | File | What it is |
|---|---|---|
| Box | `virtual-boxes.js` | a real node (`sandbox-server.js`) on `127.0.1.x` + its own fake Caspar on `127.0.2.x` + its own device graph (which destinations are cabled on its outputs) + the shared show (destinations, two looks per destination) |
| Caspar | `fake-caspar.js` | AMCP server: `VERSION`, `INFO`, `INFO <ch>` (stage XML the catch-up check parses), `INFO CONFIG`, `CLS`/`CINF` (`LOOK_A`, `LOOK_B`, `LOOK_C`, `E2E_*`), `REQ`/`RES`, `BEGIN…COMMIT`. A **screen model** per channel/layer (fg/bg source and kind, playing, CG template, MIXER) and an append-only **write log** `{ seq, t, from, who, channel, layer, line }` of every mutating line. `who` = the box whose node process holds the connection (found via `/proc/net/tcp` → socket inode → `/proc/<pid>/fd`; loopback sources are all 127.0.0.1) |
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
