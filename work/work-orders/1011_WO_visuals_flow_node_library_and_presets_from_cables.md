# WO-1011 — Visuals Flow builder: ~40 node types and a preset library, the op logic based on cables.gl (MIT)
**Area:** godot-client, audio
**Status: DONE (09.11, Godot suite 26469/0 + live on the box: presets, Add menu, ports, meters)**

Owner, 09.11: "start wos and work on expanding the node/flow visuals builder. i want way more presets and way more nodes.
find an open source project on github for flow programming visuals for vjing to base the logic from. dont forget to
attribute."

## Investigation

- **What the Flow view is today** (WO-863): `godot/client/features/visuals/visuals_flow.gd` is a `GraphEdit` with three
  node types: Audio bus → Shape (envelope follower) → Parameter. Each node has one input and one output.
  Links are `[from, to]`.
  `visuals_model.gd normalize_graph` / `evaluate` hard-code those three types. Evaluation pulls each Parameter's inputs
  recursively, memoised per frame, with a depth cut for loops. The result is `base + Σ inputs` per parameter
  (hue wraps, the rest clamp 0..1).
  There is exactly one preset, `default_graph()` (the starter graph).
- **Consumers.** `visuals_tab.gd` (the on-air bank, `_env` state, `_trace` meters) and `visuals_dj.gd` (the other bank's graph
  with its own `_env_other`, swapped with `duplicate(true)`, so the per-node state must stay plain Variant data). Looks,
  playlists and show control store and restore `slice.graph`. The probe orbit uses an empty graph. Tests:
  `tests/test_visuals_model.gd` (normalize, evaluate, shape envelope, loop cut, starter graph).
- **Reference project.** Candidates checked on GitHub (licence via the API, 09.11):
  - **cables.gl** (`cables-gl/cables`, `package.json` "license": "MIT"; the sibling repos carry the MIT `LICENCE`,
    "Copyright (c) 2019-present undefined development"). It is a node-based tool for real-time visuals, used for VJ sets,
    with 1820 ops. The non-GL families map one-to-one onto our float control graph: `Ops.Anim` (LFO_v4, Smooth, Spring,
    Timer), `Ops.Math` (MapRange, Ease, SchlickBias, Clamp, OneMinus, Pow, Modulo, Min/Max, Interpolate,
    SimpleMovingAverage, Speed), `Ops.Trigger` (TriggerCounterLoop, NthTrigger, ProbabilityTrigger, Threshold,
    TriggerRandomNumber), `Ops.Boolean` (MonoFlop, ToggleBool, And/Or), `Ops.Number` (SwitchNumber, GateNumber,
    DelayNumberSimple, FreezeNumber). **Chosen.**
  - ofxVisualProgramming / Mosaic (d3cod3; MIT / "other"): fewer ops, C++/openFrameworks objects. A good second
    reference, but cables' op set is larger and documented per port.
  - litegraph.js (MIT): a generic node-graph engine, not VJ-specific. PraxisLIVE: GPL-3.0. Hydra: AGPL and live-coded,
    not node-based. Vivid: source-available, not open source.
  - Within cables, `Ops.Math.PerlinNoise_v3` is derived from p5.js's noise (LGPL). It is **not** ported: our Noise node
    is our own smooth value noise, modelled on cables' LFO "smooth random" hash.
- **How the port works.** The logic (waveforms, port semantics, the Smooth/Spring update rules, edge-triggered counters
  and gates) is re-implemented in GDScript per frame with `dt`. No JavaScript is copied verbatim. The attribution goes in
  repo-root `THIRD_PARTY_NOTICES` (memory: `licenses/` is a generated symlink) and in each file's header.
- **Signals.** Everything stays a float. A "trigger" is a rising edge through 0.5, re-armed below 0.3, the same rule the
  stage already uses for `burst` (`visuals_stage.gd:4`). That lets every cables trigger op work on any audio pulse (kick,
  beat, drop, onset).
- **Ports.** Multi-input ops (Mix A/B/T, Switch, Sample & hold, Gate, Counter reset) need port indices: a link becomes
  `[from, to, port]`, with `[from, to]` still meaning port 0 (stored graphs, looks and playlists keep loading). Each
  input has a fallback when nothing is linked: a constant or the node's own property (e.g. Multiply's B = its "×"
  field).
