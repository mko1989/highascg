# WO-443 — Monitor audio output must not ride in projects

**Status: DONE (2026-08-06 — suite 1863/0/2, service restarted; owner QA: save + reload a project, monitor output stays put and is absent from the file)**

Owner (todos06.08.26, 2nd batch): "it seems the monitor audio output is part of default
project, which it shouldnt be."

## Investigation

- The project hardware slice carries `audioOutputs` wholesale: `ROUTING_EXTRA_KEYS` in
  `src/engine/project-hardware-config.js` — save stamps `cfg.audioOutputs` into
  `project.hardwareConfig`, load overwrites the live `audioOutputs` from the project.
- The live monitor entry (`config/audio_outputs.json`): `{ id: 'audio_monitor_usb',
  label: 'Audio 2', role: 'monitor', type: 'system-audio', deviceName: 'sc60mon' }` — a
  device name that only exists on THIS box. WO-425 already established the principle: the
  monitor output is box hardware, never a default and never portable; WO-406 built the
  monitor bus on top of it.
- Consequence of project-scoping it: every saved project embeds this box's monitor device;
  loading a project saved elsewhere (or before the monitor was configured) imposes a wrong
  or missing monitor entry over the live one — monitoring breaks on project switch.
  Legacy projects in `projects/` already carry such copies.

## What was done

`src/engine/project-hardware-config.js` (+ exported `splitMonitorAudioOutputs`):

- **Save** (`buildHardwareConfigFromConfig`): `role: 'monitor'` entries are filtered out of
  the slice — new/updated projects no longer embed the monitor output.
- **Load** (`applyHardwareConfigToCtx`): `next.audioOutputs` = the project's non-monitor
  entries + the BOX's current monitor entries. A monitor copy inside a legacy project is
  dropped (it describes whatever box it was saved on); the box's own is preserved.
- Existing project files were NOT rewritten — the load-side filter makes their embedded
  monitor copies inert, and the next explicit save drops them naturally.
- Smoke `tools/smoke/smoke-wo443-monitor-audio-not-in-project.test.js` (curated list):
  save excludes monitor role; load keeps the box entry (sc60mon) and drops a stale
  other-box copy while portable entries come from the project; splitter is shape-safe.

## Verified

- Smoke 3/3; full suite **1865 tests, 1863 pass, 0 fail, 2 skip**.
- Server change: highascg restarted (API 200). Owner QA: save the current project, confirm
  the monitor output still works, and that `hardwareConfig.audioOutputs` in the project
  file no longer contains `audio_monitor_usb`.
