# Godot operator-client port — reference material

Plan and decisions live in the work orders; start at
[WO-593 (epic)](../work-orders/593_WO_godot_client_port_epic.md). This folder holds the evidence they cite.

| Path | What |
|------|------|
| `inventory/live-core-scenes-preview.md` | Live operation core (deck, PRV/PGM, compose, take, sources, live inputs, multiview editor, timers) → WO-600 |
| `inventory/inspector.md` | Inspector (13 sub-features) → WO-601 |
| `inventory/timeline-audio-media-secondary.md` | Timeline, audio mixer, media ops, playlists, shader live/FX, timers, CG/LT, LED/pixel map, variables, streaming/inputs → WO-602/603/604/606 |
| `inventory/device-view.md` | Device View → WO-605 |
| `inventory/shell-settings-contract.md` | Boot, WS client, state store, API client, header, settings, logs, project sync, USB, optional modules, CSS tokens, build → WO-598/599/608 |
| `inventory/runtime-kiosk-tests.md` | Firefox kiosk runtime, kiosk-only routes, config generator, install/ISO footprint, tests pinning client/kiosk files → WO-597/609 |
| `inventory/godot-ecosystem-research.md` | Godot 4.6/4.7 facts with sources + ranked risks → WO-595/596/599/610 |
| `desk-checks/check_api.gd` | Headless ClassDB probe: `godot --headless --script check_api.gd` |
| `desk-checks/bench_read.gd` | GDScript frame-read benchmark: `godot --headless --script bench_read.gd -- <file> <w> <h> <n>` |

Inventories are Haiku-generated (2026-10-17) and were spot-checked by hand wherever a WO relies on
them; their line references drift — re-grep before acting on one. Parity checklists
(`parity/<area>.md`) are created when each area WO starts.
