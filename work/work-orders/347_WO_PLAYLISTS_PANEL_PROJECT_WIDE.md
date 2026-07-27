# WO-347 — Playlists panel lists ALL project playlists; set start item before playout

**Source:** todos27.07.26 — "playlists panel needs to show all playlists that are created in
looks. as an operator i need to be able to set an item of the playlist before playout."

**Status: OPEN → implementing.**

## Fix
1. `GET /api/playlist/state`: additionally enumerate playlist layers from the PROJECT envelope
   (`loadProjectScenes()`), flag `live:false` when not currently in scene.live; live entries keep
   channel/pLayer.
2. New control `action:'set_start'` (`{ sceneId, layerNumber, index }`): stores
   `ctx.playlistStartIndices[pKey]`. `setupLayerPlaylists` seeds `playlistActiveIndices` from it
   and, when >0, advances to that item right after staging (forceCut takes make the flash of
   item 0 imperceptible — accepted v1).
3. Panel: lists every playlist (look name · layer, "live" badge); for non-live entries the item
   dropdown sets the start item (transport buttons disabled); live entries behave as today.

## Acceptance
Operator picks item 3 of a non-live look playlist → takes the look → playout starts at item 3;
live playlists keep prev/goto/next.
