**Status: IMPLEMENTED (2026-09-24, New project + project load both keep the map; new smokes fail without the fix / passes with it, smoke-new-project 4/4 + smoke-fresh-box-clean-device-view green) — needs `highascg` restart + owner on-hardware confirmation**

## Investigation

Owner: *"hitting new project sets the gpu ports in devices view to some stale defaults that are not
right for this card. also new project shouldnt reset the gpu ports layout as this is constant for the
machine and once operator sets the layout hed like it to be constant."*

- `createNewProject` (`src/engine/new-project.js`) builds its hardware slice from
  `buildFactoryModularConfig(defaults, …)` and applies it with `applyHardwareConfigToCtx` (`full` snapshot).
- `defaults-core.js:280` seeds `gpuPhysicalTopology: resolveDefaultTopologyForGpu(null)` — with no GPU
  model that resolves to the `__generic__` rows of `data/known-gpus.json`
  (`gpu_p0=DP-0/1, gpu_p1=HDMI-0/1, gpu_p2=DP-2/3, gpu_p3=DP-4/5`).
- `buildHardwareConfigFromConfig` → `extractPayloadFromConfig` (`device-snapshot.js:46`) copies that into
  `hardwareConfig.gpuPhysicalTopology`; `applySnapshotToConfigClone` (`device-snapshot.js:144`) writes it
  over the live map. The box is an **NVIDIA RTX PRO 4000 Blackwell** (DP-0..DP-7, no HDMI), so Device View
  showed HDMI ports the card does not have and lost the operator's slot order.
- `gpuPhysicalTopologyOperatorSaved` is not in the snapshot payload, so it stayed `true` — which makes
  `ensureGpuPhysicalTopologyFromXrandr` (`gpu-topology-xrandr.js:229`) refuse to rediscover, so the
  generic rows stuck until the operator re-saved the layout by hand.
- Device View's GPU tiles come from `buildGpuSelectablePortEntries(savedTopology: gpuPhysicalTopology, …)`
  plus suggested connectors derived from the same map, so the topology is the single thing to protect.
- `config-classify.js` already lists `gpuPhysicalTopology` under `DEVICE_TOP_LEVEL_KEYS` /
  `DEVICE_HARDWARE_SLICES` (machine-local, never replicated) — New Project was the odd one out.

## What was done

- `src/engine/new-project.js`: after building the starter hardware slice, replace its
  `gpuPhysicalTopology` with a deep copy of the LIVE map (or drop the key when none is set, so the apply
  leaves config alone). The operator-saved flag is untouched. The Untitled project therefore also carries
  the real map rather than the generic one.
- Chosen over changing `defaults-core.js`/`factory-starter.js`: those feed the full factory/stick reset
  too, where re-deriving the map is correct (`gpu-topology-factory-reset.js` resolves it per GPU model and
  re-probes). Only New Project must keep the machine's layout.

## What was verified

- New test in `tools/smoke/smoke-new-project.test.js` (operator layout with `gpu_p0` moved last,
  operator-saved=true): fails on the old code (live map replaced), passes with the fix; checks live
  config, the flag, and the Untitled project's `hardwareConfig`.
- `smoke-new-project` 4/4, `smoke-fresh-box-clean-device-view` green.
- Owner QA: set a GPU port layout in Device View → New project → layout and port names unchanged.

## Follow-up: project load never applies the layout (2026-09-24)

Owner: *"the layout should not be touched by projects loading."*

- `src/engine/project-hardware-config.js` `hardwareConfigToSnapshotPayload` no longer forwards
  `hc.gpuPhysicalTopology`, so `applyHardwareConfigToCtx` leaves the machine map alone on every path
  that uses it: server-side project load (`applyHardwareConfigFromProject`), `/api/project/apply-hardware`,
  and New project. Projects still RECORD the map on save (harmless, used for nothing on load).
- `client/lib/project-hardware-mismatch.js`: dropped the "GPU topology differs" mismatch item (it
  warned about something a load can no longer change) and the key from
  `buildDeviceSnapshotFromHardwareConfig` / `hasProjectHardwareConfig`.
- Device View's own snapshot import (`/api/device-snapshot/apply`) is untouched: that is the operator
  explicitly applying a device snapshot, not a project load.
- Verified: new smoke in `smoke-project-hardware-config.test.js` fails on HEAD, passes with the fix.
  Offline suite in the working tree 2508 pass / 1 fail / 2 skip; the failure (WO-537 `play(fromMs)`)
  passes on HEAD + only this change, so it comes from other uncommitted working-tree edits. Lint and
  500-line check clean; client rebuilt (`npm run build:client`).
