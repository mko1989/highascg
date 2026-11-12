# WO-1051 — Visuals layers as their own sources: pick a layer in Sources ▸ Live, stack it on look layers

**Area:** godot-client, engine
**Status: IN PROGRESS (13.11 — built; offline suite + compile boot green; on-air check pending)**

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

Built to the contract; deviations are marked **Deviation**.

- `godot/client/features/visuals/visuals_model.gd` — `solo_of(v)`: unique, sorted, whole numbers 1..`Layers.MAX`, junk dropped;
  `solo_ring(ring, n)` = `<ring>-L<n>`. `slice_of` stores `output.solo` **only when non-empty**, so an older show (and the
  exact-dict test of `output` in test_visuals_model.gd) stays byte-identical; empty = today's behaviour.
- `visuals_deck.gd` — `solo` {position → transparent SubViewport, no `_back`}, `set_solo(route, keep = [])`. `_order()` now
  places every draw rect by stack position (a slot at index i → position i+1, a `leaving` one → `at`+1) into `solo[n]` when
  `n` is routed, else `out`, and orders each composite separately (out after the backdrop). Re-parenting only — slot, stage
  and viewport are reused, so a solo on / off never restarts or fades a layer (WO-1049's `_route` idea, done inside
  `_order` because the target depends on the position, which only `_order` knows). Positions, not scenes: a pad swap on slot
  4 puts the new layer into `solo[4]` and fades the old one out there too. `_base()` = bottom slot drawn into `out`: the tint
  backdrop and `set_base` follow the bottom non-solo layer. Solo composites render `UPDATE_ALWAYS` while running and drawn
  into, `UPDATE_ONCE` when empty (one transparent frame), disabled when asleep with content. `draws_solo(n)`, `gpu_ms` and
  `resize` cover them. **Deviation (addition):** the `keep` list — a composite that stays (empty, transparent) while its
  ring drains, so the drain has something transparent to publish while the layer is already back in the canvas.
- `visuals_mixer.gd` — WO-1049's `MIX2` premultiplied shader (blackout / master 0 = transparent, strobe keeps coverage);
  `solo_out[n]` + `_solo_mats[n]` made and freed in `set_solo(route, keep)` (which also sets both decks), new mixes start at
  the current `x` / master / strobe; `_param()` sets a uniform on the canvas mix and every solo mix (x, master, strobe);
  `resize` follows `out_vp`; solo mixes render with the canvas (`running`).
- `visuals_solo.gd` (NEW, 143 lines; `visuals_tab.gd` was at 495) — a Node under the tab. `positions()` (stored), `active()`
  (= positions only while `output.ring`), `set_solo(n, on)` (slice.output.solo, removing the key when empty → `tab._store()`
  → autosave/undo, then `sync()`), `sync()` (mixer `set_solo(active, draining)`, one `viewport_publisher.gd` per active
  position publishing `solo_out[n]` as `solo_ring(ring_name, n)` at `tab._fps()`; a failed start leaves the reason in
  `note`), `_drain(n)` (publishes on for `drain_s` = 1 s, then stops + frees; solo again within the window cancels it and
  keeps the same ring), `air_layers()` (A/B: `slice.dj.other.layers` when the crossfader's side is the other bank, else
  `slice.layers`, as WO-1049), `keep(prev, o)` (the page's Output edit replaces `slice.output` wholesale — the list rides
  along) and the layer-list badges. `make_publisher` / `publish_check` / `drain_s` are settable for tests.
- `visuals_tab.gd` (+3 → 498) — `var solo`, `solo = …visuals_solo.gd.new(self)` after the publisher/ring name, `solo.sync()`
  in `_sync_ring()` (project load / undo / Live source toggle / Send), and `output_changed` stores `solo.keep(slice.output, o)`.
- `visuals_layer_list.gd` — a muted `L<n>` label per row, visible when that position is active solo (`set_solo(positions)`,
  called from `visuals_solo.gd`). Row shape key unchanged (no rebuild under a dragged fader).
