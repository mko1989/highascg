# WO-460 — "Shut down host" button in Settings → Danger zone

**Status: IN PROGRESS (implemented + built 2026-08-10; owner must run `12-passwordless-sudo.sh` once per box, then QA the button)**

Owner (todos10.08): *"add in settings modal next to reboot host button a shutdown button."*

## 1. Investigation

The Danger zone pane already had **Restart window manager (nodm)** and **Reboot host**
(`client/components/settings-modal-templates.js:316-317`), wired at
`client/components/settings-modal.js:172-175` through `postNuclear()` → `POST /api/system/setup/reboot`.
There was no power-off path anywhere in the API, and the operator box is headless/kiosk — the only
way to power one down was a physical button or an SSH session.

Two constraints found before writing anything:

**(a) `reboot` is the fallthrough, not a branch.** `src/api/routes-system-setup.js` `handlePost()`
gates on a `nuclearPaths` set, handles `restart-window-manager`, `restart-app`, `install` and the
three `caspar/*` paths in explicit `if` blocks, then **runs `reboot` on anything that reaches the
bottom of the function** (`:438-451`). Adding `/api/system/setup/shutdown` to `nuclearPaths`
*without* its own branch would therefore have **rebooted the machine while answering
`{ok:true, action:'reboot'}`** — a silent wrong-action bug that no amount of UI testing would
explain. This is the single load-bearing detail of the change.

**(b) `poweroff` was not in the sudoers allowlist.** `scripts/setup/12-passwordless-sudo.sh:37-38`
grants `/sbin/reboot`, `/usr/sbin/reboot` and `systemctl reboot` only; verified against the live
policy on this box (`sudo -n -l` lists reboot, no poweroff/shutdown/halt). Without a new entry the
route would fail 502 forever, and `runSudoNoPrompt` uses `sudo -n`, so it fails fast rather than
hanging on a password prompt.

## 2. What was done

- `src/api/routes-system-setup.js` — `/api/system/setup/shutdown` added to `nuclearPaths` (so it
  inherits the existing nuclear-password gate, `checkNuclearPassword`), plus an **explicit branch
  placed before the reboot fallthrough** that tries `/sbin/poweroff`, `/usr/sbin/poweroff`,
  `systemctl poweroff` (both paths) and returns `action: 'shutdown'`. Its 502 message names the
  exact fix (`sudo bash scripts/setup/12-passwordless-sudo.sh`) rather than the generic
  "Check sudoers" text, because this is the one action whose sudoers entry is new.
- `src/api/router.js` — route registered with `requireCaspar: false`, matching `reboot`.
- `client/components/settings-modal-templates.js` — `#set-nuclear-shutdown` ("Shut down host")
  immediately after `#set-nuclear-reboot` in the same `settings-group`, same `btn--primary` class.
- `client/components/settings-modal.js` — click handler with a `window.confirm` that spells out
  the asymmetry with reboot: *"Outputs stop and the machine powers off — it cannot be restarted
  from this UI."*
- `scripts/setup/12-passwordless-sudo.sh` — two new allowlist lines (`/sbin/poweroff`,
  `/usr/sbin/poweroff`; `systemctl poweroff` both paths). Header comment and the printed summary
  updated. Still a strict allowlist — no wildcards (WO-97).
- Docs: `docs/HIGHASCG_PASSWORDLESS_SUDO.md` binary table gained the four poweroff rows;
  `docs/wiki/api/system-settings-hardware.md` gained the endpoint row.

## 3. What was VERIFIED to work

- `tools/smoke/smoke-wo460-shutdown-host-button.test.js` (new, registered in
  `tools/ci/run-offline-tests.js`) — **5/5 pass**. Pins: shutdown is in `nuclearPaths`; its branch
  **index-precedes** the reboot fallthrough (the (a) trap above, asserted positionally, not by
  string presence); the branch runs poweroff, contains no `reboot`, and returns `action:'shutdown'`;
  the route is registered and both sudoers lines exist; the button renders after Reboot host and
  its handler confirms before posting.
- Full offline suite: **1905 pass / 0 fail / 2 skip** (1907 tests, 255 suites).
- `npm run build:client` clean; `set-nuclear-shutdown` and `Shut down host` confirmed present in
  the emitted `dist-web/assets/main-*.js`.
- `require('./src/api/routes-system-setup.js')` loads (8 exports); shutdown route present in
  `router.js`.

**Tests are source-text only by design.** Calling `handlePost('/api/system/setup/shutdown')` runs
`sudo -n poweroff` for real — on a correctly provisioned box that powers the machine off mid-suite.
The test file carries that warning in its header so nobody "improves" it into a live call.

**Remains (owner):**

1. **Per box, once:** `sudo bash scripts/setup/12-passwordless-sudo.sh` — until then the button
   returns 502 with the fix in the message. Existing installs do **not** get poweroff rights from
   a repo pull alone; the ISO gets it via `scripts/setup/` on the next build.
2. QA the button (it was not clicked here — this build host would have powered off). Note
   `highascg.service` was `inactive` on this box, so no kiosk reload was needed; the new UI ships
   with the already-rebuilt `dist-web/`.
