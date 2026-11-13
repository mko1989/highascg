# WO-1053 — Visuals route groups (several layers → one source) + picked layers back in the A/B PRV / PGM views

**Area:** godot-client
**Status: IN PROGRESS (13.11 — built; offline suite + compile boot green; on-air check pending)**

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

Built to the contract; deviations are marked **Deviation**. `visuals_tab.gd` is unchanged (still 498 lines).

- `godot/client/features/visuals/visuals_model.gd` — `groups_of(v)`: names must pass `group_name_ok` (slug `[a-z0-9-]`,
  1–24, not `L<digits>`; **Deviation (addition):** `l<digits>` is refused too, so no two rings differ only by case); invalid
  names are dropped, not slugified. Positions go through `solo_of`; a position belongs to one group only — the first group
  **by name** keeps it (the contract does not say which wins between two groups; name order is deterministic). Empty groups
  are dropped. `slice_of` removes grouped positions from `solo` (group wins) and stores `solo` / `groups` only when non-empty,
  so a solo-only show is byte-identical to WO-1051. `route_keys(output)` → `{position: key}` ascending (`L<n>` own, the group
  name otherwise); `own_key(n)`, `key_ring(ring, key)` (`solo_ring` now goes through it), `new_group_name(groups)` (`overlay`,
  then the first free `group-2`, `group-3`, …).
- `visuals_deck.gd` — `solo` is keyed by route key; `set_solo(route, keep)` takes `{position: key}` (an Array of positions =
  own keys, WO-1051's call shape) and `keep` keys; `routes_of` / `key_of` / `keys_of` statics. `_target(n)` looks up the key
  of position n; `_order()` was already per-composite in stack order, so a group's layers land in its composite bottom → top
  with no other change. Re-keying a layer only re-parents its draw rect (same slot / stage / viewport, no fade).
  `draws_solo(k)` takes a key or a position.
- `visuals_mixer.gd` — `solo_out` / `_solo_mats` keyed by route key; one MIX2 mix per key from both decks' `solo[key]`.
- `visuals_solo.gd` — pubs / drains per key; `routes()`, `groups()`, `route_of(n)`, `active()` (= routes while Live source),
  `set_route(n, key)` ("" main, `L<n>` own, a group name — a new valid name creates the group; writes `output.solo` /
  `output.groups` normalised through `slice_of`, then `tab._store()` + `sync()`), `new_group()`. `set_solo(n, on)` stays as
  WO-1051's API on top of `set_route`. `keep()` carries `groups` too. `previews()` (below). A key whose positions are all past
  the stack keeps its composite + ring (transparent), since the routes are stored, not derived from the stack.
- `visuals_route_preview.gd` (NEW, 59 lines) — `order(route)` (keys by lowest position, lowest first) and `show(view, texs)`:
  child TextureRects of the view (same stretch mode → same letterbox, full-rect anchors, `CanvasItemMaterial
  BLEND_MODE_PREMULT_ALPHA`, mouse ignored), placed under the view's PRV / PGM tag, rebuilt only when the texture list changes.
  The rule (on top, by lowest position, honest about Caspar) is in its header comment. No extra render pass: the textures are
  the key composites that already render for the rings.
- `visuals_solo.gd previews()` — PGM / canvas (`tab._canvas`, `out_vp`) gets the mixer's `solo_out[key]`; PRV (A/B only) gets
  the off-air deck's `solo[key]`. Called from `sync()` and from `visuals_dj.gd _show_x()` (+2 lines; every A/B frame, so a bank
  switch or take follows; cheap early-out when unchanged). Uses the routes of the last `sync()` (cached).
- `visuals_layer_list.gd` — the badge shows the key (`L4` / `overlay`); `set_solo` takes `{position: key}` (or an Array).
- `features/live/visuals_solo_rows.gd` — group rows first (sorted by name): `<name> · L4 L5`, value `shm://<ring>-<name>`, label
  `Visuals <name>`, `visualsGroup`; then the layer rows top first, each carrying `route`. A grouped layer row's value / label
  is its group's ring, so its payload equals the group row's. The solo toggle became a flat `MenuButton` (text `main` / `own` /
  the group) with radio items Main / Own (L<n>) / Group <name>… / New group… (<next name>). A layer row's drag reads the
  current route: in a group → the group's payload, nothing changes; else it goes Own (WO-1051). Group rows have no menu.
  `insert()` hides server rows `<ring>-L<n>`, `<ring>-<group>` and still-draining keys. `is_child`, `menu_items` helpers.
