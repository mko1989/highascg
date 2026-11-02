# WO-932 — Two-box sweep findings: every clone boots with 7 failed snap mount units; the sweep's require check fails on ISO installs

**Area:** os-iso, testing-ci
**Status: DONE (02.11.26 — exclude-list smoke 45/45, sweep check skips where the script is not shipped; the snap units leave with the next ISO build)**

## Investigation

`node tools/sweep/run-sweep.js --peers=…` on both boxes after the WO-929 follow-up round. Results:
- this box: 26 pass / 3 warn / 1 fail;
- .31: 25 pass / 3 warn / 2 fail.
.31's `tools/sweep` and `replication-check.js` were first brought to HEAD over ssh.

- **.31 `core services`: failed units `snap-bare-5.mount`, `snap-core24-{1643,2124}.mount`, `snap-snapd-{27738,28254}.mount`,
  `snap-tailscale-{154,169}.mount`.**
  - journal: `mount: /snap/core24/2124: special device /var/lib/snapd/snaps/core24_2124.snap does not exist`;
  - eggs' stock list (`penguins-eggs-exclude-stock-custom.list`) drops `var/lib/snapd/`, `var/snap/` and `snap/`, but the
    mount units in `/etc/systemd/system/` (plus their `snapd.mounts.target.wants/` and `multi-user.target.wants/`
    links) ship. Every clone therefore boots with 7 failed units.
  - `snap.tailscale.tailscaled.service` ships dead next to the working deb `tailscaled`.
  - Nothing on a clone uses snaps: tailscale is the deb (`dpkg -l tailscale` → `ii 1.104.2`).
- **.31 `every require() in the tree resolves`: fail, `Cannot find module …/tools/ci/check-require-integrity.js`.**
  - The embed ISO excludes `tools/ci` (dev-only, WO-273; `smoke-eggs-exclude-lists` pins that), and the sweep runs the
    script from there.
  - Releases carry the file (`archive_common_server_tar_members`), so only ISO installs failed, on every sweep.
- Both boxes, `no errors in the server / Caspar logs`: fail. Two causes, recorded and not changed here:
  - **The WO-869 capability probe** `APPLY <ch>-65535 SLICES CLEAR` answers `403 APPLY FAILED` by design when no
    channel has a screen consumer (`caspar-caps-probe.js:9-11`). `amcp-protocol.js:222` still logs it as `[error] Got
    error PARAMETER_ILLEGAL`. Every Caspar connect on a box without a screen consumer adds one. Silencing it needs the
    protocol to know which command a 403 belongs to (it only sees `APPLY FAILED`). Left for a follow-up, so that a real
    mapping-slice APPLY failure is not hidden.
  - The test project "New project 1" still has two operator compose tiles from 22.10 on `route://4-1` and `route://5-2`
    (DeckLink 1/2). The shared show carried them to .31 as well. Both boxes run 3 channels without DeckLinks, so each
    layout apply logs `PLAY 1-12 route://4 → 403`. That is project data, not code.
- Warnings, as expected:
  - 11 Syncthing conflict copies (both trees, old June files);
  - DeckLink debs not on the exFAT / bridge;
  - .31 has no media key yet (it never sent media; WO-753 design);
  - free space on this box.

## What was done

- Both eggs lists (`embed-server`, `fragment`) exclude `etc/systemd/system/snap-*.mount`, `*.wants/snap-*.mount`,
  `snap.*.service` and `*.wants/snap.*.service`.
- `tools/sweep/checks-code.js`: `code.require-integrity` returns **skip** ("not on this install (ISO)") when
  `tools/ci/check-require-integrity.js` is absent, instead of failing.
- `tools/smoke/smoke-eggs-exclude-lists.test.js` (WO-669 matcher), per list:
  - the five unit paths seen on this box are excluded;
  - `highascg.service` and the deb `tailscaled.service` link are not.

## What was VERIFIED

- `node --test tools/smoke/smoke-eggs-exclude-lists.test.js`: 45/45.
- .31's sweep rerun with the changed check: 25 pass / 3 warn / 1 fail / 1 skip. The require check skips, and the
  remaining fail is the stale DeckLink tiles above.
- The snap units disappear with the next ISO build. Check on the clone with `systemctl --failed` (expect none).
