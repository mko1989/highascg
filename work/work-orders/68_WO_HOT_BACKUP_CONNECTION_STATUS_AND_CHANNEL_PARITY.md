# Work Order 68: Hot backup connection status, refresh, and channel parity (inspector)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress — v1 shipped 2026-06-27 (refresh API + inspector + channel parity summary); Caspar INFO parity gate deferred  
**Priority:** High (operators see “connected” after restart but replication is stale; no peer visibility on follower)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [65_WO_HOT_BACKUP_ROBUSTNESS_FAILOVER_PLAYHEAD_SYNC.md](./65_WO_HOT_BACKUP_ROBUSTNESS_FAILOVER_PLAYHEAD_SYNC.md) — playhead measure, fan-out robustness
- [64_WO_HOT_BACKUP_AMCP_FANOUT.md](./64_WO_HOT_BACKUP_AMCP_FANOUT.md) — AMCP fan-out transport
- [54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md](./54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md) — pairing, Device View inspector

**Operator doc (update when shipped):** `docs/reference/hot-backup-replication.md`

---

## 1. Problem statement

| Symptom | Likely cause |
|---------|----------------|
| After HighAsCG/Caspar restart, GUI shows paired / peer online but takes do not mirror | Peer HTTP ping may succeed while **live-state WS** or **peer Caspar AMCP** stayed disconnected; no operator action to nudge reconnect |
| Leader inspector showed follower stats; **follower saw nothing about leader** | UI was leader-centric (`follower` block only when `role === 'leader'`) |
| No indication whether **channel ids match** between boxes | Pairing copies project topology but local Device View / Caspar consumers differ; drift and fan-out failures are opaque |
| “Connected” is one-bit (`peerReachable`) | No breakdown of HTTP ping vs WS vs AMCP fan-out |

**Goal:** Expand the Device View **Hot backup → Connection** panel with **Refresh connection**, **two-way peer readouts** (this server + peer), **transport status**, and **channel plan parity** (match / list mismatches).

---

## 2. Product behaviour (normative)

### 2.1 Refresh connection (ship first)

| Requirement | Detail |
|-------------|--------|
| **Button** | `Refresh connection` in expanded Connection panel (paired only) |
| **API** | `POST /api/replication/refresh-connection` |
| **Actions** | `reloadReplicationFromConfig` → force peer HTTP ping → follower `reconcileFromLeader` on success → return fresh `buildReplicationStatus` |
| **Toast** | Success when ping OK; warn when transports reloaded but ping failed |

### 2.2 Two-way status (inspector)

| Requirement | Detail |
|-------------|--------|
| **When** | `replication.enabled && peer.host` — both leader and follower |
| **This server** | hostname, role, PGM/PRV/multiview channel plan from local config |
| **Peer** | From last peer ping: hostname, role, address, reachability, mirror seq, fan-out stats (leader), PGM fps pairs |
| **Transports** | Peer HTTP, live-state WS (outbound on follower / inbound count on leader), peer Caspar AMCP when fan-out active |

### 2.3 Channel parity indicator

| Requirement | Detail |
|-------------|--------|
| **Source** | `channelMap` on `/api/replication/ping` (program, preview, multiview from `getChannelMap`) |
| **Compare** | `channelParity` on `/api/replication/status` — `ok`, `mismatches[]` with human labels |
| **UI** | Green “Channels match” or amber list of mismatches (e.g. `PGM screen 2: ch 3 ≠ ch 2`) |
| **Config hash** | Warn when `configHash` differs (replication JSON slice only — not full Caspar XML) |

### 2.4 Caspar INFO CONFIG parity (running server)

| Requirement | Detail |
|-------------|--------|
| **When** | First step after pair connect / reconcile — before fan-out is trusted |
| **Compare** | Leader vs backup **running** Caspar `INFO CONFIG` channel count + per-channel `video-mode` (consumers may differ) |
| **API** | `GET /api/replication/export/caspar-channels` (peer token), `POST /api/replication/validate-caspar-parity`, `POST /api/replication/apply-device-view-caspar` (follower) |
| **Auto-fix** | Follower: after show sync, if backup has fewer channels → apply leader `screenDestinations` + regenerate `casparcg.config` from Device View |
| **UI** | Amber “backup needs N more channel(s)” + **Apply Device View → Caspar** on follower |

### 2.5 Deferred (v1.1)

- [ ] **T68.5** Auto-refresh connection on bridge startup when `enabled && peer.host`
- [ ] **T68.6** Leader-initiated ping of follower Caspar health before fan-out enable gate (WO-64 §4)

---

## 3. Implementation map

| Area | Path |
|------|------|
| Channel summary + compare | `src/replication/channel-parity.js` |
| Caspar INFO CONFIG parity | `src/replication/caspar-parity.js` |
| Refresh orchestration | `src/replication/replication-refresh.js` |
| Status payload | `src/replication/replication-service.js` — `local`, `peerBox`, `connection`, `channelParity` |
| Ping payload | `src/api/routes-replication.js` — `channelMap` on ping |
| WS connected flag | `src/replication/peer-ws-client.js` — `runtime.peerWsConnected` |
| Inspector UI | `client/components/device-view-inspector-replication.js` |
| Styles | `client/styles/09b3-device-view-inspector-sidebar.css` |
| Tests | `test/replication-channel-parity.test.js` |

---

## 4. Acceptance

- [x] **A68.1** Paired leader and follower both show expanded Connection panel with peer + local tables.
- [x] **A68.2** Refresh connection reconnects transports and updates status without full disconnect/reconnect pairing.
- [x] **A68.3** Channel mismatch lists specific screen/program/preview/multiview differences when peer ping includes `channelMap`.
- [x] **A68.4** Running Caspar parity on connect; follower auto-regenerates from Device View when backup has fewer channels.
- [ ] **A68.5** Field sign-off: after restart on both boxes, Refresh restores live takes without re-pairing.

---

## 5. Work Log

### 2026-06-27 — Agent (Cursor)

**Done:**
- Added `channel-parity.js`, `replication-refresh.js`, `POST /api/replication/refresh-connection`.
- Extended ping with `channelMap`; status with `local`, `peerBox`, `connection`, `channelParity`.
- Refactored inspector: expandable Connection panel, Refresh button, two-way tables, parity line.
- Unit tests for channel parity compare.

**Instructions for Next Agent:**
- Field-test restart scenario on leader `.20` + backup `.25`; confirm Refresh fixes stale WS/fan-out.
- Field-test connect when backup has fewer Caspar channels — confirm auto-regenerate creates channels from leader Device View destinations.
- Update `docs/reference/hot-backup-replication.md` with Refresh connection + channel/Caspar parity sections when A68.5 passes.

### 2026-06-27 (b) — Caspar parity on connect

**Done:**
- `caspar-parity.js`: fetch local INFO CONFIG, peer export, compare count + video-mode.
- Connect flow: follower runs parity after reconcile; auto-regenerates Caspar from Device View when backup is short.
- Leader logs parity warning after follower registers.
- APIs: `export/caspar-channels`, `validate-caspar-parity`, `apply-device-view-caspar`.
- Inspector: running Caspar parity line; follower button **Apply Device View → Caspar**.
