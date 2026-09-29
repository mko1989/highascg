# Work Order 573: DP-2 (Main/LED wall) ignores configured 5760x1728@50, stays at EDID 1080p60

**Status: IN PROGRESS — root-caused (twice; first diagnosis was incomplete), fix written to config, service restart owed to take effect live**

**Parent / context:** [80_WO_XRANDR_CUSTOM_MODE_FORCE_RESOLUTION.md](./80_WO_XRANDR_CUSTOM_MODE_FORCE_RESOLUTION.md)

## 1. Investigation

Owner report: `DP-2` stays at `1920x1080@60` (EDID preferred/current) despite `config/general.json`
and `config/screen_destinations.json` both specifying `5760x1728@50` for that output. Live `xrandr`
confirms `5760x1728 50.00` is a real, already-advertised mode on `DP-2` — it's just never selected:

```
DP-2 connected 1920x1080+0+0 ...
   1920x1080     60.00*+  60.00
   5760x1728     50.00
```

`~/.config/highascg/apply-layout.sh` (regenerated at every apply, last written 2026-09-16 20:11,
i.e. *after* the config edit at 11:09) proves the box itself computed the wrong mode — this is not
a stale-script issue:

```
xrandr --output DP-2 --mode 1920x1080 --rate 50 ...
```

**Config ground truth (correct on its own terms):**
- `general.json`: `screen_2_system_id: "DP-2"`, `screen_2_os_mode: "5760x1728"`, `screen_2_os_rate: 50`
- `screen_destinations.json`: destination `dst_mu36czpy_1` ("Main") — `videoMode: "custom"`,
  `width: 5760, height: 1728, fps: 50`, **`mainScreenIndex: 0`**
- `screen_destinations.json`: destination `dst_mu36dh5r_1` ("Kolko") — `width: 1920, height: 2304`,
  **`mainScreenIndex: 1`**
- `device_graph.json` (hardware truth, not touched): `gpu_p1` (physical port → `DP-2`/`DP-3` per
  `gpuPhysicalTopology`) has the only edge into "Main"; `gpu_p0` (→ `DP-0`/`DP-1`) has the only edge
  into "Kolko". This matches physically — DP-2's EDID lists `5760x1728`, the LED-wall-shaped mode.

**Root cause**, traced through the OS-layout pipeline live (`src/utils/os-layout-calculator-assign.js`
→ `os-layout-calculator-place.js`):

1. Both destinations are real device-graph edges (`graphHasDestinationGpuBinding = true`), so their
   GPU-port assignment's `n` (the 1-based "screen slot" used to key `general.json`'s `screen_N_*`
   settings) is derived from `boundDest.mainScreenIndex + 1` (`os-layout-calculator-assign.js:119`),
   **not** from which physical port the connector actually resolves to.
   - "Main" → `mainScreenIndex 0` → **n = 1**
   - "Kolko" → `mainScreenIndex 1` → **n = 2**
