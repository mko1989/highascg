# WO-1021 — Route-heal points live sources at channels of a config that has not been applied yet
**Area:** devices-config, video-io
**Status: OPEN**

Found by the lead on 09.11 while checking WO-1017 (agent I flagged it too). No owner report; it showed up in the journal.

## Investigation

- **Setup:** at about 13:20 the owner added the screen destination "PGM/PRV 3" (7680x2160) in Devices without
  pressing Apply. The generated layout then put the new PGM/PRV pair in as ch 5/6 and moved the DeckLink inputs to
  7/8 (later 7/9 in that draft). The running Caspar still had DeckLink input 1 on ch 5 and DeckLink input 2 on ch 6.
- **What happened:** at 13:24:02 Caspar restarted (not ours, most likely needrestart during the apt full-upgrade). On
  that reconnect the journal shows:
  `13:24:07 [route-heal] extraLiveSources re-pointed: "DeckLink 1": route://5-1 → route://7-1; "DeckLink 2": route://6-2 → route://9-2`.
  - At that moment ch 7 was the 64x36 audio preview and ch 9 did not exist.
  - Both Live-tab DeckLink sources pointed at the wrong channel or at nothing until the Apply at 13:42.
  - The new routes were written to the config, because `configManager.save` persists them.
  - The DeckLink retry then logged `COMMAND_UNKNOWN_DATA: PLAY 9-2 DECKLINK 2` every 20 s (last at 13:42:28).
- **Cause:** `src/config/live-source-route-heal.js:73` takes `routingMap.getChannelMap(config)`. That is the
  layout generated from the current settings, not the layout the running Caspar was started with. The heal runs on
  every Caspar connect (`src/config/routing-setup.js:109`, WO-271), so between a Devices edit that renumbers channels
  and the Apply, any reconnect or node restart re-points the sources ahead of time. The DeckLink setup
  (`host-live-sources-setup.js`) also PLAYs onto the generated channels. The same window caused the WO-1017 fan-out
  hazard, which stage 1 now guards.
- **When it stops:** after the Apply, the generated layout and the running one agree, and the heal is right again
  (13:42:50: `"DeckLink 2": route://9-2 → route://8-2`).

## Direction (not started)

Heal and replay against the RUNNING layout while a restart is pending. Options:
- (a) skip the heal and the input PLAYs while `needsRestart`, i.e. while the generated channel count or sizes differ
  from `INFO`;
- (b) build the map from the config Caspar was last started with (the written `casparcg.config` at restart time),
  not from the current settings.

(b) also covers the fan-out and the multiview cells. Either way the persisted routes must not move before the Apply.

## What was done

Nothing yet.

## What was verified

Nothing yet.
