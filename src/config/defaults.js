'use strict'

/**
 * Default configuration merged into `highascg.config.json` on first run.
 *
 * Sections:
 * - **caspar** — AMCP target (overridable via CASPAR_HOST / CASPAR_PORT).
 * - **server** — HTTP bind (HTTP_PORT, PORT, BIND_ADDRESS).
 * - **osc** — UDP listener for Caspar OSC; see `src/osc/osc-config.js`.
 * - **ui** — Web UI toggles (footer VU, rundown timer).
 * - **audioRouting** — Master program output, optional monitor (second FFmpeg consumer), **browserMonitor** (`pgm` | `off`) for WebRTC preview audio.
 *
 * **streaming** is not stored here by default; at runtime `index.js` merges `resolveStreamingConfig` from
 * `src/streaming/stream-config.js` (capture mode, base ports, quality presets).
 * Persisted fields include `enabled`, `quality`, `basePort`, `hardware_accel`, `ffmpeg_path` when saved from Settings.
 *
 * Environment variables (CASPAR_HOST, CASPAR_PORT, HTTP_PORT, etc.) are applied **only** when creating
 * `highascg.config.json` for the first time (see `ConfigManager.load`). After that, the JSON file is the
 * source of truth so systemd/env does not override settings saved from the UI across restarts.
 */
const { coreDefaults } = require('./defaults-core')

module.exports = coreDefaults()
