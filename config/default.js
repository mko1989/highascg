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
 * `src/streaming/stream-config.js` (go2rtc port, SRT base ports, quality presets).
 * Persisted fields include `enabled`, `quality`, `basePort`, `hardware_accel`, `ffmpeg_path` when saved from Settings.
 *
 * Environment variables (CASPAR_HOST, CASPAR_PORT, HTTP_PORT, etc.) are applied **only** when creating
 * `highascg.config.json` for the first time (see `ConfigManager.load`). After that, the JSON file is the
 * source of truth so systemd/env does not override settings saved from the UI across restarts.
 */
function num(v, fallback) {
	const n = parseInt(String(v ?? ''), 10)
	return Number.isFinite(n) ? n : fallback
}

module.exports = {
	caspar: {
		host: '127.0.0.1',
		port: 5250,
	},
	offline_mode: false,
	/**
	 * Eyes hover: CPU/RAM (os), free disk (statfs), optional Caspar GL. Keep off in preshow (offline_mode).
	 * Folder scan uses `du` (walks media tree) — heavy; enable only on production Caspar host via:
	 * `host_stats.scan_folder` or env `HIGHASCG_HOST_STATS_DU=1`.
	 */
	host_stats: {
		scan_folder: false,
	},
	/**
	 * When OSC is on, optional AMCP `INFO` on each program channel every **N** ms (fallback when OSC
	 * omits `file/time`). **`0`** / **`null`** / unset = **off** (OSC only; default). Set **≥ 500** to enable.
	 * Env **`HIGHASCG_OSC_INFO_MS`** overrides when this is null.
	 */
	osc_info_supplement_ms: null,
	/**
	 * CasparCG `casparcg.config` generation (Settings → Screens). Merged with Audio / OSC + OSC ports in code.
	 * `configPath`: main server XML (separate from media-scanner config under `/opt/casparcg`). When set (non-empty), it wins over `CASPAR_CONFIG_PATH`; when empty, env then this default are used (see `resolveCasparConfigWritePath`).
	 */
	casparServer: {
		screen_count: 1,
		screen_1_mode: '1080p5000',
		screen_1_stretch: 'none',
		screen_1_windowed: true,
		screen_1_vsync: true,
		screen_1_borderless: false,
		screen_1_always_on_top: true,
		screen_1_decklink_device: 0,
		screen_1_ndi_enabled: false,
		screen_1_ndi_name: 'HighAsCG-CH1',
		screen_2_mode: '1080p5000',
		screen_2_stretch: 'none',
		screen_2_windowed: true,
		screen_2_vsync: true,
		screen_2_borderless: false,
		screen_2_always_on_top: true,
		screen_2_decklink_device: 0,
		screen_2_ndi_enabled: false,
		screen_2_ndi_name: 'HighAsCG-CH2',
		screen_3_mode: '1080p5000',
		screen_3_stretch: 'none',
		screen_3_windowed: true,
		screen_3_vsync: true,
		screen_3_borderless: false,
		screen_3_always_on_top: true,
		screen_3_decklink_device: 0,
		screen_3_ndi_enabled: false,
		screen_3_ndi_name: 'HighAsCG-CH3',
		screen_4_mode: '1080p5000',
		screen_4_stretch: 'none',
		screen_4_windowed: true,
		screen_4_vsync: true,
		screen_4_borderless: false,
		screen_4_always_on_top: true,
		screen_4_decklink_device: 0,
		screen_4_ndi_enabled: false,
		screen_4_ndi_name: 'HighAsCG-CH4',
		multiview_enabled: true,
		/** false = multiview channel has FFmpeg/SRT only (no Caspar screen window in generated config). */
		multiview_screen_consumer: true,
		multiview_mode: '1080p5000',
		multiview_windowed: true,
		multiview_vsync: true,
		multiview_borderless: false,
		multiview_always_on_top: true,
		decklink_input_count: 0,
		inputs_channel_mode: '1080p5000',
		configPath: '/opt/casparcg/config/casparcg.config',
		/** Persisted ALSA default (card/device index). Applied to ~/.asoundrc when set from Settings → System (optional scope=system → /etc/asound.conf). */
		default_alsa_card: '',
		default_alsa_device: '',
	},
	/**
	 * Absolute path matching CasparCG’s template-path directory (same as in casparcg.config XML).
	 * When set, `led_grid_test.html` and its character-frame SVGs (`both_open` / `left_closed` / `right_closed`) are copied here so they are **not** placed under
	 * media-path (they won’t show in the media / CLS list). If empty, those files fall back to
	 * `local_media_path` when that is set (legacy; SVGs may appear as media).
	 */
	local_template_path: '',
	server: {
		httpPort: 8080,
		wsPort: 8080,
		bindAddress: '0.0.0.0',
	},
	/** CasparCG OSC (UDP) — see `src/osc/osc-config.js` for runtime env tweaks */
	osc: {
		enabled: true,
		listenPort: 6250,
		listenAddress: '0.0.0.0',
		peakHoldMs: 2000,
		emitIntervalMs: 50,
		staleTimeoutMs: 5000,
	},
	/** Web UI toggles (persisted; not sent to Caspar) */
	ui: {
		oscFooterVu: true,
		rundownPlaybackTimer: true,
	},
	/**
	 * Audio routing (Settings → Audio / OSC). Merged by config-generator; PGM uses `<system-audio>` + OS default
	 * (`~/.asoundrc` or `/etc/asound.conf`), not FFmpeg ALSA consumers on the program channel.
	 */
	audioRouting: {
		programLayout: 'stereo',
		programOutput: 'default',
		programAlsaDevice: '',
		programFfmpegPath: '',
		programFfmpegArgs: '',
		monitorOutput: 'default',
		monitorAlsaDevice: '',
		monitorFfmpegPath: '',
		monitorFfmpegArgs: '',
		browserMonitor: 'pgm',
	},
}
