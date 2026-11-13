# WO-1053 — Visuals route groups (several layers → one source) + picked layers back in the A/B PRV / PGM views

**Area:** godot-client
**Status: IN PROGRESS (13.11 — design contract; build delegated)**

Owner, 13.11, after WO-1051 (per-layer Live sources): *"how can we still get the ab preview and route layers into bg overlay
screens?"*. Offered: overlay groups (L4 + L5 → one `visuals-overlay` source) and a preview fix. Owner: *"yes make route groups"*.
Both are in scope.

## Investigation

- WO-1051 (`features/visuals/visuals_solo.gd`, `features/live/visuals_solo_rows.gd`, deck/mixer `set_solo`) gives each picked
  stack position its own transparent composite and ring `<ring>-L<n>`. That is 1 readback and 1 look layer per layer. Putting
  L4 + L5 on the overlay screen means 2 sources, 2 look layers and 2× the GPU readback.
- A picked layer leaves the deck's `out` and the mixer's `out_vp`, so the Visuals tab's PRV view (the off-air bank's deck
  `out`) and PGM / canvas view (`out_vp`) no longer show it (WO-1051 "Known limits").

## Design (contract)

1. **Route keys.** Generalise WO-1051's per-position composites to per-**key** composites. A picked position has a key: its own
   `"L<n>"` (WO-1051, unchanged), or a **group name**. Every key has one transparent composite per deck, one premultiplied
   mix in the mixer and one ring `<ring>-<key>`. A key's layers draw into its composite **in stack order**. So `visuals-L4`
   stays as it is and `visuals-overlay` is the new kind. Nothing restarts when a layer changes key: only its draw rect moves,
   as in WO-1051.
2. **Model** (`visuals_model.gd`): keep `output.solo` (positions with their own ring) and add
   `output.groups: {<name>: [positions]}`, saved only when non-empty. A position is in at most one of: main, solo, one group.
   Normalising enforces that (the group wins over solo; empty groups are dropped). Group names are slugs `[a-z0-9-]`, 1–24
   characters, and never `L<digits>`. `M.route_keys(output)` returns `{position: key}`, and the ring is `<ring>-<key>`.
   Back-compat: a show with only `solo` behaves exactly as WO-1051.
3. **Groups are active only while Live source is on**, like solo. The drain-before-close (`drain_s`) and the "position past the
   stack keeps its ring, transparent" rules apply per key.
4. **Sources ▸ Live** (`visuals_solo_rows.gd`): under `visuals`, **group rows first**. Each shows `<name> · L4 L5` and drags
   `shm://<ring>-<name>`, label `Visuals <name>`. Then the layer rows as now. Each layer row's single "solo" toggle becomes a
   small route menu: **Main** / **Own** (`L<n>`) / one entry per existing group / **New group…**. The first new group is
   named `overlay`, later ones `group-2`, `group-3` and so on. Renaming is out of scope. Dragging a layer row still makes it
   **Own** (WO-1051 behaviour) **unless it is in a group**: then the drag carries the group's ring and changes nothing, so a
   layer is never pulled out of its group by a drag. Server rows matching `<ring>-<key>` stay hidden at the top level.
5. **Preview fix:** the Visuals tab's PRV view (the off-air deck's `out`) and PGM / canvas view (`out_vp`) draw that bank's or
   mix's route-key composites **on top** of the main picture. They are ordered by each key's lowest stack position, using
   TextureRects with premultiplied blending (`CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA` or the MIX2 approach) and **no
   extra render pass**. This matches on air when looks stack the picked sources over `visuals`. Write that rule in the code
   comment. A picked layer that sits under main layers in the Visuals stack therefore previews on top, which is honest about
   Caspar.
6. **Visuals layer list badge:** shows the key (`L4` or `overlay`).
7. GPU: one canvas-size readback per active key, so grouping L4 + L5 halves the cost.

## What was done

(to fill)

## What was verified

(to fill)
