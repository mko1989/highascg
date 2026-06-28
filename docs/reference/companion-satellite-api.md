# Companion Satellite API (HighAsCG reference)

HighAsCG uses Bitfocus Companion’s **Satellite API** for **button preview bitmaps** (WO-75). Timeline **press/trigger** stays on the **HTTP Remote Control API** ([WO-24](../../work/work-orders/24_WO_COMPANION_BUTTON_PRESS.md)).

## Official documentation

- **Satellite API (canonical):** https://companion.free/for-developers/Satellite-API/
- **HTTP Remote Control:** https://companion.free/user-guide/v4.1/remote-control/http-remote-control/

## What HighAsCG uses

| Feature | Protocol | Default port |
|---------|----------|--------------|
| Fire button from timeline | HTTP `POST /api/location/{page}/{row}/{column}/press` | 8000 (Companion web) |
| Button preview / page picker | Satellite **Button Subscriptions** (`ADD-SUB`, `SUB-STATE`, `REMOVE-SUB`) | **16622** TCP |

Requires Companion **~4.3+** with Satellite API **v1.10+** (`CAPS SUBSCRIPTIONS=1`).

### Subscribe example

```text
ADD-SUB SUBID=highascg/1/0/2 LOCATION=1/0/2 BITMAP=72 COLORS=hex TEXT=true TEXT_STYLE=true
```

Companion responds with `SUB-STATE` including base64 **8-bit RGB** `BITMAP` at the requested size.

## Implementation map

| Module | Path |
|--------|------|
| TCP client + subscriptions | `src/companion/satellite-preview-client.js` |
| Line protocol parse/format | `src/companion/satellite-protocol.js` |
| JPEG cache | `src/companion/button-preview-cache.js` |
| Config helper | `src/companion/companion-config.js` |
| HTTP routes | `src/api/routes-companion-preview.js` |

## Enable Satellite in Companion

In Companion: **Settings → Connections → Satellite** — enable the Satellite server (TCP port 16622 by default). Firewall must allow HighAsCG → Companion on that port (localhost is typical).