2. But `general.json`'s own `screen_N` numbering runs the other way round, matching
   `gpuPhysicalTopology`'s port order: `screen_1_system_id = DP-0` (Kolko's real port),
   `screen_2_system_id = DP-2` (Main's real port).
3. Because `assign.osMode` is deliberately blanked to `''` for any edge-derived screen binding
   (`os-layout-calculator-assign.js:185`, `osMode: inferredFromEdge ? '' : ...` — this exists so a
   stale flat `screen_N_os_mode` can't override a live graph binding), the actual resolution comes
   from `os-layout-calculator-place.js`'s custom-dims fallback: `getModeDimensions('custom', config, n)`
   → `config[`screen_${n}_custom_width/height`]`. **Also keyed by the same wrong `n`.**
   `screen_1_custom_width/height` are unset in `general.json`, so `getModeDimensions` falls back to
   its own default (`1920x1080`) — landing exactly on the width/height baked into the bogus
   `apply-layout.sh` line above. (`sysId` itself is unaffected by this and correctly resolves to
   `DP-2` — `pickGpuOutLayoutSysId(config, c, null)` trusts the device-graph edge directly, which is
   why the symptom is "wrong resolution on the right output" rather than "wrong output entirely".)
4. Turning on `screen_1_force_os_resolution` would make this **worse**, not better — the `forceOsRes`
   branch switches `sysId` resolution to the explicit `pickGpuOutLayoutSysId(config, c, n)` path,
   which for `n=1` means `screen_1_system_id` (`DP-0` — Kolko's real monitor). That would point
   Main's connector at Kolko's physical port.

Confirmed the same offset explains Kolko's *coincidentally* correct current width (1920x2304 is a
value that happens to live at both `general.json:screen_1_os_mode` and Kolko's own `width`/`height`
fields, so the bug is invisible on that side) and the operator monitor's x-offset
(`~/.config/highascg/apply-layout.sh` places `DP-7` at `x=3840` today — `1920`(Main, wrongly sized)
`+ 1920`(Kolko) — it should be at `x=7680` once Main is placed at its real `5760` width).

**This is a data mismatch, not a code defect**: `screen_destinations.json`'s `mainScreenIndex`
values were set backwards relative to `general.json`'s physical `screen_N` numbering (which follows
`gpuPhysicalTopology` slot order: slot 0 = `screen_1` = `DP-0`, slot 1 = `screen_2` = `DP-2`).
"Main index" is a plain user-editable field (Device View → destination inspector →
`client/components/device-view-destinations-inspector-form.js:160`), re-ranked densely by
`compactMainScreenIndices` (`src/config/screen-destinations.js`) — swapping which of the two
main-bus destinations holds `0` vs `1` is a supported, in-schema operation.

## 2. Fix, round 1 (incomplete) and round 2 (actual root cause)

**Round 1:** swapped `mainScreenIndex` between the two main-bus destinations —
`dst_mu36czpy_1` ("Main"): `0`→`1`; `dst_mu36dh5r_1` ("Kolko"): `1`→`0`. Applied live (owner
approved, on-air). Result: **DP-2/Main fixed** (now `5760x1728@50` current), but **DP-0/Kolko
regressed** to `1920x1080` (previously correct at `1920x2304`) — the bug just moved.

**Round 2 — actual root cause found by reproducing `calculateLayoutPositions` directly against the
live config** (`ConfigManager` + real `config/`, no code changes, see method in
[WO-564](./564_WO_PHANTOM_SCREEN_STEALS_OPERATOR_X_POSITION.md)):
`resolveScreenDimsFromTopology(config, screenIdx1)` (`src/utils/os-layout-calculator-helpers.js:15-32`)
filters ALL destinations down to "routable" (excludes only `multiview` and `stream` modes — **does
not exclude `operator_gui`**), then picks whichever routable destination has a matching
`mainScreenIndex`. `dst_operator_gui` has always carried `mainScreenIndex: 0` — same as whichever
real screen destination also happened to sit at index 0. Since `dst_operator_gui` is listed first
in `screen_destinations.json` and `Array.prototype.find` takes the first match when nothing has
`mode: 'pgm_prv'`, **operator_gui's own `1080p5000` / `1920x1080` silently wins the topology lookup
for index 0**, regardless of which real screen is there. This is why Main (originally index 0) was
wrong from the start, and why the round-1 swap simply relocated the same collision onto Kolko.

**Fix actually needed:** give `dst_operator_gui` a `mainScreenIndex` that cannot collide with either
real main-bus screen. `dst_operator_gui.mainScreenIndex`: `0` → `2`. (It doesn't need excluding in
code — `operator_gui`'s own OS placement never reads `mainScreenIndex`; it's placed via the
edge-derived `multiview`-style path in `os-layout-calculator-assign.js`, entirely independent of
this field. The field is otherwise vestigial except for this topology-lookup collision, so moving it
off `0`/`1` is a safe, in-schema, config-only fix — no code change required.)

Verified via direct repro (not live) after all three index changes:
```
screen_1: id=DP-0 mode=1920x2304   (Kolko, mainScreenIndex 0)
screen_2: id=DP-2 mode=5760x1728   (Main,  mainScreenIndex 1)
multiview_1: id=DP-7 mode=1920x1080 pos=7680,0   (Operator GUI, mainScreenIndex 2 — no longer read for this path, x-position unaffected by the value itself)
```

**On-air impact of applying this final state:** DP-0 needs a second modeset (currently live at
`1920x1080` from the round-1 partial fix, needs to go to `1920x2304`) in addition to DP-2's already-
applied `5760x1728`. Operator monitor stays at `x=7680` (unchanged from round 1). Expect another
brief blank/flicker, this time on DP-0/Kolko.

**Status right now on the box:** `config/screen_destinations.json` has all three corrected indices
written to disk. `highascg` has NOT yet been restarted with this second change — the round-1
restart already happened (DP-2 live-verified fixed at that point, DP-0 known-broken at that point).
**Next action: restart `highascg`** (`kill -TERM $(systemctl show -p MainPID --value highascg)`,
systemd restarts it) to pick up the operator_gui index fix, then re-verify both outputs.

## 3. Verification plan
- [x] `config/screen_destinations.json` shows all three corrected indices (Main=1, Kolko=0, Operator GUI=2).
- [x] Direct repro of `calculateLayoutPositions` against saved config confirms correct dims for both screens.
- [ ] Restart `highascg`, confirm `~/.config/highascg/apply-layout.sh` regenerates with
      `--output DP-0 ... --mode 1920x2304` AND `--output DP-2 ... --mode 5760x1728`.
- [ ] Live `xrandr`: `DP-0` current (`*`) is `1920x2304@50`, `DP-2` current is `5760x1728@50`.
- [ ] Operator monitor (`DP-7`) still correct at `x=7680`, no overlap.

## 4. Follow-up (21.09.2026) — closed the code-level hole behind the config-only fix

§2's round-2 fix moved `dst_operator_gui.mainScreenIndex` off 0/1, but left the actual defect in
place: `resolveScreenDimsFromTopology` (`src/utils/os-layout-calculator-helpers.js`) filtered
destinations with an inline `mode !== 'multiview' && mode !== 'stream'` check that did **not**
exclude `operator_gui`. `isMainBusDestinationMode` (`src/config/screen-destinations.js`) already
existed as the canonical version of this exact filter — its own doc comment says outright that
`multiview`/`stream`/`operator_gui` carry `mainScreenIndex` only as a placement hint, never a
main-bus claim — but this call site had its own out-of-sync copy missing the third exclusion. Any
future edit that put `dst_operator_gui.mainScreenIndex` back at 0 or 1 (a factory reset, a fresh
seed, or an operator dragging it in the destination inspector without knowing the significance)
would silently reproduce this exact bug.

**Fix:** `resolveScreenDimsFromTopology` now filters with `isMainBusDestinationMode` instead of its
own copy. **Verified:** new `tools/smoke/smoke-wo573-operator-gui-topology-dims-collision.test.js`
reproduces the exact collision from §1 (operator_gui and a real screen both at `mainScreenIndex 0`,
in both list orders) and confirms the real screen's dims win regardless of `operator_gui`'s index;
also pins the current live-config shape (operator_gui at 2) and confirms
`resolveMultiviewDimsFromTopology` was never affected. Full offline suite 2439/2441 (2 pre-existing
environment-gated skips). No live/on-air action — this is a static-analysis code fix, independent
of the restart still owed from §2.

## 5. Second follow-up (21.09.2026) — operator_gui and multiview now bind independently

Owner, after §4 landed: *"the multiview + operator gui needs a fix. they can both be enabled when
needed so they need separate binding."* — flagging that §4's fix (real screens vs. operator_gui)
left a sibling bug untouched: operator_gui and a genuine `multiview`-mode destination were STILL
sharing one binding.

**The bug:** `os-layout-calculator-assign.js` classified both `dMode === 'multiview'` and
`dMode === 'operator_gui'` as `edgeDerivedMode = 'multiview'`, producing the same hardcoded
`binding = { type: 'multiview', index: 1 }` for either one. `os-layout-calculator-place.js` then
placed both into the exact same `results.multiview[1]` slot. A box with operator_gui cabled to one
physical GPU output AND a real multiview destination cabled to a different one — both fully valid,
simultaneously live configurations — had them silently overwrite each other: whichever connector
`graphGpuConnectors.forEach` visited last won the slot, and the other destination's head never
reached xrandr-apply, xrandr-layout-verify, or `resolveLayoutRectForOperatorPort` at all. Confirmed
via the live-box raw EDID work in §1's DP-6/DP-7 investigation (this box's Main destination sits on
a PixelHue P80, unrelated to this bug, but tracing that pipeline is what surfaced this one).

