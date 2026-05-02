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
	/**
	 * When true, collapse multi-command AMCP sends into BEGIN…COMMIT batches (fewer round-trips).
	 * False by default — sequential sends are safer on some Caspar builds (stack depth / crashes).
	 * Override at runtime: env `HIGHASCG_AMCP_BATCH=1` or set this key in `highascg.config.json`.
	 */
	amcp_batch: false,
	/** Max AMCP commands per BEGIN…COMMIT chunk (1–512). Larger = fewer round-trips; too large may stress some Caspar builds. */
	amcp_max_batch_commands: 64,
	/**
	 * Send Caspar `MIXER <channel> COMMIT` immediately before **mixer-only** BEGIN…COMMIT batches (no `CG` lines).
	 * Skipped for CG batches (PIP borders, multiview overlay) so channel state is not committed mid-take.
	 */
	amcp_mixer_commit_before_amcp_batch: true,
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
		/**
		 * `stock` — vanilla CasparCG 2.5 XML (no PortAudio / enhanced screen tags).
		 * `custom_live` — custom server build with PRs #1718–#1720: emit `<portaudio>`, optional `<aspect-ratio>` / `<enable-mipmaps>` inside `<screen>`.
		 * @see docs/CASPAR_CUSTOM_BUILD.md
		 */
		caspar_build_profile: 'custom_live',
		/** custom_live: root `<log-level>` (empty string = omit in generator) */
		caspar_log_level: 'info',
		/** custom_live: emit root `<system-audio>` with empty `<device-name/>` */
		caspar_root_system_audio: true,
		/** custom_live: root `<portaudio>` from screen 1 fields; channels use `<portaudio/>` */
		caspar_global_portaudio: true,
		/** custom_live: `<host-api>` inside PortAudio (root or per-consumer) */
		caspar_portaudio_host_api: 'auto',
		/** Transition architecture: `switcher_bus` (OUT+BUS1+BUS2) or `legacy_layer` (PGM/PRV). */
		transitionModel: 'switcher_bus',
		screen_count: 1,
		screen_1_mode: '1080p5000',
		screen_1_stretch: 'none',
		screen_1_windowed: true,
		screen_1_vsync: true,
		screen_1_borderless: false,
		screen_1_always_on_top: true,
		screen_1_decklink_device: 0,
		/** When true and video mode is a standard preset (not custom) and decklink device > 0: omit Caspar screen consumer, output PGM to DeckLink only. */
		screen_1_decklink_replace_screen: false,
		screen_1_ndi_enabled: false,
		screen_1_ndi_name: 'HighAsCG-CH1',
		/** custom_live: optional `<aspect-ratio>` inside `<screen>` (e.g. 16:9, 3840:1080) */
		screen_1_aspect_ratio: '',
		screen_1_enable_mipmaps: false,
		/** custom_live: ASIO multi-channel audio via PortAudio consumer (disables OpenAL PGM `<system-audio>` for this screen) */
		screen_1_portaudio_enabled: false,
		screen_1_portaudio_device_name: '',
		screen_1_portaudio_output_channels: 2,
		screen_1_portaudio_buffer_frames: 128,
		screen_1_portaudio_latency_ms: 40,
		screen_1_portaudio_fifo_ms: 50,
		screen_1_portaudio_auto_tune: true,
		/** custom_live: extended `<screen>` tags (PR #1718) */
		screen_1_key_only: false,
		screen_1_interactive: false,
		screen_1_sbs_key: false,
		screen_1_colour_space: 'RGB',
		screen_1_force_linear_filter: true,
		screen_2_mode: '1080p5000',
		screen_2_stretch: 'none',
		screen_2_windowed: true,
		screen_2_vsync: true,
		screen_2_borderless: false,
		screen_2_always_on_top: true,
		screen_2_decklink_device: 0,
		screen_2_decklink_replace_screen: false,
		screen_2_ndi_enabled: false,
		screen_2_ndi_name: 'HighAsCG-CH2',
		screen_2_aspect_ratio: '',
		screen_2_enable_mipmaps: false,
		screen_2_portaudio_enabled: false,
		screen_2_portaudio_device_name: '',
		screen_2_portaudio_output_channels: 2,
		screen_2_portaudio_buffer_frames: 128,
		screen_2_portaudio_latency_ms: 40,
		screen_2_portaudio_fifo_ms: 50,
		screen_2_portaudio_auto_tune: true,
		screen_2_key_only: false,
		screen_2_interactive: false,
		screen_2_sbs_key: false,
		screen_2_colour_space: 'RGB',
		screen_2_force_linear_filter: true,
		screen_3_mode: '1080p5000',
		screen_3_stretch: 'none',
		screen_3_windowed: true,
		screen_3_vsync: true,
		screen_3_borderless: false,
		screen_3_always_on_top: true,
		screen_3_decklink_device: 0,
		screen_3_decklink_replace_screen: false,
		screen_3_ndi_enabled: false,
		screen_3_ndi_name: 'HighAsCG-CH3',
		screen_3_aspect_ratio: '',
		screen_3_enable_mipmaps: false,
		screen_3_portaudio_enabled: false,
		screen_3_portaudio_device_name: '',
		screen_3_portaudio_output_channels: 2,
		screen_3_portaudio_buffer_frames: 128,
		screen_3_portaudio_latency_ms: 40,
		screen_3_portaudio_fifo_ms: 50,
		screen_3_portaudio_auto_tune: true,
		screen_3_key_only: false,
		screen_3_interactive: false,
		screen_3_sbs_key: false,
		screen_3_colour_space: 'RGB',
		screen_3_force_linear_filter: true,
		screen_4_mode: '1080p5000',
		screen_4_stretch: 'none',
		screen_4_windowed: true,
		screen_4_vsync: true,
		screen_4_borderless: false,
		screen_4_always_on_top: true,
		screen_4_decklink_device: 0,
		screen_4_decklink_replace_screen: false,
		screen_4_ndi_enabled: false,
		screen_4_ndi_name: 'HighAsCG-CH4',
		screen_4_aspect_ratio: '',
		screen_4_enable_mipmaps: false,
		screen_4_portaudio_enabled: false,
		screen_4_portaudio_device_name: '',
		screen_4_portaudio_output_channels: 2,
		screen_4_portaudio_buffer_frames: 128,
		screen_4_portaudio_latency_ms: 40,
		screen_4_portaudio_fifo_ms: 50,
		screen_4_portaudio_auto_tune: true,
		screen_4_key_only: false,
		screen_4_interactive: false,
		screen_4_sbs_key: false,
		screen_4_colour_space: 'RGB',
		screen_4_force_linear_filter: true,
		multiview_enabled: true,
		/**
		 * When true (default), each preview channel gets a Caspar &lt;screen&gt; consumer (same layout flags as its PGM pair)
		 * in addition to the preview UDP stream. Set false for headless / stream-only PRV.
		 */
		/** @deprecated Ignored — PRV channels never get a Caspar &lt;screen&gt; in generated config (virtual-only). */
		preview_screen_consumer: false,
		/** false = multiview channel has FFmpeg/SRT only (no Caspar screen window in generated config). */
		multiview_screen_consumer: true,
		/** screen_stream | stream_only | screen_only | decklink_only | screen_decklink | decklink_stream | screen_stream_decklink — empty uses legacy multiview_screen_consumer. */
		multiview_output_mode: '',
		/** DeckLink device index for multiview channel when output mode includes decklink (standard video modes only for decklink-only). */
		multiview_decklink_device: 0,
		multiview_mode: '1080p5000',
		multiview_windowed: true,
		multiview_vsync: true,
		multiview_borderless: false,
		multiview_always_on_top: true,
		/** custom_live: optional multiview &lt;screen&gt; extras (see buildMultiviewScreenConsumerInnerXml). */
		multiview_aspect_ratio: '',
		multiview_enable_mipmaps: false,
		multiview_key_only: false,
		multiview_interactive: false,
		multiview_sbs_key: false,
		multiview_colour_space: 'RGB',
		multiview_force_linear_filter: true,
		/**
		 * When true with `decklink_input_count` 0, still allocate a dedicated Caspar channel (empty \<consumers/\>) for SDI input routing; use Live + to PLAY per layer.
		 * @see Settings → Inputs tab
		 */
		decklink_inputs_host_channel_enabled: false,
		decklink_input_count: 0,
		/**
		 * Where DeckLink **input** producers are played once with `PLAY … DECKLINK`:
		 * `dedicated` — routing-only channel after PGM/PRV/(MV) (default); `preview_1` — Screen 1 preview channel; `multiview_if_match` — multiview channel when its mode matches inputs mode (legacy).
		 * Program and other outputs should use `route://inputsCh-layer` only.
		 */
		decklink_inputs_host: 'multiview_if_match',
		/** Per input slot (1–8): Caspar DeckLink **device index** for `PLAY … DECKLINK N`. `0` = auto (slot N uses device N). Must not duplicate another slot or any program/multiview DeckLink **output** device. */
		decklink_input_1_device: 0,
		decklink_input_2_device: 0,
		decklink_input_3_device: 0,
		decklink_input_4_device: 0,
		decklink_input_5_device: 0,
		decklink_input_6_device: 0,
		decklink_input_7_device: 0,
		decklink_input_8_device: 0,
		inputs_channel_mode: '1080p5000',
		/** CasparCG global `<ndi><auto-load>` in generated casparcg.config (NDI SDK load at startup). */
		ndi_auto_load: true,
		configPath: '/opt/casparcg/config/casparcg.config',
		/** Persisted ALSA default (card/device index). Applied to ~/.asoundrc when set from Settings → System (optional scope=system → /etc/asound.conf). */
		default_alsa_card: '',
		default_alsa_device: '',
	},
	/**
	 * USB → media folder import (WO-29). Headless Linux uses udisks2 + polkit; macOS lists /Volumes.
	 */
	usbIngest: {
		enabled: true,
		/** Subfolder template under media root: `{label}` `{date}` (YYYY-MM-DD); empty = flat copy. */
		defaultSubfolder: '',
		/** `skip` | `overwrite` | `rename` (append _N) */
		overwritePolicy: 'rename',
		verifyHash: false,
	},
	/**
	 * Absolute path matching CasparCG’s template-path directory (same as in casparcg.config XML).
	 * When set (e.g. `/opt/casparcg/template`), **all** files from HighAsCG’s `templates/` folder are synced here on Caspar connect
	 * (overwrite). Includes `led_grid_test.html` and full-character assets (`ch_both_open_green.svg`, `ch_left_closed_green.svg`, …), not the small web UI status eyes.
	 * If empty, the same sync uses `local_media_path` when set (legacy; templates may appear in CLS).
	 */
	local_template_path: '',
	server: {
		httpPort: 4200,
		wsPort: 4200,
		bindAddress: '0.0.0.0',
	},
	/** CasparCG OSC (UDP) — see `src/osc/osc-config.js` for runtime env tweaks */
	osc: {
		enabled: true,
		/** Caspar→HighAsCG; 6251 avoids clashing with Caspar `<default-port>` (6250). */
		listenPort: 6251,
		listenAddress: '0.0.0.0',
		peakHoldMs: 2000,
		emitIntervalMs: 50,
		staleTimeoutMs: 5000,
	},
	/** Web UI toggles (persisted; not sent to Caspar) */
	ui: {
		oscFooterVu: true,
		rundownPlaybackTimer: true,
		/** Dangerous actions in Settings → Nuclear. */
		nuclearRequirePassword: false,
		/** Plain value for now (initial version). Empty means no gate unless require flag is on. */
		nuclearPassword: '',
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
		/** Per main screen (index 0 = screen 1): OpenAL device name for Caspar `<system-audio>`. Empty = default device (`<system-audio />`). */
		programSystemAudioDevices: ['', '', '', ''],
		/** Per screen: route preview (PRV) channel to system audio (OpenAL). */
		previewSystemAudioEnabled: [false, false, false, false],
		/** Per screen: OpenAL device for PRV when previewSystemAudioEnabled; empty = default. */
		previewSystemAudioDevices: ['', '', '', ''],
	},
	/**
	 * X11 layout from System → Apply OS: when true, `xrandr --pos` order is reversed (e.g. two heads: Screen 2 left, Screen 1 right).
	 * Output mappings and Caspar screen indices are unchanged; only horizontal placement changes.
	 */
	x11_horizontal_swap: false,
	/** X11 output for the multiview window when Caspar has one main screen + multiview (see applyX11Layout). */
	multiview_system_id: '',
	multiview_os_mode: '',
	multiview_os_rate: '',
	/** Pixel-map / DMX sampling (persisted; used by Node samplingManager) */
	dmx: {
		enabled: false,
		debugLogDmx: false,
		fps: 25,
		fixtures: [],
	},
	/**
	 * RTMP (FFmpeg) outputs — merged into flat Caspar generator config; each destination targets one channel (PGM/PRV/multiview).
	 */
	rtmp: {
		enabled: false,
		programOutputsEnabled: true,
		previewOutputsEnabled: false,
		multiviewOutputEnabled: true,
		destinations: [
			{
				enabled: false,
				label: 'Encoder 1',
				rtmpServerUrl: '',
				streamKey: '',
				rtmpUrl: '',
				inputTarget: 'program_1',
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioSource: 'muxed',
				audioBitrateKbps: 128,
			},
			{
				enabled: false,
				label: 'Encoder 2',
				rtmpServerUrl: '',
				streamKey: '',
				rtmpUrl: '',
				inputTarget: 'program_1',
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioSource: 'muxed',
				audioBitrateKbps: 128,
			},
			{
				enabled: false,
				label: 'Encoder 3',
				rtmpServerUrl: '',
				streamKey: '',
				rtmpUrl: '',
				inputTarget: 'multiview',
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioSource: 'muxed',
				audioBitrateKbps: 128,
			},
			{
				enabled: false,
				label: 'Encoder 4',
				rtmpServerUrl: '',
				streamKey: '',
				rtmpUrl: '',
				inputTarget: 'program_1',
				videoCodec: 'h264',
				videoBitrateKbps: 4500,
				encoderPreset: 'veryfast',
				audioSource: 'muxed',
				audioBitrateKbps: 128,
			},
		],
	},
	/**
	 * Dedicated CasparCG channel for RTMP + file record (WO-27). Routed from PGM/PRV/MVR; optional DeckLink out.
	 */
	streamingChannel: {
		enabled: false,
		videoMode: '1080p5000',
		/** `program_1` | `preview_1` | `multiview` (requires multiview enabled) */
		videoSource: 'program_1',
		/** `follow_video` | same options as videoSource — when not `follow_video`, may stack layers (WO-27) */
		audioSource: 'follow_video',
		/**
		 * If set, RTMP/record (ADD STREAM/FILE) targets this **existing** Caspar channel; no extra `<channel>`.
		 * If null, see `dedicatedOutputChannel` / auto-resolve from destination + `videoSource`.
		 */
		casparChannel: null,
		/**
		 * Legacy: append a separate last Caspar `<channel>` and stream from that (PLAY route from `videoSource`).
		 * **Default false:** encode the bus you actually built — single `mode: "stream"` destination, else `videoSource`
		 * (e.g. `program_2` → that PGM channel). Avoids `ADD` to a non-existent `nextCh` when the bus is e.g. ch 3.
		 */
		dedicatedOutputChannel: false,
		/** Last RTMP form values (persisted for UI) */
		rtmpServerUrl: '',
		streamKey: '',
		rtmpQuality: 'medium',
		/** Layer for PLAY route://… on the dedicated streaming channel (ignored when `casparChannel` is set) */
		contentLayer: 10,
		/** DeckLink output device index; 0 = none */
		decklinkDevice: 0,
	},
	/**
	 * Device View record outputs. Source is set by cabling (destination -> record output).
	 */
	recordOutputs: [
		{
			id: 'rec_1',
			label: 'Rec1',
			enabled: true,
			name: 'Rec1',
			source: 'program_1',
			crf: 26,
			videoCodec: 'h264',
			videoBitrateKbps: 4500,
			encoderPreset: 'veryfast',
			audioCodec: 'aac',
			audioBitrateKbps: 128,
		},
	],
	/**
	 * PixelHue / PixelFlow (NovaStar Unico) — proxied from HighAsCG so the browser never holds the device JWT.
	 * @see docs/PIXELHUE_API.md
	 */
	pixelhue: {
		enabled: false,
		/** Device hostname or IP (empty = feature off). */
		host: '',
		/** ucenter / discovery (HTTPS, self-signed), default 19998. */
		unicoPort: 19998,
		/**
		 * If set to a number, use this HTTP API port and skip taking it from `device-list`.
		 * If null/empty, the port from discovery (`linkType: http`) is used.
		 */
		apiPort: null,
		/** If multiple switchers in `device-list`, match this serial; empty = first device. */
		targetSerial: '',
	},
	/**
	 * Caspar + PixelHue “symbiosis” topology: logical LED destinations, physical signal paths, EDID notes.
	 * One **destination** row = one PixelHue **layer** for the full Caspar bus (not one PH layer per Caspar stacked clip).
	 * @see work/WO_pixelhue-companion-and-tandem-looks.md
	 */
	tandemTopology: {
		version: 1,
		/** free-form notes; EDID exchange often requires the vendor tool — store labels here. */
		edidNotes: '',
		/**
		 * Logical outputs (e.g. LED wall 1). `pixelhue.layerId` = which PH layer shows that Caspar feed.
		 * `signalPathId` = optional ref into `signalPaths` for the Caspar→PH cable.
		 */
		destinations: [
			{
				id: 'led1',
				label: 'LED wall 1',
				mainScreenIndex: 0,
				caspar: { bus: 'pgm' },
				pixelhue: { layerId: null, screenGuid: '', role: 'caspar_pgm' },
				signalPathId: 'caspar_pgm1_in',
				edidLabel: '',
			},
		],
		/**
		 * Cabling / logical links: which PixelHue `interfaceId` is fed by which Caspar program output, or a camera, etc.
		 */
		signalPaths: [
			{
				id: 'caspar_pgm1_in',
				label: 'Caspar main 1 PGM → switcher input',
				kind: 'caspar_in',
				phInterfaceId: null,
				caspar: { bus: 'pgm', mainIndex: 0 },
				edidLabel: '',
				notes: 'Set phInterfaceId after GET /api/tandem-device populates interfaces from the device.',
			},
		],
	},
	/**
	 * Stable physical GPU connector topology (bottom -> top). Each physical connector can
	 * expose two runtime DP IDs depending on boot/runtime state.
	 */
	gpuPhysicalTopology: [
		{ physicalPortId: 'gpu_p0', slotOrder: 0, dpA: 'DP-6', dpB: 'DP-7', connectorNumber: 0, location: 0 },
		{ physicalPortId: 'gpu_p1', slotOrder: 1, dpA: 'DP-4', dpB: 'DP-5', connectorNumber: 1, location: 1 },
		{ physicalPortId: 'gpu_p2', slotOrder: 2, dpA: 'DP-0', dpB: 'DP-1', connectorNumber: 2, location: 2 },
		{ physicalPortId: 'gpu_p3', slotOrder: 3, dpA: 'DP-2', dpB: 'DP-3', connectorNumber: 3, location: 3 },
	],
	/**
	 * Device view (WO-33): logical back-panel graph — ports, cables, layout.
	 * @see work/33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md
	 */
	deviceGraph: {
		version: 1,
		devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' }],
		connectors: [],
		edges: [],
		layout: {},
	},
}
