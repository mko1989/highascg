# WO-739 — Linking servers: the other server accepts an invite, unless it auto-accepts

**Status: DONE (24.10.26) — offline suite (smoke 8/8, WO-725 e2e 14/14, Godot 21533/0) and live on .4 (release
2026-10-24T195734Z): a new server's link waited as `pending`, .4 listed the invite, its kiosk showed the card and
"Devices (1 invite)", and both Decline paths (API and kiosk button) worked. This box runs the old code until the owner
restarts its server; the Accept button itself is owner-QA.**

Owner, 24.10: *"there also needs to be an accept path for connecting servers together, unless the server had
autoaccept master invites in the inspector of device.."*

## Investigation

- WO-732 P1 made links mutual, implemented in `src/cluster/cluster-peers.js`:
  - `add()` on server A calls `linkBack()`: `POST /api/cluster/peers { address, link_back: false }` to B.
  - B's `add()` stores A at once.
  - Nothing on B asks its operator. Any server on the LAN that can reach B's port becomes linked, and with it
    trusted for signed calls, master claims and Send media.
- WO-732's repair (`heal`, every `HEAL_MS` = 60 s) re-asks a peer that doesn't list this server. That gives an invite
  a natural renewal: the inviter keeps asking while it still wants the link.
- Tombstones (`clusterUnlinked`) already express "this server deliberately dropped yours". The short race guard
  (2 × HEAL_MS) refuses *every* link-back right after an unlink, operator or not. A WO-732 smoke pins that.
- "The inspector of device" is the Devices server page: a click on the rear panel background shows
  `server_controls.gd`, `server_flow.gd` and `server_page_model.gd`. That model is replayed against a golden copy of
  the web page, so a client-only item goes under its `network_panel` flag, as the WO-692 network panel does.
- The Godot client has no app-wide toast. An invite has to be visible from every tab, not only on Devices.

## What was done

**Server**
- `src/cluster/cluster-invites.js` (new) holds the invites in memory, keyed by device fingerprint.
  - `record` creates or renews an invite, `take` removes one for accept or decline, and `drop` clears it once the
    server is linked.
  - An invite not renewed for 3 min lapses.
  - `clusterAutoAccept` lives in device-local persistence.
  - Why in memory: the inviter's repair brings an invite back within a minute after a restart, so a store would only
    keep stale ones.
- `src/cluster/cluster-peers.js`, with `opts.invites`:
  - **Receiving a link-back** from a server not listed here, without auto-accept, records an invite and answers
    202 `{ pending: true, error: "waiting for <host> to accept" }`. A server already listed links as before.
  - **On the linker:** `linkBack()` reads 202 `pending` as `back.pending`, and the peer view gains `link_pending`.
    The operator's `add` answers `link_back: { ok: false, error, pending: true }`, with `pending` only when true so
    the WO-732 shape stays. The repair logs the wait only once.
  - **`accept(id)`** = an operator link of the inviter. The inviter already lists this server, so it takes the link
    back at once.
  - **`decline(id)`** tombstones the inviter for 30 days, like an unconfirmed unlink, and sends it
    `DELETE /api/cluster/peers/<me>?link_back=0`.
    - If the inviter is away, its next repair gets 409 `unlinked` and drops its side.
    - Its later link-backs are refused ("unlinked (or declined)") until this server links it. That's the same rule
      as after an unlink, which keeps WO-732's race guard intact.
  - **`setAutoAccept(on)`.** The snapshot gains `self.auto_accept` and `invites`. `asked_at` is left out of the
    change signature, so renewals don't broadcast every minute.
  - Without `opts.invites`, the WO-732 behaviour is unchanged. Its smoke runs that way.
- `src/api/routes-cluster.js`:
  - three routes: `POST /api/cluster/invites/:id/accept`, `POST /api/cluster/invites/:id/decline` and
    `POST /api/cluster/auto-accept { on }`;
  - `createInvites` wired in;
  - the contract comment, plus `docs/wiki/api/contract/http.md` regenerated.
- **Mixed versions.**
  - An older receiver ignores everything and links at once (WO-732).
  - An older linker reads the 202 as success, and its repair keeps renewing the invite.

**Godot client**
- `cluster_panel.gd`: invites go on top of the Servers list as an accent-bordered card: "highascg5867 (192.168.0.4)
  asks to link with this server", with Accept and Decline, and an error line if the call failed. A waiting link's line
  on the linker's card is muted rather than warning orange.
- `cluster_model.gd`:
  - `link_line` gives "Waiting for B to accept the link (Devices → Servers there)" before the one-way text;
  - `invite_line`;
  - `devices_title`: "Devices (1 invite)".