**Fix:** operator_gui now gets its own binding type (`'operator_gui'`) and its own collection/results
bucket, parallel to but independent of multiview's, through the whole pipeline:
- `os-layout-calculator-assign.js` — split the `dMode === 'multiview' || dMode === 'operator_gui'`
  branch in two; added `operatorGuiAssignments` (parallel to `mvAssignments`) with its own config-key
  namespace (`operator_gui_os_*`, not `multiview_os_*` — no cross-talk with a real multiview's OS
  settings).
- `os-layout-calculator-place.js` — new `results.operatorGui` bucket, placed the same way as
  `results.multiview`; added `resolveOperatorGuiDimsFromTopology` (mirrors
  `resolveMultiviewDimsFromTopology`, filtering `mode === 'operator_gui'` instead).
- `os-layout-calculator-offset.js`, `-helpers.js` (`mergeMappingGpuOutputsWithScreens`),
  `os-layout-calculator.js` (plan logging), `os-config-xrandr-apply.js` (the actual live xrandr-apply
  loop), `xrandr-layout-verify.js`, `api/settings-os.js` — each extended to also walk
  `results.operatorGui`/`layout.operatorGui`, so operator_gui's head keeps getting offset-adjusted,
  applied, verified, and logged exactly as before, just from its own bucket instead of multiview's.
