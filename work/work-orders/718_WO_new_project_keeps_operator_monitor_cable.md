# WO-718 — A New project comes up with the operator monitor cabled in Devices

**Status: IN PROGRESS (23.10.26). Code done and covered offline: the WO-718 smoke 5/5, plus new-project / WO-290 /
WO-638 65/65. NOT verified on the box: a live New project replaces the owner's current project, so that check is
owner QA (see below).**

Owner, 23.10: *"when a new/fresh project is started on a server with operator monitor chosen by the start gui here
it should be already connected to that output in devices view."*

## Investigation

- The boot prompt (WO-638 / WO-645) answers through `boot-screen-assignment.js` `resolve` →
  `operator-monitor-picker.js` `applyOperatorMonitorChoice`.
  - It sets `casparServer.screen_<port>_operator_monitor` (one-hot).
  - It then calls `wireOperatorGuiGraphEdge` to draw `dst_in_<operator dest>` → `gpu_p<port-1>`.
- **Gap A — New project.** `new-project.js` `createNewProject` applies the factory starter `hardwareConfig`.
  - Its graph is `{devices:[caspar_host], connectors:[], edges:[]}` (`factory-starter.js`, the same as
    `defaults-core.js`).
  - `applyHardwareConfigToCtx` replaces the live graph wholesale, which removes the operator cable.
  - The flag survives (the casparServer merge is defaults ← live ← project, and the starter has no such key). But
    the starter's `screen_N_always_on_top: true` / `interactive: false` reset the operator jack.
  - Nothing on this path read the boot answer.
- **Gap B — the boot answer itself.** `wireOperatorGuiGraphEdge` "never invents connectors" and returned unchanged
  when `dst_in_<dest>` was missing.
  - That is the normal state after a factory or New-project graph. The boot hardware sync
    (`device-graph-boot-sync.js`) adds only `gpu_out` / DeckLink rows.
  - Box evidence: `config/device_graph.json` = `gpu_p0..gpu_p3`, `edges: []`. The journal at 15:45:57 has
    `[Boot screens] operator = DP-5 (port 3, clicked) … nothing changed`.

## What was done

- `operator-monitor-picker.js` `wireOperatorGuiGraphEdge`: adds the destination's own `dst_in_<dest>` row when it
  is missing, plus the `destinations` device row. The shape is the same as `device-graph-suggest.js`.
  - The GPU jack is still never invented: with no `gpu_p<port-1>`, the graph stays untouched and the flag alone
    applies.
  - This fixes Gap B, and with it every caller (boot prompt, picker route).
- `new-project.js`: new `seedOperatorMonitorCable(hardwareConfig, liveCfg, persistence)`, run after the WO-579 /
  WO-684 carve-outs and before `applyHardwareConfigToCtx`.
  - Port: the live flag (the durable form of the boot answer). If there is none, this boot's `bootScreenAssignment`
    record (`bootId` must match: `boot-screen-assignment.js` now exports `bootId`). If neither exists, nothing
    changes, and a fresh box still gets the empty factory graph.
  - It copies the live `gpu_out` rows in (hardware, like the topology), then calls `applyOperatorMonitorChoice`.
    It also sets the WO-412 implied flags on that jack (`always_on_top: false`, `interactive: true`).
  - Both the live config and the saved Untitled project's `hardwareConfig` carry the cable.
- Tests:
  - New `tools/smoke/smoke-wo718-new-project-operator-cable.test.js` (curated list):
    - flag → cable + flags, live and in the project;
    - this boot's record → cable;
    - no choice, or a record from an earlier boot → empty graph as before;
    - flag on a jack the graph lacks → no cable, flag kept;
    - the boot answer on a graph without `dst_in` → cable.
  - `smoke-wo290-operator-monitor-picker.test.js`: the "missing connectors → untouched" case now means a missing GPU
    jack. A new case covers the added destination row, since WO-718 deliberately supersedes the old rule.

## What was VERIFIED

- Smokes: WO-718 5/5. Together with new-project, WO-290 and WO-638: 65/65. ESLint, Prettier and the 500-line check
  are clean.
- **Incident during verification (23.10 18:56):** I tried a realistic run of `createNewProject` against a scratch
  copy of `config/`, setting `HIGHASCG_PROJECTS_DIR` to a scratch folder.
  - It still wrote the LIVE `projects/untitled.json` and `projects/_autosave/untitled.json`, and the bridge copy
    (`~/bridge/projects/untitled.json`) mirrored them. That file existed before, as an empty Untitled project.
  - Restored both live files from the exFAT stick copy (`~/exfat/projects/untitled.json`, 11:11:56 today: empty,
    0 looks, other box's fingerprint `highascg5867`, rev 669). That is most likely the file the 16:00 stick sync
    put there, but it is not certain.
  - Not yet found: which code path ignores `HIGHASCG_PROJECTS_DIR`. A search was blocked by the session's permission
    classifier. Follow-up: find that writer (the bridge copy points at the project volume sync) and make it honour
    `projects-root.js`.
- Owner QA:
  1. Boot with the start prompt, pick the operator screen.
  2. Header → New project.
  3. Devices shows Operator GUI cabled to that jack.
