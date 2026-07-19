# WO-216 — Companion module: stored Wake-on-LAN target (mac/hostname/ip) + fire action

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** Medium
**Date:** 2026-07-14
**Source:** owner: "adding it to companion module to store and be ready to fire of wake on lan to stored mac, hostname, ip."
**Module:** `/home/casparcg/companion-module-dev/companion-module-highpass-highascg` (v1.0.2, WO-170)
**Why module-side:** the magic packet must originate from the always-on Companion host — the highascg box cannot wake itself when off.

---

## 1. Design

- **Instance config** (src/config-fields.js): new section "Wake on LAN" with `wol_mac` (textinput, regex `^([0-9A-Fa-f]{2}[:-]?){5}[0-9A-Fa-f]{2}$`, tooltip "MAC of the box to wake"), `wol_hostname` (textinput, informational label shown in action/variable), `wol_ip` (textinput, target's LAN IP — used for the broadcast fallback and future online feedback), `wol_broadcast` (textinput, default `255.255.255.255`), `wol_port` (number, default 9).
- **Actions** (new src/actions/wol-actions.js, registered in src/actions/index.js like the other action files):
  - `wol_wake_stored` "Wake stored target" — sends the magic packet to the configured `wol_mac` via `wol_broadcast:wol_port`; logs error status if `wol_mac` unset/invalid.
  - `wol_wake_mac` "Wake by MAC" — per-action options mac/broadcast/port for ad-hoc targets.
- **Magic packet:** plain `dgram` (no dependency): 6×0xFF + 16× MAC bytes; `setBroadcast(true)`; send 3 packets 100 ms apart (standard practice for lossy L2); close socket after.
- **Variables:** expose `$(highascg:wol_target)` = `hostname (ip)` for button labels (follow how existing variables are defined — grep variables in src/).
- **No online-feedback in v1** (would add polling of a possibly-down host); note as follow-up.
- Version bump 1.0.3 + CHANGELOG + `npm pack` to produce `highpass-highascg-1.0.3.tgz` (match existing tgz artifacts in the module root).

## 2. Tasks (haiku-sized)

- [x] T216.1 Config fields (section header + 5 fields) in src/config-fields.js following the existing style exactly.
- [x] T216.2 src/actions/wol-actions.js: `buildWolPacket(mac)` pure helper (exported for tests) + the two actions using dgram; register in src/actions/index.js next to the other registrations; MAC validation shared by both actions.
- [x] T216.3 Variable `wol_target` (find the variables definition site; skip with an honest note if the module has no variable registry).
- [x] T216.4 Test: the module repo has its own test setup? (check package.json scripts) — at minimum add a node:test file testing `buildWolPacket` (102 bytes, 6xFF header, 16 MAC repeats, case/separator tolerance) runnable via `node --test`; wire into the module's test script if one exists.
- [x] T216.5 Version 1.0.3, CHANGELOG entry, `npm pack` (verify tgz lands in module root), eslint (module has eslint.config.mjs) clean.
- [x] T216.6 Owner note in HELP.md / README: BIOS WoL + `ethtool -s <iface> wol g` must be armed on the TARGET box (see WO discussion; installer-unit follow-up tracked separately).

## 3. Acceptance criteria

- [ ] A216.1 A Companion button with "Wake stored target" powers on the configured box from soft-off (owner check on hardware).
- [ ] A216.2 Module lints/tests green; tgz packed at 1.0.3.

## 4. Work log

- 2026-07-14 — WO created per owner direction (module-side WoL with stored mac/hostname/ip).
- 2026-07-14 — T216.1–T216.6 completed: Config fields added (wol_mac/hostname/ip/broadcast/port); src/actions/wol-actions.js with buildWolPacket() helper and sendWol() using dgram udp4 broadcast (3 packets, 100ms spacing); two actions registered; wol_target variable added to definitions and set on config update; comprehensive tests (15 test cases) in test/wol-packet.test.js (node:test, all pass); package.json test script wired; version bumped 1.0.2→1.0.3 in both package.json and companion/manifest.json; CHANGELOG entry added; eslint config fixed for ES modules, wol-actions.js and test file lint clean; npm pack produces companion-module-highpass-highascg-1.0.3.tgz (77 KB); HELP.md updated with WoL section covering BIOS/ethtool setup and L2 subnet requirement.
- 2026-07-14 — Orchestrator verification: 15/15 packet tests pass (run via the package glob `test/*.test.js`; a bare `node --test test/` dir-arg fails on this node — not a code issue). The agent's eslint.config.mjs repair is legitimate and KEPT: the original config could not parse the module's ES modules, so lint had NEVER actually run — now that it does, it exposes 153 pre-existing errors in WO-170-era files (147 prettier auto-fixables + 6 no-unused-vars in look-actions/look-take-core/action-options/variables.js). Follow-up: run `npx eslint --fix` on those + review unused vars in a dedicated pass. New WoL files lint clean. tgz packed as companion-module-highpass-highascg-1.0.3.tgz (name follows package.json).
