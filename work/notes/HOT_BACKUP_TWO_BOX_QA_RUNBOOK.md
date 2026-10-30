# Hot-backup two-box QA runbook (WO-147 T147.7)

Executable checklist for the day a second box is available. Covers what single-box testing cannot:
pairing, fan-out on real air, failover, and autosave replication. Estimated time: ~2 hours.

**Prerequisites:** second box flashed from a current stick/ISO (or mirror-synced), both boxes on the
same LAN, this repo's build running on both, operator monitor on the leader.

Terms: **L** = leader box, **F** = follower/backup box.

---

## 0. Baseline

- [ ] Both boxes boot to the app; note versions: `curl -s http://<L>:4200/api/state | jq .version` and same for F.
- [ ] `tailscale status` / LAN IPs recorded. F's hardware hostname applied (`highascg####` — WO-78; needs root `hostnamectl` on first apply).

## 1. Pairing (WO-78 A78.1–A78.6)

- [ ] A78.1 On L: Settings → Replication → pair with F (or `POST /api/replication/connect-pair`). Handshake completes without any approval UI (background mutual ed25519 — WO-78).
- [ ] A78.2 `GET /api/replication/status` on BOTH boxes shows the pair, correct roles (L=leader, F=follower).
- [ ] SSH trust: from L, `ssh <F-hostname>` lands in the **rsync-only forced command** (no shell) — verify a plain ssh is rejected but replication rsync works.
- [ ] A78.4 Pair metadata persisted in the project `hotBackup` slice (open project JSON).
- [ ] A78.5/A78.6 Reboot F → pairing survives; `tools/runtime/replication-pair-qa.sh` passes on both.

## 2. Project + media replication (WO-79b A79.1–A79.4)

- [ ] Load a project with media on L. F pulls the running project + media (Syncthing staging + rsync — watch `GET /api/replication/status` transfer fields).
- [ ] Edit + autosave on L (debounced push): change a look, wait, confirm F's project updated.
- [ ] Add a new media file on L; confirm it lands on F (`media/` rsync).
- [ ] Kill Syncthing on F mid-transfer, restart → replication recovers without manual steps (reconnect-backoff, WO-147 T147.1).

## 3. Parity gate (WO-147 T147.3 / WO-68)

- [ ] `POST /api/replication/validate-parity` on L → `ok: true` when F's Caspar config matches.
- [ ] Break parity deliberately: change F's `casparcg.config` channel count, restart F's Caspar → gate reports mismatches; `GET /api/replication/status` shows `parityGate.ok=false`. Restore.

## 4. Fan-out on air (WO-64 Phases D–G)

- [ ] Enable fan-out; take a look to PGM on L → F's Caspar mirrors it (watch F's output).
- [ ] Run scripted takes for 60 s; measure drift: `node tools/replication/measure-playhead-drift.js` → **< 500 ms** sustained (WO-64 acceptance).
- [ ] Play a timeline via Take on L → F mirrors; check both outputs for the WO-139 frame-locked crossfade.
- [ ] Follower discipline: operator action on F's UI must NOT reach F's PGM while fan-out is active (`shouldFollowerSkipLocalPgmAmcp`).
- [ ] Kill the WS link (unplug F's ethernet 10 s, replug) mid-playout → reconnect with backoff, fan-out resumes, no duplicate/replayed commands (WO-147 chaos smoke, now on hardware).

## 5. Playhead correction (WO-147 T147.4 — opt-in)

- [ ] Enable `replication.playheadCorrection.enabled=true` on L. Start a long clip on both. Manually SEEK F's Caspar +2 s (AMCP) to force drift → within ~sustainedSec+interval, L issues a rate-limited CALL SEEK on F; drift returns under threshold. Disable again (default off).

## 6. Failover / promote drill

- [ ] Hard-stop L (power button) mid-playout. On F: promote (`promote.js` path / UI) → F's output goes live with the current project. Record time-to-air.
- [ ] Bring L back → it must NOT fight F for leadership (roles are manual — verify L comes back passive or re-pair cleanly).
- [ ] Demote/restore original roles; verify fan-out resumes L→F.

## 7. Teardown / unpair

- [ ] Unpair from L; both `GET /api/replication/status` clean; SSH forced-command entries removed; project `hotBackup` slice cleared.

## Results

| Section | Pass/Fail | Notes |
|---|---|---|
| 0 Baseline | | |
| 1 Pairing | | |
| 2 Replication | | |
| 3 Parity gate | | |
| 4 Fan-out | | |
| 5 Playhead correction | | |
| 6 Failover | | |
| 7 Teardown | | |

Then: update WO-54/64/65/68/78/79b/147 acceptance boxes with these results.
