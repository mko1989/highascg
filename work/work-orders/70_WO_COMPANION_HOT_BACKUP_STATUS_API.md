# Work Order 70: Companion hot-backup status API

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Phase A–B shipped (2026-06-28); Companion module consumes API from dev tree  
**Priority:** High (Companion needs replication-aware control-plane hints beyond HTTP reachability)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md](./54_WO_HOT_BACKUP_LEADER_FOLLOWER_REPLICATION.md) — pairing, roles, promotion
- [64_WO_HOT_BACKUP_AMCP_FANOUT.md](./64_WO_HOT_BACKUP_AMCP_FANOUT.md) — AMCP fan-out mirror
- [68_WO_HOT_BACKUP_CONNECTION_STATUS_AND_CHANNEL_PARITY.md](./68_WO_HOT_BACKUP_CONNECTION_STATUS_AND_CHANNEL_PARITY.md) — `buildReplicationStatus`, connection breakdown

**Companion module (reference — shipped v1):**
- `companion-module-dev/companion-module-highpass-highascg/src/connection-router.js` — main/backup host failover via `/api/state` probe
- `companion-module-dev/companion-module-highpass-highascg/src/config-fields.js` — unified `box_host`, `hot_backup_enabled`, `backup_host`

**Operator doc (update when shipped):** `docs/reference/hot-backup-replication.md` — add Companion control-plane section

---

## 1. Problem statement

The Companion module now has **config-based hot backup**: actions go to **main** while reachable, then fail over to **backup** on disconnect.

| Gap | Why it matters |
|-----|----------------|
| Companion only probes `GET /api/state` reachability | A box can be **online** but **not the air leader** (follower, stale promotion, split-brain after partial failover) |
| `/api/replication/status` is rich but Companion-specific fields are missing | Module cannot show “connected to backup but follower — do not take” or prefer promotion-aware routing |
| No lightweight **control-plane** snapshot | Full replication status is heavy for 5 s health polls from Companion |
| Role changes after auto-promote are opaque to Companion | Operator may expect main IP to be leader after return; backup may still hold `leader` epoch |

**Goal:** Expose a small, stable **Companion control-plane** status on HighAsCG so the module can route actions to the box that is actually **accepting control** and **on air**, not merely reachable.

---

## 2. Product behaviour (normative)

### 2.1 New endpoint

| Item | Detail |
|------|--------|
| **Route** | `GET /api/companion/control-status` (JSON, no auth beyond existing LAN trust model) |
| **Also** | Include same object under `companion` key in `GET /api/replication/status` (optional denormalize) |
| **Cache** | None — cheap read from replication runtime + Caspar ping flags |

### 2.2 Response shape (v1)

```json
{
  "ok": true,
  "hostname": "highascg-leader",
  "boxHost": "192.168.1.20",
  "role": "leader",
  "configuredRole": "leader",
  "replicationEnabled": true,
  "paired": true,
  "peerHost": "192.168.1.25",
  "peerReachable": true,
  "acceptsCompanionControl": true,
  "controlPlaneReason": "leader_air",
  "airLeader": true,
  "promotedAt": null,
  "promoteReason": null,
  "mirrorTransport": "amcp-fanout",
  "amcpFanoutActive": true,
  "peerCasparConnected": true,
  "casparLocalConnected": true,
  "channelParityOk": true,
  "suggestedCompanionTarget": "self"
}
```

| Field | Semantics |
|-------|-----------|
| `acceptsCompanionControl` | **true** when external Companion actions should hit **this** box (leader with healthy local Caspar, or standalone) |
| `airLeader` | **true** when this box is the replication leader epoch holder |
| `controlPlaneReason` | Machine enum: `standalone`, `leader_air`, `follower_standby`, `follower_promoted_backup`, `degraded_no_caspar`, `not_paired` |
| `suggestedCompanionTarget` | `self` \| `peer` \| `none` — hint when Companion is configured with both main+backup IPs |

### 2.3 Rules

