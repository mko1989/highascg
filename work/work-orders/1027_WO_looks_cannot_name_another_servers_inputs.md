# WO-1027 — A look cannot name another server's input: raw `route://N-L` gives a 403, an empty layer or the wrong camera
**Area:** engine, network, video-io
**Status: OPEN (09.11 — found and measured in the WO-1026 two-server runs; design below, nothing built)**

## Investigation

Setting (WO-1026): two servers share one show. The master holds the LED wall; the second server holds a 1080p50
destination and the DeckLink inputs "mixer" (3) and "PPT" (4). A look for that destination must show the second
server's DeckLink 3.

- **There is no way to say that in the show.** A look layer's source is a value like `route://11-3` — a channel and a
  layer of whichever server plays it. `src/cluster/cluster-fanout.js:104` translates `route://N` between servers only
  for destination channels. The master's Live sources list only its own inputs, so the look has to be written by hand
  with the route the *second* server lists.
- **Phase 1 (the master has no channel 11):** every take logs, on the master, `AMCP batch: command failed inside
  BEGIN…COMMIT — cmd="LOADBG 7-110 route://11-3 …" reply="403 LOADBG FAILED"` plus Caspar's `Check syntax.` — 26 lines
  in one T5 run. The second server plays it correctly.
- **Phase 2 (the master has channels 9 / 10 of its own):** the same look, now `route://9-3`, loads on the master
  without an error: its channel 7 layer 10 plays `route ch9 L3`, a layer that does not exist there. Empty picture, no
  log line. It is empty only because the layer number equals the DeckLink slot and the two servers use different
  slots. A whole-channel route, or the same slot on both, would put the master's own input (here: a tracking camera)
  into the master's copy of the look — previs, thumbnails, multiview. (Inference from the layout; not run.)
- **Renumbering breaks the look.** Moving two DeckLink ports changed the second server's input channels 11 / 12 →
  9 / 10. Live sources healed by slot (WO-271, `src/config/routing-setup.js:116`); the looks did not, and after that
  server's Caspar restart the master's catch-up replayed the stale routes onto it (2 × `403 LOADBG FAILED` there).
  They had to be repointed by hand over WS `scene_deck_sync` (`tools/e2e/two-box/set-look-source.js`).
- **Related:** the second server kept Live sources for ports that stopped being inputs (`route://9-1`, `route://10-2`),
  now pointing into other inputs' channels (WO-1028).

## Proposed design (not built)

1. **A source that names the input, not the route:** `{ type: "input", server: <cluster id>, slot: <DeckLink n> }`
   (and the same for NDI / other host inputs), stored in the look. Shown in every server's source list as
   "DeckLink 3 · highascg5867".
2. **Resolved at take time on the server that plays it,** by slot → its current channel-layer (the lookup WO-271
   already does for Live sources). A renumbering then needs no edit.
3. **A server that is not `server` skips the layer** (no LOADBG, no error); its previs / thumbnail shows a labelled
   placeholder instead of an empty or wrong picture.
4. **Old looks** with a bare `route://N-L` keep working as today.

Open questions for the owner: whether an input of another server should also be *viewable* on the master (a network
return, e.g. NDI), or the placeholder is enough; and whether the source list on one server should always list every
cluster member's inputs or only on request.

## What was verified

Nothing built. The findings are the T5.6 rows and the phase 2 section of WO-1026.
