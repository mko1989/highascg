# WO-1030 — An 8K tiled output runs at 19 fps on highascg5867: idle channels read back full frames
**Area:** video-io, engine, caspar-build, mapping
**Status: OPEN (10.11 — measured on the box, causes ranked; nothing changed in the product)**

Owner, 10.11: *"i did a tiled output on the second box and it seems to be barley handaling even a test patern on that
output. check if it doesnt run multiple unnecesery channels"*

## Investigation (highascg5867, RTX 2080 SUPER, release 2026-11-10T113912Z)

Setup: PGM/PRV 3 (7680x2160@50) → Pixel Mapping 1 → DP-0 + DP-4 (one always-on-top screen consumer 7680x2160 on
channel 5), operator GUI on HDMI-0, the Godot client running. 10 Caspar channels: 1 operator GUI (shm), 2/3 copies of
the LED (3072x1024), 4 copy of "to zoom", **5 PGM and 6 PRV of the tiled screen, both 7680x2160**, 7/8 Stream PGM,
9/10 DeckLink inputs. GPU utilisation 100 % in every state below.

Measured: screen consumer `presented_frames` of channel 5 over ~5 s (the rate that reaches the wall).

| State | Output fps | Caspar CPU |
|---|---|---|
| As left: HTML test card on PGM, PGM and PRV each hold a clip frame | **18.7** | 345 % |
| Test card off | 26.2 | 127 % |
| + PRV 8K channel cleared | 40.8 | 127 % |
| + PGM clip cleared (both 8K channels empty) | 41.1 | 150 % |
| As left, but the meter consumer removed from the 8K PRV channel | 30.8 | — |
| … and from Stream PRV (8) | 33.4 | — |
| … and the test card off | 44.5 | 140 % |

Causes, in order of cost:
1. **The 8K PRV channel.** Every channel without a real consumer gets a "meter-null" ffmpeg consumer
   (`src/audio/meter-null-consumer.js`, index 720) so that its compositor ticks; a ticking channel fetches its full
   frame every tick — for 7680x2160 that is 33 Mpixel × 50 /s read back from the GPU for nothing. Removing that one
   consumer took the wall from 18.7 to 30.8 fps. (The channel then stops ticking, so its preview tile freezes.)
2. **The HTML test card at 7680x2160.** CEF (GPU off: `cefEnableGpu` unset) rasterises and uploads an 8K page:
   ~220 % CPU and 18.7 → 26 fps (or 33 → 44.5 with the PRV fix).
3. **Still not 50 with both gone (41–44.5 fps, GPU 100 %).** Left: the 8K PGM mix + the 7680x2160 window, seven
   route layers into the operator GUI channel (two of them from the 8K channels), the copy channels 2/3/4 and
   Stream 7/8 ticking with their own meter consumers, the Godot client on the same GPU. Not separated yet: the copy
   channels' meter consumers were re-added by the node within seconds, so that row measured nothing.

## Fixes to consider

- **Now, by the operator:** make the tiled destination PGM only (no PRV channel at 8K).
- **Meter consumer policy (node):** none on a channel whose raster is large and that shows no meters (PRV, copy
  channels); or tick such channels at a reduced rate.
- **Caspar build:** a consumer that takes audio only must not trigger the frame fetch (the root of WO-500 too).
- **Copy channels** (2/3/4 here) go with "channels only where a destination is cabled" (WO-1029 plan 07).
- **Test card:** a native pattern, or the HTML card rendered at a fraction of the raster and scaled by the mixer.
- **Operator GUI previews of an 8K channel:** route a reduced copy, not the full raster (cost not measured).
- Measure each remaining item separately (the copy channels with the node's re-add held off; the GUI routes; the
  client closed).

## Owner's decisions (10.11)

- Meter consumer policy / Caspar audio-only consumer: **no** ("this not").
- Copy channels: **"this defenitly"** → WO-1029 plan 07 (channels only where a destination is cabled), started.
- Operator GUI previews of an 8K channel: **wait** — "lets first see when only one destination is left on that box".
  Re-measure 5867 once it creates channels only for what it outputs, then decide.
- Test card (native pattern / rendered small): no verdict given.

## Re-measured with channels only where cabled (10.11 13:50, 5867 on 2026-11-10T124525Z, flag on)

