# WO-1051 — Visuals layers as their own sources: pick a layer in Sources ▸ Live, stack it on look layers

**Area:** godot-client, engine
**Status: IN PROGRESS (13.11 — design contract; build delegated)**

Owner, 12.11: *"i also want to be able to select from live tab, with a expand, visuals layers routing, so i can play for
instance first 2 layers on the bg output pgm1 and layers 4 5 on overlay channel pgm2."* Clarified 13.11, after the misread
WO-1049 (deprecated, reverted): *"i wanted to be able to pick layers from the live tab of the sources, when the shm visuals
are on, give me layers to pick and stack them on look layers."*

## Investigation

- The owner runs the Visuals as a **Live source** (Visuals ▸ Output ▸ "Live source", `slice.output.ring == true`, WO-883):
  the canvas is published as shm ring `visuals` and played through looks (`shm://visuals` on a look layer). "Send to
  screen" stays off. (Screenshot 13.11 00:24.)
- Sources ▸ Live in the Godot client: `features/live/live_sources_panel.gd` + `shm_sources_model.gd`. The panel polls
  `GET /api/shm/sources` every 3 s (server `routes-shm-sources.js` lists every live ring in /dev/shm) and each shm row drags
  `{type: "shm", value: "shm://<name>", …}` onto a look. The server plays it as `PLAY <ch>-<layer> SHM NAME <name>`.
- Caspar's shm producer (`~/caspar-build/src-v2/src/modules/shm/producer/shm_producer.cpp` header) re-opens a ring about twice
  a second, so a look may reference a ring before it exists, and it **holds the last frame** when the writer stops.
- Visuals engine: `visuals_deck.gd` renders every layer in its own transparent SubViewport (`slots[i].vp`) and draws it into
  the composite `out` (black `_back` at child 0) through a TextureRect with the layer's blend material and fade weight
  (`slots[i].rect`). Removed layers fade out in `leaving` at their old stack position `at`. `visuals_mixer.gd` mixes both
  A/B decks' `out` into `out_vp` (crossfader `x`, master, blackout, strobe). `visuals_tab.gd` `_sync_ring()` publishes
  `mixer.out_vp` as ring `ring_name` (`visuals`, `--visuals-ring` overrides) through `features/shm_out/viewport_publisher.gd`.
- Pads (APC, WO-1047) change what plays on a given layer slot. So "layer 4" to the owner is a **stack position**, not a scene.

## Design (contract)

1. **Model** (`visuals_model.gd`): `slice.output.solo`, an Array of 1-based stack positions (unique, sorted, 1..L.MAX)
   that each get their own ring. Absent or empty = today's behaviour. It is saved with the slice (`project.visuals` is a
   client-owned slice) through the tab's normal store path (autosave + undo). Ring name: `M.solo_ring(ring_name, n)` =
   `"<ring_name>-L<n>"` (`visuals-L4`).
2. **Solo only while the canvas is a Live source** (`output.ring == true`). Otherwise every layer is in the composite, as now,
   and the stored list just waits. While on, a solo position is **removed from the composite**: it is drawn only into its
   own ring, so picking layer 4 never shows it twice.
3. **Deck:** one transparent composite SubViewport per active solo position (premultiplied alpha, no black back, no base
   tint). The slot at stack index i (and a `leaving` slot at position `at`) draws into `solo[i+1]` when that position is
   solo, else into `out`. Re-routing only reparents the draw rect: nothing restarts (same rule as WO-1049's `_route`; see
   `git show 0d41d941 -- godot/client/features/visuals/visuals_deck.gd`). The base tint (`_backdrop`, WO-945 `set_base`) comes
   from the bottom **non-solo** layer. A solo composite renders only while something draws into it, then once more so it is
   transparent.
4. **Mixer:** per active position, `solo_out[n]` mixes the two decks' `solo[n]` with the same `x`, master, blackout and strobe,
   premultiplied (WO-1049's MIX2 shader, `git show 0d41d941 -- godot/client/features/visuals/visuals_mixer.gd`). Blackout
   is transparent. Created and freed as positions come and go. Resize follows `out_vp`.
5. **Rings:** one `viewport_publisher.gd` per active solo position, publishing `solo_out[n]` as `solo_ring(ring_name, n)` at
   the same fps as the main ring. Started and stopped from `_sync_ring()` (and wherever the solo list changes). When a
   position stops being solo, or Live source goes off, the ring keeps publishing for about 1 s so Caspar's held last frame
   is transparent, then stops. A position whose layer is gone (shorter stack) keeps its ring running, transparent, since a
   look may still play it.
6. **Sources ▸ Live:** directly under the `visuals` shm row (the row whose value is `shm://<ring_name>` of the local Visuals
   tab, found through group `visuals_canvas`), while that tab's Live source is on, add an indented child row per layer
   position of the bank on air (A/B: the crossfader's side, else `slice.layers`), **top layer first**, like the Visuals
   layer list. Label `L<n> · <L.describe(layer)>`, muted when the layer is hidden. Each row drags
   `{type: "shm", value: "shm://<solo ring>", label: "Visuals L<n>", routeType: "shm"}`, the same shape as a ring row, so
   every existing drop target (look editor compose frame, look layers) takes it unchanged. **Starting a drag makes the
   position solo** (the ring starts while the drag is still in flight). Each child row has a small toggle showing solo
   on/off. Clicking it turns solo off, and the layer goes back into the composite. Server-listed rows named
   `<ring_name>-L<n>` are hidden from the top level, because they are these children. Rows refresh with the 3 s poll and
   when the Visuals stack or solo list changes.
7. **Visuals layer list** (`visuals_layer_list.gd`): a small muted `L<n>` badge on a layer whose position is solo, so the
   Visuals tab shows why a layer is missing from the main picture. Nothing else changes there.
8. Not in scope: Send mode (an un-sent canvas only); no server change is expected (`/api/shm/sources` already lists the rings).
   GPU: each solo position costs one more canvas-size readback (3072×1024 here), only while solo + Live source.

## What was done

(to fill)

## What was verified

(to fill)
