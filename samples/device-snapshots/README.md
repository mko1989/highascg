# Device snapshot samples (WO-49)

These JSON files bundle **device graph + screen destinations + GPU / OS / DeckLink–related settings** for quick recall on a machine.

| File | Purpose |
|------|---------|
| `example-defaults-only.json` | Neutral template generated from `src/config/defaults.js` (no customer hostnames). |

## Creating a snapshot on a rig

1. Open **Devices** in the web UI.
2. Click **Save snapshot**, enter a **device name**, optionally embed the rear-panel PNG, and save the downloaded `.json`.

## Requesting a new “generic” template

Send the maintainer a snapshot exported from a reference machine (or describe hardware + attach a sanitized JSON). Filename convention: `slug.json` where `slug` matches the `slug` field inside the file when possible.

## Schema

- `GET /api/device-snapshot/schema` — JSON Schema draft-07 object.
- `GET /api/device-snapshot/build` — current machine payload (same structure as the `payload` field in a saved file).

Version upgrades: the top-level `version` field must match what the server accepts (`1` today).
