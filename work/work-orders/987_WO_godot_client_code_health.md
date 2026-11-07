# WO-987 — Code-health sweep of the Godot client
**Area:** godot-client
**Status: DONE (07.11.26, headless suite 26182 passed / 0 failed; original-code regression 100 failed; max-lines passed)**

## Investigation

Scope: signals/subscriptions, refresh/rebuild churn, retained caches and node ownership, then visible-frame allocations.
Read CLAUDE.md, RULES.md and searched INDEX before diagnosis. Related: WO-798 (CPU attribution, deliberately not
repeated), WO-860 (editor thumbnail refresh), WO-885 (Visuals thumbnails), WO-971 (deck scroll preservation).
This is a ranked, targeted source sweep, not proof that every client script is leak-free. No windowed client,
server, Caspar, Godot --check, XR, or production project changes were used.

### 1. Unbounded thumbnail retention across a long session — larger follow-up, not changed

- `godot/client/features/live/look_thumb.gd:10,50`: static `_cache` retains every fetched URL, including failed/null
  results; there is no erase, cap or project-change reset in this script. Loading other projects does not destroy
  a static dictionary. Trigger: first encounter of each distinct media URL during deck/editor use, user driven,
  not OSC. Concrete input: visit 1,000 distinct 960x540 media thumbnails over several projects. All 1,000 URL entries
  remain; 960x540x4x1,000 is about 1.93 GiB of RGBA pixel storage if each returned image has that size/format.
  This is a size calculation, NOT measured RSS or a claim about actual server image dimensions/GPU format.
- `godot/client/features/visuals/visuals_thumbs.gd:18,21,48,77` and `:120` (save_png): successful textures, failed keys
  and disk PNGs have no pruning path. `features/visuals/visuals_catalog.gd:62` includes an updatedAt hash in the key.
  Concrete input: edit/reopen one shader 1,000 times with distinct updatedAt values and request each new preview;
  successful old versions remain both in `_cache` and under `user://visual_thumbs/v1`. Trigger: library browsing /
  shader revisions, no fixed rate, not each frame. At 192x108 RGB8, 1,000 raw images represent 59.3 MiB before
  texture/driver overhead; PNG disk size depends on content. `clear_queue()` at :61 clears only pending jobs.
- Impact: cumulative memory/disk retention over days with changing media/libraries; static lifetime in LookThumb
  is broader than the Visuals renderer node's lifetime. Source evidence is conclusive about absent eviction,
  but production growth rate and RSS have NOT been measured.
- Fix proposal: project-aware invalidation plus bounded memory LRU and disk age/size budget. Keep current visible
  textures referenced by their cards; add generation handling for outstanding fetches. Do not simply clear caches
  every redraw: that would cause request/render churn and alter visible loading behaviour. Requires UI/GPU QA.

### 2. Duplicate/dead waiters during a thumbnail request — reproduced and fixed

- Original `godot/client/features/live/look_thumb.gd:40-43` unconditionally appended the card's `queue_redraw`
  Callable whenever `_waiters[path]` existed. `refresh()` (:31-36) calls `_fetch` for every layer using a missing URL;
  the editor backdrop calls refresh on edits (`features/live/look_editor_backdrop.gd:55-57`).
- Trigger: repeated edits or rebuilt deck cards while HTTP is outstanding, plus repeated layers with the same media.
  Rate follows edits/rebuilds, not the OSC stream. Retention ends when the request completes; this is a bounded-by-
  request-lifetime amplification, NOT an endless leak after successful completion.
- Executed reproduction: two cards, two layers sharing a pending source, 100 refreshes each. Original: **400 waiters**;
  fixed: **2**, both live callbacks retained. Replacing/freeing a waiting card 100 times: original **100 retained
  callbacks** (99 dead); fixed **1** on each registration. The test asserts correct bounds and fails on old code.