- **Beat sync.** The LFO can run in beats. `buses_of` exposes the locked tempo as `_bpm` (not in the BUSES menu); without
  a lock it falls back to 120 BPM.

## What was done

- **`godot/client/features/visuals/flow_nodes.gd`** (new): the node library, 41 types in five categories:
  - Sources: bus, lfo, value, noise, random
  - Math: add, sub, mul, min, max, mix, map, clamp, invert, abs, pow, steps, wrap, curve, ease, compare
  - Animate: shape, smooth, spring, slew, delay, average, speed, peak
  - Triggers & logic: pulse, hold, counter, toggle, nth, chance, sample, gate, switch, and, or
  - Output: param

  Each type declares its input ports (each with a fallback constant or a property field used while nothing is linked)
  and its properties. The file also provides `make` / `clean` / `normalize`, which validate ports and drop bad,
  duplicate or out-of-range links. Links are `[from, to]` (port 0) or `[from, to, port]`, so old graphs load unchanged.
- **`flow_eval.gd`** (new): one frame of each node. The op logic follows cables.gl (the mapping is in the file header
  and in THIRD_PARTY_NOTICES), re-implemented per frame with `dt`:
  - The LFO has a beat clock, taken from the locked tempo (`_bpm` in `buses_of`, 120 when unlocked).
  - A trigger fires on a rising edge through 0.5 and re-arms below 0.3.
  - State is plain data, so `visuals_dj.gd` banks still `duplicate(true)`.
  - cables' PerlinNoise (p5.js, LGPL) was not ported; Noise is our own value noise.
- **`flow_presets.gd`** (new): 29 presets in six groups (Basics, Mood, Motion, Camera, Rhythm, Song). Layout is by
  column and row, stacked by node height so nothing overlaps. Preset 0 ("Starter") is the old default graph.
- **`visuals_model.gd`**: `evaluate` resolves inputs per port. A loop is one-frame feedback (the memo is pre-set to the
  last output), never a hang. NaN is guarded. The default graph is the Starter preset.
- **`visuals_flow.gd`**: changes to the Flow view itself:
  - right-click opens Add ▸ category ▸ type;
  - "Load preset ▾" (with "Empty graph") and "Add preset ▾" (placed below the graph), grouped, with descriptions as
    tooltips;
  - one row per input port, with the fallback field inline;
  - float fields don't snap (`step = 0`, arrows use the type's step).
- **`THIRD_PARTY_NOTICES`**: cables.gl block (MIT text, op → file mapping, PerlinNoise not ported).

Why cables.gl: it is MIT, it is a node-based VJ tool with a large, well-named op set for animation, triggers and
math, and its ops are small enough to read and re-derive. The alternatives were judged as follows:
- ofxVisualProgramming / Mosaic (fewer ops; C++ objects tied to openFrameworks) — not used.
- litegraph.js (MIT, but a generic graph engine with few VJ ops) — not used. PraxisLIVE (GPL-3.0) and Hydra (AGPL, live-coded) — not used.

## What was verified

- **Godot suite**: `run-client.sh --test` gives 26469 passed, 0 failed. The new `tests/test_flow_nodes.gd` covers:
  - every type is finite over a minute of input;
  - LFO waves, pulse width, the beat clock (with and without a tempo lock) and the seeded random wave;
  - math (map / clamp / mix / steps / curve / ease / compare / switch);
  - triggers (counter, nth, toggle, monoflop hold, pulse decay, edge-not-level, sample & hold, chance ≈ ½);
  - animate (delay 100 ms = 5 frames, average, spring overshoot and settle, slew, peak hold);
  - ports, link cleaning and feedback (an accumulator over 3 frames);
  - every preset is valid, drives a parameter and keeps params in 0..1;
  - Add preset gives unique ids placed below the graph;
  - no preset layout overlaps.
- **Live on the owner's client (:0, Visuals ▸ Flow, screenshots)**:
  - Load preset shows the six groups with tooltips.
  - "Quiet drift" loads with its Mix ports wired.
  - "Scene shuffle" shows the 5-port Switch fed by four Values, with no overlaps and live meters.
  - Right-click shows the five categories with submenus. Animate ▸ Spring added a Spring node at the click point.
  - The graph was then put back with Load preset ▸ Basics ▸ Starter.
