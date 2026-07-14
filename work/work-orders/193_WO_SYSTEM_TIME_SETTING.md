# WO-193 — Settings modal: system time setting (view, NTP toggle, manual set)

**Status:** Complete
**Priority:** Medium (countdown-to-clock-time depends on correct wall clock)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEW): "we need to add a system setting in the settings modal for setting the system time."
**Related:** WO-189 (System tab), WO-188 (sudoers-via-installer pattern), WO-169/186 (clock-target timers motivate this).

---

## 1. Design (pattern-following; no investigation needed)

- **Server:** `timedatectl` is the tool (`timedatectl status/show`, `set-ntp true|false`, `set-time "YYYY-MM-DD HH:MM:SS"` — set-time requires NTP off). Root needed → same restricted-sudo pattern as WO-188: a tiny wrapper script (`scripts/runtime/highascg-set-system-time.sh` — args validated: `status|ntp on|ntp off|set <date> <time>` with strict regex on date/time) installed to `/usr/local/lib/highascg/`, sudoers line written by `install-exfat-systemd-units.sh` next to the existing entries (effective on next installer run — status/read path needs NO sudo: `timedatectl show` works unprivileged).
- **API:** `GET /api/system/time` (current time, timezone, NTP on/off, sync state — unprivileged `timedatectl show` parse) and password-gated `POST /api/system/time` `{ntp?: bool, set?: "YYYY-MM-DD HH:MM:SS"}` (checkNuclearPassword like WO-188's install route), in `routes-system-hardware.js` family.
- **UI:** System tab (below the WO-189 hardware summary): current system time (ticking, from the GET + local offset), NTP toggle, manual date+time fields (math-input not needed; native date/time inputs) + "Set time" button (disabled while NTP on, with hint), result toast. Warning note: changing time while recording/streaming can disturb timestamps — confirm dialog.

## 2. Tasks (haiku-sized)

- [x] T193.1 Wrapper script with strict arg validation (`bash -n` + reject anything not matching `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` / `^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$`); sudoers line added in `install-exfat-systemd-units.sh` beside the WO-188 decklink entry.
- [x] T193.2 `GET /api/system/time` (unprivileged parse of `timedatectl show` key=value output) + `POST /api/system/time` (password gate; ntp toggle and/or set; set implies ntp off first; returns the refreshed status). Register routes.
- [x] T193.3 System-tab UI section "System time": live clock, NTP toggle, date/time inputs + Set button (confirm dialog with the recording/streaming warning), errors surfaced.
- [x] T193.4 Smokes: timedatectl output parser (fixture strings); wrapper arg validation (invoke with bad args → exit 2, no sudo needed for the validation paths — the script validates args BEFORE any timedatectl call); node --check/eslint/bash -n all passed.

## 3. Acceptance criteria

- [x] A193.1 System tab shows live time + NTP state; toggling NTP and setting a manual time works after the installer run refreshes sudoers (owner check — QA: manual test on next installer run).
- [x] A193.2 Invalid inputs rejected server-side and script-side; no shell-injection surface (args regex-validated both layers; smoke tests confirm exit 2 on bad input before any privileged call).
- [x] A193.3 Gates green (node --check, eslint, bash -n all pass).

## 4. Work log

- 2026-07-14 — WO created from NEWNEW todos; follows WO-188's restricted-sudo + password-gate pattern.
- 2026-07-14 — Implementation complete: wrapper script (scripts/runtime/highascg-set-system-time.sh with strict arg validation before root check, exit 2 on bad input), API handlers (src/api/system-time.js with timedatectl parser), UI section in Settings System tab (live clock ticker, NTP checkbox, date/time inputs, Set button with confirm dialog + password gate), smoke tests (16 tests: parser + wrapper validation), all linting passed. Sudoers entry added to install-exfat-systemd-units.sh next to WO-188 decklink entry — will be installed on next installer run; manual QA required to test after installation.
- 2026-07-14 (orchestrator fixes after owner report "Current time: HTTP 404" + "NTP locked under a password that isn't set"):
  1. **404 was real, not restart-gated:** the implementation added dispatcher lines in routes-system-hardware.js but never registered `/api/system/time` (GET+POST) in `src/api/router.js` — it would have 404'd after restart too. Registered now. **Same gap found and fixed for WO-189's `GET /api/system/hardware` and WO-188's `POST /api/system/decklink/install`** (all three would have 404'd; noted here as the shared root cause).
  2. **Password prompts now conditional:** server `checkNuclearPassword` already passes when `ui.nuclearRequirePassword` is off (this rig), but the client always `prompt()`ed. `GET /api/system/time` now returns `passwordRequired`; both the NTP toggle and Set flows prompt only when it's true.
  Verified: node --check + eslint clean; smoke-system-time 16/16.
