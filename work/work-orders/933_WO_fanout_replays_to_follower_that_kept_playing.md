# WO-933 — The cluster fan-out replays its air journal to a follower whose Caspar never stopped: its clips jump back to frame 0

**Area:** network, engine
**Status: DONE (02.11.26 — option 1 per owner; smoke 7/7, offline suite 5268/0, on .31's real Caspar a fresh target kept the clip running 5.40 → 6.90 s where the old path reset it 7.90 → 1.38 s)**

## Investigation

Found in the WO-929 follow-up round: real Caspars on both boxes, this box (.9) master, destination "WO929 PGM" cabled
on .31 (gpu_p0, PGM 2 / PRV 3 on both), one clip taken on PGM. Playheads were read with simultaneous `INFO 2-110` on
both Caspars (`median Δ`, corrected for reply skew).

| event | .31's Caspar | fan-out on .9 | playheads after |
|---|---|---|---|
| take on the master | — | 11 lines | Δ 0.001 s (within one frame) |
| **.31 Caspar `RESTART`** | lost its channels | `caught up on channels 2, 3 (8 lines)` within 1 s | clip from frame 0: **Δ 35.56 s** |
| failover (this box's node frozen 30 s) | kept playing | — | Δ 0.002 s |
| **hand back** (Make this server master) | kept playing | fresh target, replay | .31 clip from frame 0 (B 8.9 s, A 47.9 s) |
| **.31 node restart** (Caspar untouched) | kept playing | `forwarding to its Caspar` again, `caught up (16 lines)` | clip from frame 0: **Δ 45.8 s** |
| this box's node restart | — | new journal, 0 lines | Δ 0.000 s |

- The first row is the documented limitation (WO-670: "replayed clips start from their first frame (no SEEK to the
  master's position)"). After a Caspar restart a replay is the only way back to picture.
- Rows 2 and 3 are the real problem: **.31's Caspar never lost anything**, yet its air was rebuilt from the journal.
  On a backup or extension box that is a visible jump to the first frame, on every follower node restart (update,
  crash), every hand-back, every link flap.
- Cause, `src/cluster/cluster-fanout.js`:
  - `plan()` drops a target when the peer leaves `deps.members()` (line 143) or when this box stops being master (`!on`,
    line 138);
  - the next `plan()` builds a fresh target with an empty `synced` set (line 158) and `catchUp()` replays every mapped
    channel (line 186);
  - "Caspar connected" (`onConnected`, line 159) and "target re-created" are treated the same.
- Related: the journal lives in memory. After a **master** node restart it is empty (row 5), so a later follower
  Caspar restart gets no catch-up at all until the next take.

## Options (owner decision)

1. **Check before replaying (recommended).** On a fresh target, before `catchUp`, send `INFO <peerCh>` for each mapped
   channel. Compare the foreground clip per layer with the journal's last PLAY/LOAD for that layer. Channels that already
   match go into `synced` without a replay. Only a channel that really differs (or a Caspar that reconnected after a
   restart) is replayed. Cost: one INFO per channel per new target. It does not fix row 1, which is a real loss.
2. **Replay with SEEK to the master's playhead.** Read the master's own `INFO` per layer and add a SEEK in channel
   frames (memory: SEEK n = sec × channel fps on this build). That fixes row 1 within a frame or two, but row 2 and 3 still
   get a re-PLAY (a cut on air, though to the right frame).
3. Both: option 1 for rows 2–3, option 2 for row 1.

Persisting the journal across a master restart (row 5) is independent and can come with any of them.

Owner, 02.11.26: "Do the recommendation fix on wo 933 then commit and push all" → option 1.

## What was done

- **`src/cluster/cluster-peer-info.js`** (new):
  - `queryChannels(host, port, channels)`: `INFO <ch>` for each channel on one short-lived AMCP connection, 2 s
    timeout. The fan-out's own `PeerCasparConnection` is send-only and drains replies, so it cannot ask.
    - Returns `null` when that Caspar does not answer, and `''` for a channel it refuses.
  - `expectedLayers(lines, ch)`: what the journal's lines leave in each layer's foreground. It follows the clip of
    `PLAY`/`LOAD`, `LOADBG` + bare `PLAY`, `STOP`, and marks a layer that holds a CG template.
  - `channelOnAir(lines, ch, xml)`: true when every such layer shows it there.
    - A file clip must match by name. It reuses `live-scene-reconcile.js` (`parseLayerFgClipsFromChannelXml`,
      `pathsMatch`), the parser the reconcile after connect already trusts on this build.
    - Any other source (`route://`, DECKLINK, `[HTML]`, colours) and CG only need a producer that is not `empty`.
    - Layers the journal does not cover are not compared. A replay would not clear them either.
- **`src/cluster/cluster-fanout.js`** `catchUp`, used when a Caspar connects, a destination is newly cabled, or on
  `resync`:
  - With `deps.queryInfo` it now runs `check()` first:
    - **already on air:** the channel gets only the journal's `MIXER` lines and is marked synced. Re-sending a value
      is invisible, and it covers mixer moves made while that server was not forwarded to.
    - **differs, or no answer:** the channel is replayed as before. That covers a Caspar restart (empty layers, row 1)
      and a server that missed a take while its node was down.
  - A `send()` for a channel under check is held. After the decision the held lines follow the mixer lines (kept);
    a replay already carries them, because they are in the journal.
  - A reconnect during a check bumps `gen`, and the stale answer sends nothing.
  - `caught_up` gains `kept: [channels]`, and the log says `channels N already on air there, kept (no replay)`.
- **`src/api/routes-cluster.js`**: wires `queryInfo` to `queryChannels`.
- Not done: row 1 (SEEK to the master's playhead after a real Caspar restart, option 2) and keeping the journal across
  a master restart. Both are separate follow-ups.

## What was VERIFIED

- `tools/smoke/smoke-wo933-fanout-checks-before-replay.test.js` **7/7** (in `offline-test-files-2.js`):
  - journal → layers;
  - on-air match and mismatch (other clip, empty layer, refused INFO);
  - `queryChannels` against a fake AMCP server (split replies, a `401`, a dead port → `null`);
  - catch-up keeps a matching channel and replays the other;
  - an empty or silent Caspar is replayed as before;
  - held lines arrive once;
  - a reconnect during the check discards the stale answer.
- Existing fan-out smokes (`wo670-cluster-catchup`, `wo670-cluster-fanout`, `wo772-media-sent-resync`): 15/15
  unchanged. Offline suite **5272 tests, 5268 pass, 0 fail**. eslint and the 500-line check clean.
- Real INFO from this box's Caspar (a clip at opacity 0 on 1-199, cleared afterwards):
  - the same clip → on air;
  - another clip or an empty layer → replay;
  - `route://` → on air;
  - a non-existent channel → `''`;
  - a dead port → `null`.
- **On .31's real Caspar** with the real `createClusterFanout` + `PeerCasparConnection` + `queryChannels` (scratchpad
  `wo933-dot31.js`; master ch1 → .31 ch1 layer 199 at opacity 0, cleared afterwards):

  | target | playhead before → after (1.5 s) | sent |
  |---|---|---|
  | first connect, layer empty | — → 1.40 s | replay, 2 lines |
  | **fresh target, with the check** (as after a node restart) | **5.40 → 6.90 s** | 1 mixer line, `kept: [1]` |
  | fresh target, old path (no `queryInfo`) | 7.90 → **1.38 s** | replay, 2 lines |

- Deployed to both nodes and restarted, so the fix is live. Both came back unlinked (0 peers, epoch 0).
  - On .31 the files are hand-copied (live ISO): gone at its next boot until the next ISO build.
- A full re-run of the two-box round (link, shared show, cable, node restart) was not repeated. The .31 test above
  drives the same code path, a fresh target against a Caspar that kept playing.