- `app/shell.gd`: the Devices tab title shows pending invites, from WS `cluster:peers` and a `GET /api/cluster` on
  every WS connect. While following another server it ignores that server's WS, since it isn't this machine's.
- Server page (`server_page_model.gd`, `server_flow.gd`, `server_controls.gd`):
  - a "Linked servers" heading with the **Auto-accept master invites** tick, client only, under `network_panel`;
  - read from `GET /api/cluster` `self.auto_accept` when the page opens, and saved through `/api/cluster/auto-accept`;
  - a refused save puts the tick back;
  - disabled against an older server.

**Tests and CI**
- `tools/smoke/lib/cluster-lan.js` (new): WO-732's fake LAN moved out of its smoke, gaining an `invites` option and
  routing for the invite routes. `smoke-wo732-mutual-link.test.js` now requires it.
- `tools/smoke/smoke-wo739-link-invites.test.js` (new, 8 tests):
  1. The invite waits and the linker shows it waiting.
  2. Accept links both ways.
  3. The repair renews the invite, and an unrenewed one lapses.
  4. Decline drops the linker's side at once and refuses its re-link until this side links.
  5. Decline while the linker is away: it drops its side at its next repair.
  6. Auto-accept links at once and is persisted.
  7. Servers already linked aren't invited.
  8. Wiring pins.
- `tools/e2e/cluster-scenario.js` (WO-725): when a link answers `pending`, the other server must show the invite, and
  its accept must give `link_back.ok`.
- `tools/ci/run-offline-tests.js` reached 501 lines with the new entry, so the FILES list moved to
  `tools/ci/offline-test-files.js`. Nothing parses the list; CLAUDE.md now names the new file.
- Godot: `test_link_line_waits_for_an_invite`, `test_invite_line_and_devices_title` and
  `test_auto_accept_master_invites` (flow + items: off by default, saved, refused save reverts, disabled without an
  answer, absent from the web replay).

## What was VERIFIED

- WO-739 smoke 8/8. Mutation check: without the invite branch in `add()`, 5 of the 8 fail.
- WO-732 smoke 9/9 (on the moved harness), WO-725 e2e 14/14, and WO-670 cluster smokes 8/8.
  - The e2e runs three real sandbox servers over HTTP. Every pair was linked once and showed `pending`; the other
    server's `/api/cluster` listed the invite, and `POST /api/cluster/invites/:id/accept` linked both ways.
  - Master, signed calls, failover and unlink then passed on those links.
- Godot `--test` 21533 passed / 0 failed (+16), `--check` boot OK.
- Clean export: repo-integrity OK, max-lines 0 over, unwired-exports no new, boot OK, format OK, `test:ci` 3194 tests
  3190 pass, 3 skipped, 1 fail (WO-498, export-only). Lint 214 warnings (cap 216).

### Live on .4 (24.10, release 2026-10-24T195734Z)

.4 was updated through `/api/system/update/apply`, with its config backed up first (`~/config-backup-before-195734Z`,
md5 unchanged after the update). For the inviter I used a throwaway sandbox server on this box, published on
192.168.0.23 through a TCP relay. .4 checks that a HighAsCG server answers at the inviter's address before it records
an invite: the first try without the relay was refused with `no HighAsCG server at 192.168.0.23:<port>`, which is
right.

1. Sandbox → .4 link: `201 {"ok":false,"error":"waiting for highascg5867 to accept","pending":true}`.
2. .4 `/api/cluster`: `invites [{"host":"192.168.0.23","name":"highascg7580",…}]`, `auto_accept false`. The existing
   link with this box (highascg7580) and .4's master role were unchanged.
3. API decline: `POST /api/cluster/invites/:id/decline` → `200 {"ok":true,"told":true}`; invites 0 afterwards.
4. Kiosk, restarted with 0 SCRIPT ERROR. While an invite was held for 30 s, the tab bar on Live read
   "Devices (1 invite)". The Devices page showed "highascg7580 (192.168.0.23) asks to link with this server." with
   Accept / Decline. A click on **Decline** cleared it: invites 0, the card gone, the server list back. The script's
   own decline afterwards got `404 no such invite`, which shows the click had already done it.
5. The kiosk was left on the Live tab.

Each run leaves a tombstone on .4 for its throwaway sandbox fingerprint. It is harmless and expires after 30 days.

Not proven live: **Accept** from the kiosk. I did not want to link a throwaway server into .4's cluster; the accept
route itself is covered by e2e 14/14. This box runs the WO-739 code only after the owner restarts its server.