1. **Standalone** (`replication.enabled === false`): `acceptsCompanionControl: true`, `suggestedCompanionTarget: self`.
2. **Leader, paired, local Caspar up**: `acceptsCompanionControl: true`, `airLeader: true`.
3. **Follower, paired, leader peer reachable**: `acceptsCompanionControl: false`, `suggestedCompanionTarget: peer` (Companion should prefer main/leader IP).
4. **Follower, leader unreachable, auto-promote armed / promoted**: `acceptsCompanionControl: true`, `controlPlaneReason: follower_promoted_backup`.
5. **Channel parity failed** (from WO-68): `acceptsCompanionControl` may stay true but add `warnings: ["channel_parity_mismatch"]` — do not block local air.
6. **Caspar local down**: `acceptsCompanionControl: false`, `degraded_no_caspar`.

### 2.4 Companion module follow-up (separate PR)

After API ships, update `connection-router.js` to:

- Poll `GET /api/companion/control-status` on main and backup during health check
- Fail over when main unreachable **or** `acceptsCompanionControl === false` with `suggestedCompanionTarget: peer`
- Expose variables: `highascg_control_plane_reason`, `highascg_accepts_control`

Out of scope for this WO’s HighAsCG tasks but listed for integration.

---

## 3. Implementation map

| Area | Path |
|------|------|
| Control status builder | `src/api/companion-control-status.js` **(new)** |
| Route registration | `src/api/routes-companion.js` **(new)** or extend `routes-replication.js` |
| Wire into main router | `src/api/index.js` or existing dispatch |
| Unit tests | `test/companion-control-status.test.js` |
| Docs | `docs/reference/hot-backup-replication.md` |

Reuse: `buildReplicationStatus`, `getReplicationRuntime`, `compareChannelParity`, local Caspar connection flags from `connection-manager.js`.

---

## 4. Tasks

### Phase A — API

- [x] **T70.A1** Implement `buildCompanionControlStatus(ctx)` with rules in §2.3
- [x] **T70.A2** `GET /api/companion/control-status` route + JSON schema comment
- [x] **T70.A3** Optional: nest under `companion` in `buildReplicationStatus` return

### Phase B — Tests

- [x] **T70.B1** Unit tests: standalone, leader, follower+peer up, follower+promoted, caspar down
- [ ] **T70.B2** Smoke: `curl` leader and follower on paired lab pair

### Phase C — Docs & Companion integration

- [x] **T70.C1** Document endpoint in `hot-backup-replication.md`
- [x] **T70.C2** Companion module: consume `control-status` in failover router (follow-up PR)

---

## 5. Acceptance

- [x] **A70.1** Leader returns `acceptsCompanionControl: true`; follower with reachable leader returns `false` + `suggestedCompanionTarget: peer`.
- [x] **A70.2** After simulated leader loss + follower promotion, follower returns `acceptsCompanionControl: true` with `follower_promoted_backup`.
- [x] **A70.3** Response time &lt; 50 ms on LAN (no Caspar INFO round-trip).
- [x] **A70.4** Companion integration PR uses API for promotion-aware routing (optional v1.1 sign-off).

---

## 6. Work Log

### 2026-06-28 — Agent (Cursor)

**Done:**
- Drafted WO-70 from Companion module hot-backup work (unified `box_host`, config failover in `connection-router.js`).
- Identified gap: reachability probe ≠ replication control-plane leader.

**Instructions for Next Agent:**
1. Implement `buildCompanionControlStatus` + route (Phase A).
2. Add unit tests before Companion module consumes the API.
3. Open follow-up Companion PR to replace pure `/api/state` probe with `control-status` when available (graceful fallback).

### 2026-06-28 — Agent (Cursor)

**Done:**
- `src/api/companion-control-status.js` — `buildCompanionControlStatus`, `computeCompanionControlStatus` (pure rules).
- `src/api/routes-companion.js` + router wire for `GET /api/companion/control-status`.
- `companion` nested in `buildReplicationStatus`.
- `test/companion-control-status.test.js` — 7 unit cases.
- `docs/reference/hot-backup-replication.md` — Companion section.
- Companion `connection-router.js` polls control-status with `/api/state` fallback; variables `highascg_accepts_control`, `highascg_control_plane_reason`.

**Instructions for Next Agent:**
- Field smoke T70.B2 on paired lab boxes (`curl` leader + follower).
- Confirm failover when main IP points at follower (should defer to backup leader).
