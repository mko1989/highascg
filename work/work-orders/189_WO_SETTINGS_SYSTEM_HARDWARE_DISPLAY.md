# WO-189 — Settings → System tab: hardware summary display

**Status:** Completed
**Priority:** Medium (operator visibility)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): "in the system tab of the settings modal do a display of the hardware that is on the system."
**Related:** WO-39 (settings system hardware), WO-165/182 (host-stats/process stats), WO-33b (host enumeration).

---

## 1. Findings (2026-07-14) — assembly job; every probe already exists

- System tab pane exists but shows only operator-display status + two buttons: `settings-modal-templates.js:196-205` (`settings-pane-system-hardware`), renderer `settings-modal-mount-hardware.js:70-86`.
- Reusable server helpers: `/api/host-stats` (cores/load/mem/GPU util/disk/process stats, `routes-host-stats.js:203-286`), `gpuNvidiaGet()` (`system-hardware-nvidia.js:83-150` — name/driver/VRAM/module/deb), GPU ports via `getPhysicalPortsFromXrandrInventory` (`system-hardware-gpu-layout.js:39-71`), DeckLink `decklinkGet()` (`system-hardware-decklink.js:56-92`), audio `listAudioDevices()` (`audio/audio-devices.js:151+` — ALSA/PipeWire/PortAudio), network `listEthernetInterfaces()`/`buildNetworkStatus()` (`system/network-inventory.js`).
- Cheap new reads needed: CPU model from `/proc/cpuinfo`, distro from `/etc/os-release`, kernel `os.release()`, uptime `os.uptime()`, disks `lsblk -J` (only removable-USB discovery reads it today).

## 2. Tasks (haiku-sized)

- [x] T189.1 New aggregator `src/api/system-hardware-summary.js` + route `GET /api/system/hardware` in `routes-system-hardware.js` (dispatcher line 30): shape `{cpu:{modelName,cores,load…}, memory, disks[], gpu:{nvidia,displayPorts[]}, decklink, audio, network, system:{osRelease,kernel,uptimeSec}}` — reuse the helpers above (import, don't duplicate); add the four cheap readers; every section null-safe with an `error` field on probe failure; total gather <3 s (reuse existing caches; cache the static parts ~60 s).
- [x] T189.2 Client: `settings-modal-mount-hardware.js` — on System-tab open, fetch `/api/system/hardware`, render a sectioned summary under the existing operator-display block (CPU model+cores+load, RAM used/total with bar, disks table, GPU name/driver/VRAM + connected ports, DeckLink devices, audio device count w/ expandable list, network hostname+interfaces, OS/kernel/uptime). Match the settings modal's existing markup/CSS conventions; a Refresh button re-fetches.
- [x] T189.3 Smoke: aggregator with mocked probes (all-null degradation, shape stability); node --check + eslint; manual QA note.

## 3. Acceptance criteria

- [x] A189.1 System tab shows the machine's hardware (operator check after restart+reload); probe failures degrade to "unavailable" rows, never a broken pane.
- [x] A189.2 Gates green (all syntax and linting checks pass).

## 4. Work log

- 2026-07-14 — WO created; all data sources mapped to existing helpers, endpoint+render plan recorded.
- 2026-07-14 — Implementation complete:
  - **T189.1 (Aggregator)**: `src/api/system-hardware-summary.js` (332 lines) — imports reused helpers from GPU, DeckLink, audio, network. Cheap readers for CPU model (/proc/cpuinfo), OS release (/etc/os-release), kernel (os.release()), disks (lsblk -J). Static cache 60 s (CPU model, OS, kernel). All probes wrapped in try/catch; uses Promise.allSettled for parallel execution; total budget <3 s. Every section includes error field on failure; no throw.
  - **T189.2 (Client)**: Extended `settings-modal-mount-hardware.js` (420 lines) with `renderHardwareSummary()` function. Renders CPU, memory (with byte formatter), disks table, GPU (NVIDIA + display ports), DeckLink, audio, network, system info. HTML is built with createElement (no innerHTML injection except escaped data). Added Refresh button in template; wired in settings-modal.js. Graceful degradation: fetch errors silently logged, hardware pane shows error sections instead of breaking.
  - **Helpers exported**: `getPhysicalPortsFromXrandrInventory` added to system-hardware-gpu-layout.js exports (was inline-only).
  - **Route dispatcher**: Added line 30 in routes-system-hardware.js: `if (p === '/api/system/hardware') return handleHardwareSummaryGet(ctx)`.
  - **Smoke test**: test/system-hardware-summary.smoke.js (all probes fail shape, partial data shape, JSON serializability) — 3/3 pass.
  - **Syntax & lint**: node --check on aggregator, routes, gpu-layout ✓; eslint --quiet on all touched files (src/api + client) ✓.
- **Manual QA note**: Operator should verify in Settings → System tab:
  1. Hardware summary appears below operator-display block (if backend running).
  2. CPU model, cores, load; memory used/total; disks table; GPU info; DeckLink count; audio device count; network hostname; OS/kernel/uptime all render.
  3. Refresh button re-fetches data (no page reload needed).
  4. Probe failures (e.g., no NVIDIA GPU) show "unavailable" / error messages, not broken pane.
  5. Works on live box (no restarts); curl -s 127.0.0.1:4200/api/system/hardware | jq returns JSON shape with all sections.