5867 now runs **7 channels** (was 10): 1 operator GUI, 2/3 PGM/PRV 3 (the 8K wall), 4/5 Stream PGM, 6/7 DeckLink 3/4.
The copies of the LED and of "to zoom" are gone. GPU still 100 % in every state.

| State | 10 channels (before) | 7 channels |
|---|---|---|
| A clip frame on the wall, no card, 8K PRV empty | 41 fps (both 8K empty) | **50.0** |
| Test card on the wall, 8K PRV empty | — | 37.0 |
| A clip frame on the wall + one on the 8K PRV, no card | 26.2 | 29.4 |
| Both + the HTML test card (the state the owner reported) | 18.7 | 20.6 |

So removing the copy channels is what gets the idle wall to a full 50 fps, but it barely moves the reported state:
the 8K PRV holding a picture (-20 fps) and the 8K HTML test card (-13 fps with the PRV empty) still dominate.

Seen at the switch (the consumer steps C1b / C1c / C11 of plan 07 are not on 5867 yet):
- The restore put content back by channel NUMBER: the test card and the ended clip of the wall landed on channel 5
  (now Stream PRV), and a `visuals` shm layer that sat on the old LED copy channel 2 appeared on the wall's new
  channel 2. Cleared by hand; the card re-enabled on channel 2.
- Two `AMCP batch COMMIT ack timeout (64 cmds)` from the template orphan sweep; the restore took 15 s.
- The two "2box" looks name DeckLink 3 / 4 as `route://9-3` / `route://10-4`; those inputs are on channels 6 / 7 now.

## Third measurement (10.11 15:10) — 5867 with ONLY the wall (5 channels: GUI, wall PGM/PRV, DeckLink 3/4)

Owner: "the box runs in 100% straight when the consumer is enabled. is the gl texture something in the caspar config?"
`<gpu-texture>true</gpu-texture>` is in the generated screen consumer (on): the window draws the mixer's texture
directly. GPU utilisation reads 100 % in every state; PCIe bus utilisation 72–76 %.

| State | Wall fps | Caspar CPU |
|---|---|---|
| As left: HTML test card on the wall | 31.6 | 90 % |
| Test card off (wall channel empty, screen consumer on) | 32.0 | 140 % |
| + the meter consumer removed from the (empty) 8K PRV channel | **51.9** | 140 % |
| + ForceCompositionPipeline off on the two wall heads | 52.1 | 154 % |
| … with the HTML test card back on | 36.3 | 420 % |

- The limiter is the 8K PRV channel's meter consumer: even EMPTY, the channel ticks and its 33 Mpixel frame is read
  back 50 ×/s. Without it the wall runs at the full 50. (Restored afterwards, as found.)
- The driver's composition pipeline costs nothing measurable here. (Restored to On.)
- The 8K HTML test card alone takes the wall from 52 to 36 fps and Caspar to 420 % CPU.
- So the choices are: the tiled destination as PGM only (no 8K PRV channel at all), or the meter-consumer change the
  owner declined, or a PRV channel at a reduced raster.

## Fourth measurement (10.11 ~16:00) — cost of watching the wall from the other box (WO-1029 picture relay)

5867 on 2026-11-10T150805Z, 2 channels (GUI + wall PGM 7680x2160p50), wall content light (clip + visuals layer).
Wall fps = screen consumer `presented_frames` of channel 2; CPU from `top` (20 threads = 2000 %).

| Who watches the wall | Wall fps | Dropped | GPU | Caspar CPU | SHM consumer on ch 2 |
|---|---|---|---|---|---|
| Nobody (both clients closed) | 50.0 | 0 | 62–64 % | ~12 % | no |
| Only 7579 (relayed tile) | 50.0 | 0 | 64 % | ~141 % | yes |
| Only 5867's client open | 50.0 | 0 | 91 % | ~122 % | **no** |
| Both | 50.0 | 0 | 89–91 % | ~300–400 % | yes |

- The relay costs about 1.3–2 CPU threads of Caspar on the wall's box and no GPU. The wall kept 50 fps, 0 drops.
- Cause: `modules/shm/consumer` publishes every frame at full size (66 MB x 50/s) for a 480 px / 10 fps picture.
  A reduced publish (every Nth frame and/or a scaled copy) needs a Caspar change — not done.
- The GPU step 64 → 91 % comes from 5867's own client (visuals layer), not from the relay.
- With only 5867's client open there was no SHM consumer on the wall channel: its own wall tile was not leasing
  at that moment (tab not checked) — open.
