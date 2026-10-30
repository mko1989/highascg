# WO-843 — Sweep: Godot client bugs

**Status: OPEN (30.10)**
**Source:** code sweep 29.10 (REPORT §4f, §5 Godot client, §7c debounce-after-reassign / count+1 ids (Godot side)).

Items: 4f timeline splitter drag saves a stale ConfigFile and clobbers ui.cfg keys (haze, previs folds, API
password); media inspector re-saves trim on every blur and parses m:ss.FF as decimal seconds (WO-813 area);
countdown + lower-third sections POST the old layer's config to a newly selected layer; MIX + MERGE preset migrates to
"MIX+ ANIMATE" and becomes a CUT (web too, golden pins the wrong output); Previs Delete in Camera mode deletes the
selected stage object; pixel map makes a 1×1 region on a click at zoom ≥13×; `count + 1` id generation
(output_ports_model). Timeline snap off-by-one and vertical scroll are left to WO-837 phase 2 (same files).