- `features/live/visuals_solo_rows.gd` (NEW, 117 lines) — `insert(rows, tab)`: drops server rows matching `^shm://<ring>-L\d+$` and puts
  `children(tab)` right after the `shm://<ring>` row; children only while the tab is a Live source, top layer first,
  `{type: "shm", value: "shm://<ring>-L<n>", label: "Visuals L<n>", routeType: "shm", visualsSolo, text: "L<n> · <describe>",
  muted, solo}`. `payload()` = exactly the ring-row shape (equal to `live_sources_model.gd drag_payload` of the row).
  `row()` builds the indented row with a flat `solo` toggle (toggled → `tab.solo.set_solo(n, on)`) and a drag getter that
  solos the position before returning the payload. `signature(tab)` for cheap change detection.
- `features/live/live_sources_panel.gd` (+19) — `_rows()` goes through `VSolo.insert(…, _visuals())` (tab found by group
  `visuals_canvas`), the view key / builder handle child rows, a 0.5 s timer rebuilds when `VSolo.signature` changes (stack or
  solo edits, besides the 3 s shm poll), and `_rebuild` is skipped while a drag is in flight (a child drag start changes the
  rows; rebuilding would free the drag source mid-drag). **Deviation (small):** the toggle works both ways (on as well as
  off) — it is a toggle; a click on an off toggle solos the position without a drag. Child rows have no DeckLink drop
  forwarding (the top-level rows keep theirs).
- No server change: `/api/shm/sources` lists the `visuals-L<n>` rings like any writer; looks play them as `shm://…`.
- Known limits: the project slice is shared, so a client that cannot publish (remote, no libhshm_sink) still drops solo
  layers from its own canvas preview while the slice says Live source; a solo layer is not in the A/B PRV view either (that
  view shows the deck's `out`). Each solo position costs one canvas-size readback (3072×1024 here) only while solo + Live
  source (+ 1 s drain).

## What was verified

Offline only. **No on-air / Caspar check was done** (no GUI relaunch, no Caspar, no :0).

- New `godot/client/tests/test_visuals_solo_wo1051.gd` — 6 tests: model (normalising, ring names, no key when absent / empty,
  `keep`); deck (solo positions in their own transparent composites, others over the backdrop in order, solo off/on keeps the
  same stage + viewport with no fade, base tint = bottom non-solo, pad-swap at a solo position → new + fading-out layer both
  in `solo[1]`, a position past the stack = empty `UPDATE_ONCE` composite, `keep` routes nothing); mixer (`solo_out`
  transparent, premultiplied MIX2 on both decks' `solo[n]`, resize, master 0.5, blackout 0 on both, crossfader incl. a new
  mix, free / keep); rings with a stub publisher (no ring while Live source off, `visuals-L2` on `solo_out[2]` at 25 fps,
  no double start, a position past the stack runs, solo off → closed (drain 0) and back in the canvas, Live source off →
  all stop with the list kept, last one off removes the key, publish failure → `note`); the drain in the tree (0.1 s: ring
  still publishing while the layer is already back, solo again within the window → same ring, then closed and freed);
  Sources ▸ Live on a real Visuals tab (child rows top-first under `visuals`, server `visuals-L2` hidden while
  `visuals-L2x` / other rows stay, labels incl. a named shader, hidden layer muted, payload == ring-row drag payload, drag
  start solos 2 and starts `visuals-L2`, layer 2 left the canvas, `L2` badge, toggle off ends it and closes the ring, the
  page's Output edit keeps the list, no children when not a Live source, no tab → rows unchanged, A/B → the canvas bank).
- Full suite: `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --test` → `[tests] 28224 passed, 0 failed` (run twice;
  a first run had an unrelated timing flake in `test_pixelhue_programming_panel::test_live_geometry_coalesces`, green on both
  re-runs).
- Compile boot: `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --check` → `[check] boot OK (no script errors)`.
- `node tools/ci/check-max-file-lines.js` → `Files over 500 lines: 0`.
- Smokes that read touched files: `node --test tools/smoke/smoke-wo919-sweep-followups.test.js
  tools/smoke/smoke-wo908-visuals-ab-banks.test.js` → 15/15 pass.
- **Still open (on air, after a GUI relaunch):** Live source on, drag layer N from Sources ▸ Live ▸ visuals onto a look layer →
  `PLAY … SHM NAME visuals-LN` shows that layer alone over what is below (transparent), and the main `visuals` picture no
  longer has it; the layer does not restart; toggle off → it returns to `visuals` and the look layer goes clear after ~1 s;
  APC pad on that slot changes what the ring shows; blackout / master / crossfader on the solo rings.