- `x-display-session-layout-resolve.js` — `resolveLayoutRectForOperatorPort`'s
  `mode === 'multiview' || mode === 'operator_gui'` branch split in two (operator_gui now resolves
  through `plan.operatorGui[1]`); `findLayoutRectBySysId` gained a matching `operatorGui` loop.
  `interactive` for an operator_gui rect is now `false` (it is a Firefox kiosk page, not an
  AMCP-clickable Caspar screen/multiview consumer — the flag has nothing to opt into there; this
  matches what it evaluated to before in practice on any box without an explicit `multiview_interactive`
  override, since the old code fell through to `multiviewInteractiveEnabled`).
- Six other call sites that read `layout.multiview[1]` (`host-operator-fullscreen.js`,
  `build-caspar-generator-layout-sync.js`, `x-display-session-layout.js` ×2,
  `x-display-session-layout-resolve.js` ×2) were already correctly asking specifically about the
  genuine multiview channel (checked via `multiviewScreenConsumerEnabled`/`multiviewInteractiveEnabled`)
  — they needed no code change and are simply correct now that operator_gui can no longer occupy
  that slot.

**Verified:**
- `tools/smoke/smoke-wo573-operator-gui-multiview-separate-binding.test.js` (new) — cables a genuine
  multiview destination and an operator_gui destination to two different GPU ports and asserts both
  survive `calculateLayoutPositions` with distinct positions/sizes, both appear in
  `plannedHeadsFromLayout` (the xrandr-apply/verify input), and `resolveLayoutRectForOperatorPort`
  resolves the operator_gui port to its own rect. Live layout-plan log from the test run:
  `screen_1: DP-0 pos=0,0` / `multiview_1: DP-6 pos=1920,0` / `operator_gui_1: DP-5 pos=5760,0` —
  three independent heads, none colliding.
- `tools/smoke/smoke-wo243-operator-gui-guards.test.js` — its two grep-guards asserted the OLD
  shared-binding source text as the intended behavior; updated to assert the new independent
  classification instead (and added a `doesNotMatch` against the old conflated pattern, so a
  regression back to shared binding fails loudly).
- `tools/smoke/smoke-config-generator-routing-2.js` — one test cabled a **nonexistent** destination
  id to `gpu_p2` as its "multiview" edge; that edge was always dead (`Array.prototype.find` matched
  the fixture's real, pre-existing `operator_gui → gpu_p2` edge first), so the test was actually
  exercising operator_gui's head under the old shared-binding bug and mislabeling it "multiview x
  when GPU cabled". Repointed it at the fixture's genuine multiview destination on an unused port
  (`gpu_p3`) so it tests what its name says.
- Full offline suite: 2442/2444 pass (2 pre-existing environment-gated skips unrelated to this
  change). No live/on-air action taken.

## Work Log
- 2026-09-16, Claude (Sonnet 5): investigation only, per owner report of DP-2 stuck at 1080p60.
  Root-caused via static trace of `os-layout-calculator-assign.js` / `-place.js` plus the live
  `apply-layout.sh` artifact (no code changes made). Fix identified but withheld pending owner
  go-ahead given on-air impact.
- 2026-09-21, Claude (Sonnet 5): closed the code-level hole (§4) behind the round-2 config fix, per
  owner's ask to make GPU/xrandr config generation "as robust as possible" — found by re-deriving
  §2's root cause while investigating an unrelated DP-6/DP-7 native-mode report.
