# Hot backup replication (WO-54)

Two playout machines run as a **leader/follower** pair.

## Data tiers

| Tier | Replicated? | Mechanism |
|------|-------------|-----------|
| Show data | Yes | HTTP `POST /api/replication/project` |
| Media | Yes | Syncthing folder `highascg-media` |
| Device-local | Never | `config-classify.js` |
| Private machine | Stick/bridge only | `.private/<machine-id>/` — [private-volume-sync.md](private-volume-sync.md) |
| Live playout | Yes | WebSocket `/api/replication/ws` |

## API

See `GET /api/replication/status`, `POST /api/replication/setup`, `POST /api/replication/promote`.

## Ops

- Media: `sudo bash scripts/setup/13-syncthing-media-pair.sh`
- Private secrets on stick: `sudo bash scripts/setup/14-private-volume-bootstrap.sh`
