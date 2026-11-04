# WO-944 — Mapping node: "Place outputs" — drag each output, at its own resolution, onto the destination canvas

**Area:** godot-client, mapping
**Status: DONE (04.11.26 — Godot suite 25774/0 (+27), boot check OK; deployed to the second dev box's client and driven there: opens in Place outputs on the real node, drag / typed maths / Side by side round-trip to the server, generated Caspar config unchanged) — owner QA: try it; e2e scenario 16 updated but not run**

Owner 04.11 (second dev box): *"the mapping in the mapping node is a bit weird, especially when editing slices in the editor. should be able to easily place outputs on the canvas which is the screen destination that is input in the node. right now i have the desired outcome, yet im not sure how ive stumbled into it... try making it more straight thru"*.

Related: [WO-869](./869_WO_mapping_node_slices.md) (the slice editor this sits in front of), [WO-942](./942_WO_decklink_yuv_subregion_solid_green.md) (same rig, same session: on yuv SDI only src-x / src-y reach the card), [WO-485](./deprecated/485_WO_DECKLINK_TILES_OVERRUN_THE_CHANNEL_RASTER.md) §4 (owner's model: an SDI output is card-sized and "the video lands where it lands").

---

## 1. Investigation

**The owner's model** is a window per output: the destination is a canvas, each output is a frame of its own resolution (3840×2160 for a 2160p DeckLink) placed on it, and the output carries what is under the frame, 1:1; what hangs off the canvas is black. That is exactly what the server already does for a single 1:1 slice (`direct` plan → DeckLink `<subregion>` src-x/src-y, GPU head at x/y), so nothing server-side is missing.

**What the editor offered instead** (`godot/client/features/devices/slice_editor.gd`, WO-869): the Resolume model — cut source rects on the input canvas, then place each on an output canvas, one output at a time, with Transform / Warp / Flip / feather / opacity. Measured against the owner's model on the box's node (6144×1024 PGM → out 1 / out 2 → DeckLink 3 / 4, 2160p50):

- **Two canvases for one decision.** Where an output sits on the destination is the src rect on the left; the right canvas (placement in the SDI frame) does nothing on yuv SDI (WO-942: dest-x forced 0, width/height dropped).
- **Dragging cannot reach the owner's layout.** `slice_canvas_math.gd:32` `moved_src` clamps a src rect inside the input: a 3840-wide rect on a 6144 canvas stops at x = 2304, so out 2 at x = 3840 (what the owner has) is only reachable by typing it into the inspector's "Source on the input" fields. `CM.drawn` / `resized` clamp the same way, so rects were stored as 3840×1024 (the output clipped to the canvas), not the output's size.
- **Slices are not outputs.** The inspector lists "Output 1 → Output 1" rows (slice name → output) plus 15 fields per slice (src, dst, rotation, opacity, flips, 8 warp numbers, 4 feather) — for a DeckLink output only src x / y matter.
- **"Propose outputs from input"** (`mapping_graph.gd:75`) splits the input evenly and rewrites every output's mode to a custom slice size (3072×1024) — the source of the even split seen earlier in WO-942; not touched here (§4).

## 2. What was done

- `features/devices/output_place.gd` (new, pure): `frames(slices, outputs, input)` → one frame per output, kind `placed` (one slice that shows exactly the output's window: enabled, 1:1 at the output's top-left, untransformed, opaque, each axis the output's full size **or** the output clipped to the canvas — what the WO-869 editor stored), `unplaced` (no slice: black) or `free` (anything else); `placed(slices, out, x, y)` (the output's slices become one output-sized 1:1 slice, first id / name kept); `side_by_side` / `lined_up` (left to right at native width, free outputs skipped); `snapped` (canvas edges, other outputs' edges — abut or align — else the 8 px grid; Alt exact); `clamp_pos` (a frame always touches the canvas: top-left in [0, canvas)); `shows_text` ("canvas x 3840–6144, y 0–1024 · rest black").
- `features/devices/output_place_canvas.gd` (new, extends `slice_canvas_src.gd` for the live-picture lease): one canvas, the destination's picture, each output a frame at its resolution (fit includes frames hanging off the canvas; the fit is frozen during a drag), black where a frame is off the canvas, dashed = unplaced, hatched = free slices (not draggable here). Drag to move (no save while dragging, one on release), arrow keys nudge (Shift 8 px). Picking an output selects its slice so the Inspector follows.
- `features/devices/slice_editor.gd`: two views — **Place outputs** (new default whenever `all_placeable`) and **Free slices** (the WO-869 editor, unchanged). Place header: output name, X / Y (RULES.md math fields via `NumericField.math_line`), **Side by side**; under the canvas one line per output: size, backend, what part of the canvas it shows.
- `features/devices/slice_flow.gd`: `input_label` (the destination's name) for the canvas caption.
- `features/devices/slice_page_model.gd`: Inspector button "Edit slices" → **"Edit mapping"** (it opens both views); empty-node note updated. Doc comments in `mapping_controls.gd`, `devices_tab.gd`, `slice_inspector.gd` follow.
- `e2e/scenarios/16_wo869_mapping_slices.gd`: presses "Edit mapping", asserts a slice-less node opens in Place outputs, then presses "Free slices" before drawing (the rest of the scenario is the WO-869 editor, unchanged).
- Why on top of slices, not a new data shape: the planner, the generator (WO-942), live APPLY and every WO-869 smoke already understand a 1:1 slice; a "placement" field would be a second truth for the same thing. Free slices stay for GPU heads that need scale / warp / several slices per output.

## 3. What was verified

- **Godot suite** (`run_tests.gd`, the CI step): **25774 passed, 0 failed** (baseline on this box 25747/0; +27 in `tests/test_devices_output_place.gd`: frame kinds, the box's real 04.11 slices read as placements at 0 / 3840, a genuine crop stays free, placing keeps the slice id and replaces extra slices, side by side + free outputs untouched, snapping to edges / other outputs / 8 px grid / Alt, clamping, the "shows" line). `run-client.sh --check`: boot OK (it compiles the canvases, which unit runs cannot load — no `VideoSurfaces` autoload headless).
- **Box (highascg5867), deployed client, real node:**
  - "Edit mapping" opened in **Place outputs** (the node's 3840×1024 slices count as placements); canvas "PGM/PRV 1 · canvas 6144×1024", both 3840×2160 frames, live picture in the top 1024 px, black below / right; lines "Output 2 (3840×2160, SDI placement (1:1)): canvas x 3840–6144, y 0–1024 · rest black".
  - Mouse drag of Output 2 → saved slice `src.x 2900` (before the grid snap was added), header X / "shows" line / Inspector selection followed, Apply lit.
  - Typed `6144/2` + Enter in X → server slice `src.x 3072`.
  - **Side by side** → server slices `0 / 3840`, `3840×2160`, plans `direct`; `GET /api/caspar-config/generate` identical to the live `config/casparcg.config` (the switcher-proven WO-942 config) — the owner's layout is unchanged.
- **Not run:** e2e scenario 16 (needs the sandbox GUI run). **Owner QA:** use it; say whether Free slices should also be reachable for DeckLink-only nodes at all.

## 4. Left alone

- "Propose outputs from input" still splits evenly into custom modes (`mapping_graph.gd:75`); with Place outputs it is no longer the way to lay out SDI outputs. Candidate to remove or to make it "Side by side" — owner's call.
- Negative positions (an output starting left of / above the canvas) need dest-x / dest-y, which yuv SDI cannot do on the 2.5.1 binary (WO-942 §4); frames are clamped to touch the canvas.
