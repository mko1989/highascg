# Hot backup replication (WO-54 / WO-61)

Two playout machines run as a **leader/follower** pair for hot backup.

## Operator workflow (Device View)

### Leader

1. Device View → select **Server** (rear panel band).
2. **Hot backup** → mode **Leader** → **Become leader**.
3. This sets `leaderAvailable` — followers can discover this box on the LAN.

### Follower

1. Device View → **Server** on the backup box.
2. Mode **Follower** → **Scan for leaders** → pick from dropdown.
3. **Connect to leader** — syncs running project, timelines, and **media clips used in looks** (not the whole library).

When paired, the inspector shows: *Screen destinations sync from the leader; wiring and Caspar consumers stay local on this box.*

**Caspar config on the follower** is generated from **this box’s** Device View wiring (cables, GPU/DeckLink layout) plus **leader screen destinations** (channel ids/modes). Leader sync does not copy leader cables or consumer topology.

- Local machine profile (`config/replication-local-machine.json`) stores **wiring and routing slices only** — not screen destinations.
- After leader show sync, the follower **re-applies** local wiring and **leader destinations**, then **regenerates** `casparcg.config`.
- Manual: **Server → Hot backup → Regenerate Caspar from Device View** (or `POST /api/replication/reload-local-machine`).

If the backup was seeded via full mirror rsync, it may still have the leader’s `device_graph.json` on disk until you **edit Device View on the backup once** (wire only what exists on that box), then regenerate.

### Disconnect

- **Disconnect (standalone)** on either box, or automatic after ~5s lost peer link.
- **Both machines keep playing locally** — no auto-promote, no stop.

## Data tiers (smart config sync)

Leader pushes **show content** and **screen destination definitions**. The follower **keeps its own wiring** (rear panel, cables, GPU/DeckLink mapping, Caspar consumer topology).

| Tier | Examples | Leader → follower? | Mechanism |
|------|----------|-------------------|-----------|
| **Show content** | Looks/scenes, timelines, referenced media, templates, **screen destinations** (output ids, modes, video modes), logical routing intent (`audioRouting`, stream/record **definitions**, DMX, Companion maps) | **Yes** | HTTP project/timeline push + pull; optional Syncthing for media |
| **Machine profile** | Device View **device graph** (cables, rear panel), `osDisplay` / `screen_N_system_id`, GPU layout, DeckLink numbers, `casparServer` host/port | **Never** | `config-classify.js` strip on push, merge preserves local on receive |
| **Live playout** | Active scene, timeline position, mixer | **Yes** | WS `/api/replication/ws` + CT-SS scheduled apply on **follower's** channel map |

Implementation: `src/config/config-classify.js` — `stripDeviceLocalFromProject`, `mergeSharedProjectIntoLocal`, `splitConfigForReplication`.

### Audited replication paths (WO-61 T0.3)

| Path | Machine profile safe? |
|------|----------------------|
| `pushProjectToPeer` | Yes — `stripDeviceLocalFromProject` before POST |
| `receiveProjectFromPeer` | Yes — strip again on receive + `mergeSharedProjectIntoLocal` |
| `GET /api/replication/export/project` | Yes — strip on export |
| `reconcileFromLeader` | Yes — uses export + receive (above) |
| `replicate-timelines` | N/A — timelines only, no device graph |
| Replication config saves (`connect-pair`, `promote`) | Only touches `replication` block |
| Full rsync mirror (`push-backup-box.sh`) | **Raw clone** — not for paired hot backup; use show-slice presets (WO-61) |

Peer rsync of `config/device_graph.json` must **not** be used on a paired follower without explicit operator opt-in. `screen_destinations.json` is replicated via project sync when paired.

## Syncthing (optional, automated)

No manual Syncthing GUI steps when enabled. On connect:

1. Leader builds `media/.replication-active/` with hardlinks to clips referenced by the active project.
2. REST API adds remote device + sendonly/receiveonly folder on both sides.
3. Requires Syncthing installed and running (`scripts/setup/12-syncthing-highascg.sh`).

**Exclude** `media/.replication-active/` from manual Syncthing shares of `media/`.

Bulk file sync between boxes can also use **rsync** (WO-61) — often simpler for one-off clones; Syncthing remains useful for ongoing media sync with a GUI.

## CT-SS / time-aligned mirror

Live intent packets include `applyAtLeaderTimeMs`. The follower estimates clock offset from ping (`serverTimeMs`) and applies takes at the aligned wall time — same approach as [CT-SS SyncPlay](../../CT-SS-master/reade.md).

Config: `scheduledApply: true`, `syncClock: ct-ss`, `scheduledApplyLeadMs: 1500` (tune on hardware).

> **Note (2026-06-27):** Semantic live-state mirror (`mirror-apply` re-take) is **legacy** for air sync. **Shipped:** **[WO-64 AMCP fan-out](../work/work-orders/64_WO_HOT_BACKUP_AMCP_FANOUT.md)**. **Next:** playhead sync + failover — **[WO-65](../work/work-orders/65_WO_HOT_BACKUP_ROBUSTNESS_FAILOVER_PLAYHEAD_SYNC.md)**.

## API

| Endpoint | Purpose |
|----------|---------|
| `POST /api/replication/become-leader` | Advertise as available leader |
| `POST /api/replication/stop-leader` | Stop advertising |
| `GET /api/replication/leaders` | LAN scan for available leaders |
| `POST /api/replication/connect` | Follower joins a leader |
| `POST /api/replication/disconnect` | Return to standalone |
| `GET /api/replication/status` | Role, peer, media %, lag, clock offset |

## Tests

```bash
npm run test:replication
```

See also: [61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md](../../work/work-orders/61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md) for rsync peer sync and Tailscale/Syncthing settings UI.