- `features/live/live_sources_panel.gd` — child detection via `VSolo.is_child` (group rows too); the view key uses `route`.
- `tests/test_visuals_solo_wo1051.gd` — only re-indexed where the generalisation requires it: composites / mixes are keyed
  `"L2"` instead of `2`, and the solo toggle assertions now read / drive the route menu (Main / Own). No assertion removed.
- **Deviation (naming):** the dictionaries keep their WO-1051 names (`deck.solo`, `mixer.solo_out`) though they are now per
  key, to keep the churn and the WO-1051 diff readable.
- Known limits: renaming / deleting a group is only by moving its layers out (empty groups drop); group rows are ordered by
  name, not by position; the preview shows picked layers on top of the whole main picture regardless of where they sit in the
  Visuals stack (deliberate — it matches how the looks stack them on air); a remote client that cannot publish still drops
  picked layers from its canvas while the slice says Live source (as WO-1051), but now at least previews them on top.

## What was verified

Offline only. **No on-air / Caspar check was done** (no GUI relaunch, no Caspar, no :0).

- New `godot/client/tests/test_visuals_route_groups_wo1053.gd` — 7 tests: model (group-name rules incl. `L4` / `l12` / 25
  chars / caps / spaces, exclusivity first-by-name, empty and junk groups dropped, group wins over solo, no `groups` / `solo`
  key when empty, a solo-only show unchanged, `route_keys`, `key_ring`, `new_group_name` overlay → group-2 → group-3, `keep`
  carries groups); deck (a group's two layers in one composite in stack order, own + group side by side, group → own and own →
  group keep the same stage / viewport with no fade, a group past the stack = empty `UPDATE_ONCE` composite, keep while
  draining); mixer (one MIX2 mix per key on both decks' composite, shared crossfader, drain keep, freed); rings with a stub
  publisher (`visuals-overlay` on `solo_out["overlay"]` at 25 fps, joining a group starts no ring, Own gets `visuals-L1`, a
  foreign own key / bad name ignored, an emptied group drops and its ring closes with drain 0, a group past the stack runs,
  Live source off stops all and keeps the routes); the drain in the tree (0.1 s: group ring still publishing with its layers
  already back in the canvas, the group back within the window keeps the same ring, then closed and freed); Sources ▸ Live
  on a real Visuals tab (menu items Main / Own (L4) / New group… (overlay), New group → `overlay` + its ring, L5 joins via
  "Group overlay" with no new ring, group row first then layers top first with L4 / L5 carrying the group ring, server
  `visuals-overlay` hidden while `visuals-overlayx` stays, payloads equal the ring-row drag payload, a group row has no menu,
  a grouped layer row's drag returns the group ring and leaves `slice.output` and the publishers untouched, a main row's
  drag goes Own with `visuals-L2`, the next New group is `group-2`, groups listed by name, layer-list badges `overlay` / `L2` /
  `group-2`); previews (`order` by lowest position; PGM overlays = `solo_out["L2"]` then `solo_out["overlay"]`, under the tag,
  premultiplied, same stretch, mouse ignored, not rebuilt when unchanged; A/B PRV overlays = the off-air deck's `solo[key]`;
  a key gone removes its overlay; Live source off clears both views).
- Full suite: `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --test` → `[tests] 28293 passed, 0 failed` (first run).
- Compile boot: `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --check` → `[check] boot OK (no script errors)`.
- `node tools/ci/check-max-file-lines.js` → `Files over 500 lines: 0`.
- Smokes that read touched files (`rg` over tools/smoke: only `smoke-wo908-visuals-ab-banks` reads visuals_mixer / visuals_tab;
  wo919 reads visuals_tab): `node --test tools/smoke/smoke-wo908-visuals-ab-banks.test.js
  tools/smoke/smoke-wo919-sweep-followups.test.js` → 15/15 pass; plus the other visuals smokes (wo879, wo909, wo1000) → 15/15.
- `node tools/wo/build-index.js && node tools/wo/check-wos.js` → `[wo-index] wrote INDEX.md (1012 WOs)`, `[check-wos] OK`.
- **Still open (on air, after a GUI relaunch):** Live source on; L4 → New group (overlay), L5 → Group overlay; drag the
  `overlay · L4 L5` row onto a look layer on the overlay screen → `PLAY … SHM NAME visuals-overlay` shows L4 + L5 together,
  transparent, in stack order, and `visuals` no longer has them; L4 / L5 do not restart while being grouped; one extra
  readback instead of two (GPU probe); PGM canvas and A/B PRV show the picked layers on top; emptying the group clears the
  look layer after ~1 s; WO-1051 per-layer `L<n>` picks unchanged.
