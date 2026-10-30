# WO-610 — Remote native client (Godot on a Mac/Win/Linux laptop) without shared memory

**Area:** godot-client, network
**Status: DEPRECATED (Remote Godot client was built differently: WO-670 P1 (remote video via second Godot on the feed) and WO-686 (multi-platform); the /ws/gui-stream transport it assumed was removed by WO-660.; successor WO-670) — was: OPEN — DEFERRED (2026-10-17) until after WO-609 cutover. Parent: [WO-593](../593_WO_godot_client_port_epic.md). Optional: the web client covers remote operators meanwhile (WO-608 D1).**

## Investigation

- Shared memory only exists on the box. A remote Godot client needs the operator-channel video over
  the network. That transport **already exists**: `/ws/gui-stream` (WO-319) — ch5 NVENC-encoded once,
  H.264 access units over a binary WS (`u32 seq | u8 flags(bit0=keyframe) | 3 reserved | AU`,
  `src/preview/gui-stream-ws-relay.js:1-15`), idle until a client opens it (`src/bootstrap/operator-gui-stream.js:1-4`),
  downscaled to 1920 wide above 1080p.
- Godot core decodes **Theora only**. H.264 needs a GDExtension: EIRTeam.FFmpeg, GoZen, gd-hwvideo,
  lunastream — young on Linux, hardware decode VAAPI-only (NVDEC unclear), FFmpeg brings LGPL/GPL
  obligations (research [`godot-ecosystem-research.md`](../../godot-port/inventory/godot-ecosystem-research.md) §4, risk 10).
- Everything else in the client is transport-agnostic if WO-596's `ShmFrameSource` and a
  `StreamFrameSource` share one interface (`texture`, `signal_lost`, `latency_ms`).
- Local-path ingest (WO-603) is unavailable remotely → chunked/resumable HTTP upload (WO-599 Api).

## Options (to decide when this WO is opened)

1. **JPEG/WebP frames over WS** (Godot decodes both natively, no licensing): server-side NVENC is
   then not used; CPU JPEG cost measured at ~0.95 core/channel for half-scale MJPEG
   (`work/LOCALHOST_CHANNEL_VIEW.md` TL;DR) — acceptable for one remote viewer at reduced fps.
2. **H.264 via an FFmpeg GDExtension** (reuse `/ws/gui-stream` unchanged; best quality/bandwidth;
   licensing + platform-maturity work).
3. **NDI** via godot-ndi (Linux supported; proprietary runtime — ISO/redistribution terms UNVERIFIED).

## What was done / What was VERIFIED

Nothing yet. Transport facts read in `src/` by hand.
