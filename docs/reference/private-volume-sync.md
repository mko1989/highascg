# Private volume sync (machine secrets on USB / bridge)

Per-machine folder for **Tailscale**, **Syncthing**, and **replication pairing** — kept off the public `configs/` and `projects/` sync paths.

## Layout

| Location | Path |
|----------|------|
| Host | `~/highascg/.private/<machine-id>/` |
| USB stick | `/home/casparcg/exfat/.private/<machine-id>/` |
| Bridge disk | `/home/casparcg/bridge/.private/<machine-id>/` |

`<machine-id>` resolves from `replication.selfId`, then `general.machineId`, then hostname.

### Contents (exported on sync)

```
.private/<machine-id>/
  README.txt
  syncthing/device-id.txt
  syncthing/folders.json
  tailscale/status.json
  replication/pairing.json
```

The stick `pairing.json` omits `peer.token`. Tokens stay in `config/replication.json` on each host.

## Boot / sync

Runs after exFAT boot sync (`highascg-exfat-sync.service`). Manual:

```bash
node tools/runtime/exfat-sync-cli.js --private
```

## API

- `GET /api/system/private-sync`
- `POST /api/system/private-sync/run` with `confirm: PRIVATE_SYNC`

## Setup

```bash
sudo bash scripts/setup/14-private-volume-bootstrap.sh
```

See also [hot-backup-replication.md](hot-backup-replication.md).
