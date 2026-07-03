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
| **Show content** | Looks/scenes, timelines, referenced media, templates, **screen destinations** (output ids, modes, video modes), logical routing intent (`audioRouting`, stream/record **definitions**, DMX, Companion maps), **`project.hotBackup`** (paired peer hardware id + hostname) | **Yes** | HTTP project/timeline push + pull; optional Syncthing for media |
| **Machine profile** | Device View **device graph** (cables, rear panel), `osDisplay` / `screen_N_system_id`, GPU layout, DeckLink numbers, `casparServer` host/port | **Never** | `config-classify.js` strip on push, merge preserves local on receive |
| **Live playout** | Active scene, timeline position, mixer | **Yes** | WS `/api/replication/ws` + CT-SS scheduled apply on **follower's** channel map |

Implementation: `src/config/config-classify.js` — `stripDeviceLocalFromProject`, `mergeSharedProjectIntoLocal`, `splitConfigForReplication`.

### Project pair metadata (`project.hotBackup`, WO-78)

When paired, the **active project** stores show-tier pair metadata (replicated leader → follower):

```json
{
  "hotBackup": {
    "pairId": "uuid",
    "role": "leader",
    "self": { "hardwareId": "1234", "hostname": "highascg1234", "host": "10.0.0.5" },
    "peer": { "hardwareId": "7579", "hostname": "highascg7579", "host": "10.0.0.12" },
    "pairedAt": "2026-07-01T12:00:00.000Z"
  }
}
```

- Written on the **leader** when a follower registers (`applyLeaderHotBackupFromRegister`), then pushed with the project slice.
- Cleared locally when either box returns to **standalone** (manual disconnect or peer lost).
- UI: header badge shows **Paired with highascg####**; Device View → Hot backup lists peer hostname + hardware id.
- Follower UI resolves the paired box via `hotBackupPeerBoxForViewer` (stored metadata is leader-canonical).

Hardware ids come from the primary Ethernet MAC (`highascg####` hostnames). Re-pair after upgrading to populate metadata on existing pairs.

**Hostname apply:** bridge start calls `ensureHardwareHostname()`; if the system hostname is still a clone ISO name (`highascg-nvidia-*`), set it once with root: `sudo hostnamectl set-hostname highascg####` (#### = `hardwareId` from Device View or `config/hardware-identity.json`).

### WO-78 QA

| Scope | Command |
|-------|---------|
| Single box (smoke + identity) | `bash ~/highascg/tools/runtime/replication-pair-qa.sh` |
| Register rejection probe | `bash ~/highascg/tools/runtime/replication-pair-qa.sh --register-reject-test` |
| Post-pair two-box | `REPL_QA_PEER=<other-box-ip> bash ~/highascg/tools/runtime/replication-pair-qa.sh` |
| Stick boot module | included as test `11` in `tools/startup/stick-boot-test/run-stick-boot-tests.sh` |

Install rsync-only SSH wrapper on **both** boxes before pairing: `sudo bash scripts/replication/install-replication-ssh-wrapper.sh`.

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

## Project media sync (rsync, default)

On connect and when the leader pushes project updates, HighAsCG syncs **project-referenced media** over **rsync/SSH** — not the whole `media/` tree:

1. **`media/projects/<active-slug>/`** — project-scoped folder (WO-62)
2. Any **referenced clips** still in flat `media/` (legacy paths)
3. Referenced **`template/`** HTML files

| Role | Direction | When |
|------|-----------|------|
| Leader | push → backup | Explicit push (media sync button / API) or connect flow |
| Follower | pull ← leader | Explicit pull (media sync button / API) or connect flow |

Media is **not** synced automatically on project saves — spreading media is a deliberate operator action based on the project media folder (`media/projects/<slug>/`).

Env (optional): `HIGHASCG_REPL_RSYNC_USER` (default `casparcg`), `HIGHASCG_REPL_RSYNC_REMOTE_ROOT` (default repo root), `HIGHASCG_REPL_RSYNC_SSH_OPTS`, `HIGHASCG_REPL_RSYNC_TIMEOUT_MS`.

Manual: `POST /api/replication/sync-project-media` with optional `{ "direction": "push"|"pull"|"auto" }`.

**Requires** passwordless SSH between boxes (same as `scripts/deploy/push-backup-box.sh`).

> **Removed (2026-07):** the legacy Syncthing `media/.replication-active/` staging-folder
> workflow. It hardlinked/copied every referenced clip into a hidden folder at the media
> root on each project save; those copies entered Caspar's CLS catalog and clip resolution
> could rewrite PLAY lines to the staged copies. Media now spreads only from
> `media/projects/<slug>/` via explicit rsync push/pull.

Bulk file sync between boxes can also use **full rsync mirror** (WO-61 / `push-backup-box.sh DEPLOY_MODE=mirror`).

## Project files, autosave, and replication (WO-76)

Each box keeps its own on-disk project tree under `~/highascg/projects/`:

| File | Scope | Replicated leader → follower? |
|------|--------|----------------------------|
| `projects/<slug>.json` | Named save (explicit Save) | **Yes** — HTTP project push sends **main file at save time** (`stripDeviceLocalFromProject`) |
| `projects/_autosave/<slug>.json` | Debounced draft for **that slug only** | **No** — local per box; not part of replication POST body |
| Active slug (`.highascg-state.json`) | Which show is live | Follower sets active slug when receiving leader project |

**Boot / USB / bridge (exFAT):**

- `exfat-sync --boot` can pull `projects/` **including `_autosave/`** into the working directory on **non-leader** boxes (`shouldAllowExfatPullShowData`).
- **Leader** with `leaderAvailable` / `role: leader` **blocks** stick/bridge from overwriting the active show.
- Autosave pull (`pullAutosaveSlugFromVolumesIfNewer`) runs only for the **requested slug** — `_autosave/<slug>.json` never bleeds across slugs.

**Operator expectations:**

| Action | Leader | Follower |
|--------|--------|----------|
| Edit looks → autosave | Local `_autosave/<active>.json` + optional USB push | Own local autosave only |
| Explicit Save | Main JSON pushed to follower on save hook | Receives show slice; **keeps local Device View / GPU map** |
| Load another project (UI) | Main file only (no autosave merge) | Same — not driven by replication |
| Server restart (active slug) | Merges main + autosave for **active slug only** | Same |

See also: [wiki project API](../wiki/api/project.md) — `POST /api/project/load` autosave merge rules.

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
| `GET /api/replication/status` | Role, peer, media %, lag, clock offset, `companion` control-plane, `projectHotBackup` |
| `GET /api/companion/control-status` | Lightweight Companion routing hint (`acceptsCompanionControl`, `suggestedCompanionTarget`) |

### Companion hot backup (WO-70)

When Companion is configured with **main** and **backup** box hosts, poll:

```http
GET /api/companion/control-status
```

| Field | Use |
|-------|-----|
| `acceptsCompanionControl` | Send button actions to this box when `true` |
| `suggestedCompanionTarget` | `self` — keep this connection; `peer` — prefer the paired leader IP; `none` — degraded |
| `controlPlaneReason` | `standalone`, `leader_air`, `follower_standby`, `follower_promoted_backup`, `degraded_no_caspar`, `not_paired` |
| `warnings` | e.g. `channel_parity_mismatch` — does not block control |

Same payload is nested under `companion` on `GET /api/replication/status`.

## Tests

```bash
npm run test:replication
```

See also: [61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md](../../work/work-orders/61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md) for rsync peer sync and Tailscale/Syncthing settings UI.
