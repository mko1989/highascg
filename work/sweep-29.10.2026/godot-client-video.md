# godot/client/video — sweep 29.10.2026 (batch 043)

Files: 6 · lines: 686 · findings: 0 BUG-HIGH, 0 BUG, 6 DEAD, 2 RISK, 3 QUALITY

## godot/client/video/shm_native.gd
- `DEAD` godot/client/video/shm_native.gd:7-8 `path`, `native` — written in `_init` / initialised, never read. grep: `grep -rn "\.native\b\|\.path\b" godot/client --include=*.gd | grep -v tests/` → only `s.native` / `s.path` of the `_surfaces` dictionary in video_surfaces.gd (a different thing); no reader-object access.
- `QUALITY` godot/client/video/shm_native.gd:31-46 — `frames`, `gaps`, `lapped`, `reopens`, `latency_ms`, `read_ms`, `writer_dropped()` exist to feed a HUD that the client does not have (only godot/spikes/m0 had one). The sole non-test consumer of a reader is `signal_lost` (live_preview.gd:206) plus `poll()`/`src` in video_surfaces.gd. grep: `grep -rnw "latency_ms\|read_ms\|lapped\|reopens\|writer_dropped" godot --include=*.gd` outside video/, spikes/ and tests/test_shm_reader.gd → nothing. They are kept alive only by test_shm_reader.gd; not wrong, but 7 getters of dead surface per reader (same in shm_reader.gd).
## godot/client/video/shm_reader.gd
- `QUALITY` godot/client/video/shm_reader.gd:2-4 — header says "Spike only — production reads through the hshm GDExtension". Stale: this is the production reader on every machine without the extension (video_surfaces.gd:6 "else the GDScript reader", `_ensure` line 88; test_shm_reader.gd header says the same; Windows/macOS builds never have the extension).
- `RISK` godot/client/video/shm_reader.gd:88 — `_read(base, 8).decode_u64(0)`: `_read` returns an empty array when the segment file vanished between the header read (line 71) and this read (Caspar restart unlinking /dev/shm/highascg-*). `decode_u64` on an empty PackedByteArray logs an out-of-bounds engine error and returns 0, then `lapped += 1` counts a lap that did not happen. Line 94-95 guards the same case with `sh.size() < 32`. Fix: `var sq := _read(base, 8); if sq.size() < 8: return _stale(now)`.
## godot/client/video/shm_texture.gd
- `DEAD` godot/client/video/shm_texture.gd:29-33 `format_supported()` — no caller. grep: `grep -rnw format_supported godot ../tools ../scripts` → this definition and the copy in godot/spikes/m0/shm_texture.gd.
- `DEAD` godot/client/video/shm_texture.gd:135-139 `free_gpu()` — no caller; `_surfaces` entries in VideoSurfaces are never removed, so no texture is ever freed explicitly. grep: `grep -rnw free_gpu godot` → definition, spikes copy. The RD texture of a ShmTexture that is dropped therefore leaks (here deliberate: textures live for the session, but then the function is dead).
- `QUALITY` godot/client/video/shm_texture.gd:5-6,67-80 — `update_native` never updates `kind`, so a texture first fed RGBA (feed) or the fallback and later native reports the wrong kind; `kind` and `upload_ms` are read only by tests (test_video_feed.gd:53). Cosmetic.
## godot/client/video/surface_holders.gd
- `RISK` godot/client/video/surface_holders.gd:10-15 — holders are keyed by `get_instance_id()` and only removed by an explicit `drop`/`drop_all`. An owner that is freed without releasing keeps its role held for the rest of the session, so the role stays in `_renew()`'s lease list (video_surfaces.gd:104) and in `_process` polling; for runtime roles that keeps an on-air Caspar consumer alive. All current callers do release in their exit paths (grepped acquire/release pairs), so no failing case, but nothing auto-drops on `tree_exited`.
## godot/client/video/video_feed.gd
- `DEAD` godot/client/video/video_feed.gd:61-62 `is_open()` — no caller. grep: `grep -rn "is_open()" godot/client/video godot/client/features | grep -i feed` → none; only definitions of unrelated `is_open` in other classes.
- `DEAD` godot/client/video/video_feed.gd:44,93 `frames_in` — incremented, never read anywhere (grep -rnw frames_in godot → these two lines).
## godot/client/video/video_surfaces.gd
- `DEAD` godot/client/video/video_surfaces.gd:76-77 `is_held(role)` — no caller; `grep -rn "\.is_held(" godot/client --include=*.gd` hits only `holders.is_held` in tests/test_video_surfaces.gd (SurfaceHolders' own method). main.gd:497 reads `holders.roles()` directly.
- Checked live (not dead): `is_native` (main.gd:496), `release_all`, `reader`, `texture`, `sources_changed`, `leasing`.