- Impact: redundant completion calls, temporary callable growth and stale receivers while the six-slot API pool /
  remote HTTP is slow. queue_redraw itself coalesces redraw requests, so this is not evidence of 400 rendered frames.
- Fix: filter invalid Callables and append only when the live callback is absent. Completion's existing validity
  guard remains. Deduplication preserves the intended single repaint per live card and existing HTTP/cache policy.

### 3. Whole-deck rebuilds for scene changes — confirmed churn path, not changed

- `godot/client/features/live/deck_view.gd:44-59,63`: project_changed or any `scene*` Store path marks the whole deck
  dirty; the next process tick calls rebuild. `features/live/deck_scroll.gd:13-18` queues every column for deletion;
  deck_view :183-184 creates/setup()s fresh thumbnails for the replacement cards.
- Concrete input: change only `scene.live` on a deck with 100 cards: the dirty path does not compare card identity,
  so all 100 cards are replaced, not only their active styling. Trigger: takes, PRV selection, edits and remote
  project sync; multiple updates coalesce within one frame. No direct OSC hook found here; do not rank as 20 Hz.
- Impact: allocation/layout bursts proportional to all cards; amplifies finding 2 while HTTP is pending. No wall-
  clock timing or live child-count measurement performed. WO-971 already documents the scroll side effect, so this
  is a follow-up to that known architecture, not a newly discovered scroll regression.
- Fix proposal: separate active-bus highlighting from structural changes; reconcile cards by screen/look ID while
  preserving drag payloads, focus, ordering, drop targets and scroll restoration. Needs glass QA, left unbuilt.

### 4. Custom WS handler lifecycle — conditional risk, not a demonstrated live leak

- `godot/client/core/ws.gd:43-46` stores handlers in `_handlers[type]` arrays; :136-138 directly calls every Callable.
  This is a custom subscription registry, so native signal auto-disconnection does not remove its array entries.
  Subscribers include `features/timeline/timeline_transport.gd:76-77` and timeline_tab.gd:86.
- Concrete failing lifecycle to test in follow-up: register a bound Node method with on(), free its receiver, then
  dispatch that type. The array retains an invalid Callable and dispatch has no is_valid check. Recreate that
  receiver N times and the array grows N entries. Trigger: receiver destruction/recreation, then matching packets;
  timeline ticks can be frequent while running, but routine desktop tab switching alone is NOT shown to recreate it.
- Impact: stale registry entries and potential invalid-call errors if that lifecycle occurs. Actual supported UI
  recreation path, lambda owner semantics and error frequency were NOT runtime-tested; do not call this a proven
  days-long leak. Proposed fix: explicit owner-bound unsubscribe plus invalid-handler pruning; test freed receivers
  and duplicate registration policy before changing the registry. No WS code changed.

### Checks that did not justify changes

- `features/previs/tracking/auto_overlay.gd:109-115`: signature gates row rebuilds despite <=5 Hz tracking updates;
  :132-136 removes old children and queues them for freeing. Not an unconditional tracking-rate rebuild.
- `features/live/live_sources_panel.gd:114-121`: presentation signature skips unchanged lists, including its 3-second
  SHM polling path (:78-85). Reload clears its thumbnail cache (:101). No equivalent static-cache finding here.
- `core/project_undo_model.gd:5,73-76`: history is capped at 100 steps and redo is cleared on edits.
- `core/api.gd:19,27-34`: HTTPRequest nodes are a fixed six-node owned pool. Representative Timer allocations in
  API consumers/overlays are parented during setup; no new proven orphan-node leak from this sweep.
- LookThumb.setup :25 adds a new lambda on every setup call, but inspected callers instantiate once and call refresh
  thereafter. No proven repeated-setup production path; no speculative guard added.
- Source inventory found 80 process/draw/physics method declarations and 67 Timer/HTTPRequest/tween allocation
  matches (includes tests). These are search counts, not a claim of exhaustive semantic review. WO-798 already
  measured the relevant frame costs; no new behaviour-preserving per-frame allocation fix was justified.

## What was done

