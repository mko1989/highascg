# WO-933 — The cluster fan-out replays its air journal to a follower whose Caspar never stopped: its clips jump back to frame 0

**Area:** network, engine
**Status: OPEN (02.11.26 — reproduced three ways on .9 + .31; design choice for the owner below)**

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

## What was done

Nothing in code yet. This WO records the measurements and the cause.
