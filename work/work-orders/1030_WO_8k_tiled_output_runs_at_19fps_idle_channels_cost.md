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