- `godot/client/features/live/look_thumb.gd`: deduplicate and prune invalid in-flight redraw waiters. Replaced the
  complete file atomically; no incomplete script was left for the owner's next launch.
- `godot/client/tests/test_987_thumbnail_waiters.gd`: two runtime regressions, 103 assertions. Loads the production
  thumbnail script with only `await Api.get_bytes(path)` replaced by a no-network result, since the unit SceneTree
  has no Api autoload. Seeds an already-pending URL to exercise the production refresh/join path; does not fetch,
  decode images or prove the HTTP completion path. Every created card is freed and seeded waiter keys removed.
- This WO records the diagnosis, limits and larger proposals. INDEX and curated CI lists intentionally untouched
  under the delegate work order; coordinator owns registration and commit. No new node:test file was needed.

## What was VERIFIED

Exact commands (run from repository root):

- `GODOT=$HOME/.local/opt/godot/godot godot/client/run-client.sh --test > /tmp/wo987-before.log 2>&1`
  Initial harness attempt: exit 134, no completed assertion summary. Directly preloading LookThumb failed to resolve
  Api, then Godot crashed. Retrying with the XDG prefixes also exited 134 with the same compilation problem.
  This was a harness error, not a proven application defect. Switched to the transport-only substitution above.
- `mkdir -p /tmp/wo987-gdc /tmp/wo987-gdk`
- `XDG_CONFIG_HOME=/tmp/wo987-gdc XDG_CACHE_HOME=/tmp/wo987-gdk GODOT=$HOME/.local/opt/godot/godot godot/client/run-client.sh --test > /tmp/wo987-before.log 2>&1`
  With final tests and ORIGINAL production source: exit 1; **26082 passed, 100 failed**. 100 failures are the
  waiter-bound regressions (one 400-vs-2 failure; 99 freed-waiter growth failures). No script compilation failures.
- `XDG_CONFIG_HOME=/tmp/wo987-gdc XDG_CACHE_HOME=/tmp/wo987-gdk GODOT=$HOME/.local/opt/godot/godot godot/client/run-client.sh --test > /tmp/wo987-after.log 2>&1`
  With fix: exit 0; **26182 passed, 0 failed**. New suite contribution **103 passed / 0 failed**.
  Existing engine diagnostics include malformed JSON/PNG fixture errors, tests building nodes outside the tree,
  and `_sock == -1` in `_inet_open` adjacent to test_visuals_midi (`test_click_picks_the_target` /
  `test_lights_from_the_state`). The socket diagnostic has no assertion failure and is a sandbox limitation;
  MIDI/socket availability is not proven here and can be rerun outside by the coordinator.
- `npx eslint godot/client/features/live/look_thumb.gd godot/client/tests/test_987_thumbnail_waiters.gd`
  Exit 0; **0 errors, 2 warnings**: ESLint ignores both GDScript files (no matching configuration). This is NOT
  GDScript lint coverage. Godot compiles/runs the changed logic through the test's transport substitution.
- `node tools/ci/check-max-file-lines.js`: exit 0; **0 files over 500 lines**.
- `rg -n 'look_thumb|_waiters' tools/smoke`: no matches; no pinned source smoke needed repointing.

## Proposals (not built)

1. Add bounded thumbnail memory/disk retention with cache-hit/eviction tests and active-card visual QA (finding 1).
2. Split deck bus-state updates from card structure; measure 100/1,000-card take/reorder/edit cases (finding 3).
3. Exercise real subscriber destruction/recreation, then add WS owner lifetime handling if confirmed (finding 4).
4. Coordinator: register WO-987 in the index/queue as appropriate; no curated test registration needed for the
   auto-discovered Godot test file. Review and commit only the three files listed above.

Not proven: multi-day RSS/disk slope, rendered appearance, live HTTP completion, GPU behaviour, custom WS lifecycle,
real MIDI sockets, or production CPU improvement. No box interaction required; owner's GUI left as found.
