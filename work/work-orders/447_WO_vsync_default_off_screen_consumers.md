# WO-447 — Screen-consumer vsync defaults OFF (GL sync owns frame pacing)

**Status: DONE (06.08.26 — defaults flipped, live config healed, smoke added; Caspar picks up screens 2/4 on the owner's next Apply)**

Owner (mid-session, todos06.08 follow-up): *"remove the vsync on as default for screen
consumers. with the gl sync and vsync off the playback is perfect."*

## 1. Investigation

With `CASPAR_GL_SYNC_DISPLAY=<PGM connector>` active (the WO-407→439→440→444 arc), the GL
context syncs to the PGM head — a consumer-level vsync on top adds a second, competing
swap-wait (the same double-sync class `docs/reference/screen-consumer-vsync-nvidia.md`
warned about between the driver and the consumer). Owner verified on the box: GL sync +
consumer vsync off = perfect playback.

Default sites found (all previously `true`):
- `src/config/defaults-caspar-server.js` `casparScreenDefaults()` — seeded `screen_N_vsync: true`
- `client/lib/screen-consumer-defaults.js` `SCREEN_CONSUMER_DEFAULTS.vsync` — client fallback + seeding
- `src/config/config-generator-consumer-attach-screen.js:79` — generator fallback for an unset key

Live config: screens 1/3 already `false` (the owner's tested-perfect state); screens 2/4
still carried seeded `true` from the old default. `multiview_vsync: true` and the operator-GUI
consumer's hardcoded `<vsync>true</vsync>` were **left alone** — both were part of the
verified-perfect state and are not PGM playback consumers.

## 2. What was done

- All three default sites flipped to `false` (comments updated to name this WO's reasoning).
- Seeded `screen_2_vsync`/`screen_4_vsync` healed to `false` via the live settings API
  (`POST /api/settings`, `{"ok":true}`), same approach as WO-442's fossil heal. Explicit
  owner overrides remain possible per screen in the Device View inspector.
- `docs/reference/screen-consumer-vsync-nvidia.md` marked superseded for the consumer-vsync
  row (driver rows still stand: Sync to VBlank off, Force Composition Pipeline on).
- Acceptance smoke `tools/smoke/smoke-wo447-vsync-default-off.test.js` (3 tests: server
  seed, client default, generator unset→false + explicit-true respected); registered in the
  curated FILES list.

## 3. What was VERIFIED

- Generator probed directly: unset key → `<vsync>false</vsync>`; explicit `true` and
  `'true'` both respected.
- `config/caspar_server.json` now shows all four `screen_N_vsync: false` (API write
  confirmed, not a hand-edit).
- New smoke 3/3. Full suite re-run in the WO-446 batch tail.
- **Owner:** the generated Caspar XML updates on your next **Apply** (WO-440: Apply always
  restarts Caspar) — nothing to do beyond the Apply you'd do anyway.
