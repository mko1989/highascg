/**
 * Settings Modal — multi-tab UI for application configuration.
 * @see 05_WO_LIVE_PREVIEW_SETTINGS.md Phase 4
 * @see 09_WO_OSC_PROTOCOL.md T5.2 (Audio / OSC)
 */

import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { mountSystemSettings, refreshSystemTabOpenal } from './system-settings.js'
import { mountVariablesPanel } from './variables-panel.js'
import {
	buildCasparServerPayload,
	collectOpenalAudioRoutingFromModal,
	hydrateCasparSettingsFromConfig,
	loadCasparModes,
	updateCasparApplyHint,
	wireCasparSettingsModal,
} from './settings-modal-caspar-ui.js'

export function showSettingsModal() {
	const existing = document.getElementById('settings-modal')
	if (existing) return

	const modal = document.createElement('div')
	modal.id = 'settings-modal'
	modal.className = 'modal-overlay'
	modal.innerHTML = `
		<div class="modal-content settings-modal">
			<div class="modal-header">
				<h2>Application Settings</h2>
				<button class="modal-close" id="settings-close">&times;</button>
			</div>
			<div class="modal-body settings-body">
				<div class="settings-tabs">
					<button class="settings-tab active" data-tab="connection">Connection</button>
					<button class="settings-tab" data-tab="streaming">Preview streaming</button>
					<button class="settings-tab" data-tab="audio">OSC</button>
					<button class="settings-tab" data-tab="screens">Screens</button>
					<button class="settings-tab" data-tab="companion">Companion</button>
					<button class="settings-tab" data-tab="system">System</button>
					<button class="settings-tab" data-tab="variables">Variables</button>
				</div>
				<div class="settings-panes">
					<div class="settings-pane active" id="settings-pane-connection">
						<div class="settings-group">
							<label>CasparCG Host</label>
							<input type="text" id="set-caspar-host" placeholder="127.0.0.1">
						</div>
						<div class="settings-group">
							<label>AMCP Port</label>
							<input type="number" id="set-caspar-port" placeholder="5250">
						</div>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-offline-mode"> <strong>Work Offline (Preparation Mode)</strong></label>
							<p class="settings-note">Use cached metadata and simulated playout when the server is unavailable.</p>
						</div>
					</div>
					<div class="settings-pane" id="settings-pane-streaming">
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-stream-enabled"> Enable Live Preview (WebRTC)</label>
						</div>
						<div class="settings-group">
							<p class="settings-note" style="margin-top:0">
								Preview uses <strong>CasparCG STREAM</strong> (MPEG-TS over UDP on localhost) into <strong>go2rtc</strong>, then WebRTC in the browser.
								Channel numbers follow <strong>Screens</strong> (PGM / PRV / multiview) — they are not hardcoded to 1/2/3.
							</p>
						</div>
						<div class="settings-group">
							<label>Quality Preset</label>
							<select id="set-stream-quality">
								<option value="preview">Preview (½ res, 1 fps — lowest load)</option>
								<option value="low">Low (½ res, 15 fps)</option>
								<option value="medium">Medium (½ res — default)</option>
								<option value="high">High (½ res, higher bitrate)</option>
								<option value="native">Native (full resolution — heavier)</option>
								<option value="ultrafast">Ultrafast (½ res, minimal bitrate)</option>
							</select>
							<p class="settings-note">
								<strong>Preview</strong> is meant for monitoring layout with minimal CPU/bitrate (1&nbsp;fps). <strong>Default presets</strong> encode at <strong>half</strong> width and height of each channel (e.g. 3840×768 → 1920×384). Choose <strong>Native</strong> only if you need full-size WebRTC.
							</p>
						</div>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-stream-hw"> Use Hardware Acceleration (FFmpeg)</label>
						</div>
						<div class="settings-group">
							<label>Base Port (go2rtc)</label>
							<input type="number" id="set-stream-port" placeholder="8554">
							<p class="settings-note">
								Preview uses UDP <strong>base+1</strong> (PGM), <strong>base+2</strong> (preview), <strong>base+5</strong> (multiview). Caspar also binds a high <strong>localport</strong> (destination+10000) per stream.
								Stale <code>STREAM</code> consumers can leave Caspar holding old ports (see <code>ss -ulpn</code>). Change the base, or enable auto-relocation below.
							</p>
						</div>
						<div class="settings-group checkbox">
							<label
								><input type="checkbox" id="set-stream-auto-relocate" checked /> Auto-relocate base port if UDP
								ports are busy</label
							>
							<p class="settings-note">
								When enabled, HighAsCG probes those three UDP ports before starting preview; if they are taken, it scans upward for a free block and logs the effective base (no config file change). Disable to fail fast instead.
								Env: <code>HIGHASCG_STREAMING_AUTO_RELOCATE=0</code> turns this off.
							</p>
						</div>
						<div class="settings-group">
							<label>go2rtc log level</label>
							<select id="set-stream-go2rtc-log">
								<option value="">Default (no extra log block in go2rtc.yaml)</option>
								<option value="trace">trace</option>
								<option value="debug">debug</option>
								<option value="info">info</option>
								<option value="warn">warn</option>
								<option value="error">error</option>
							</select>
							<p class="settings-note">Applied when streaming starts — written into <code>go2rtc.yaml</code> (regenerated each time). Use <strong>debug</strong> or <strong>trace</strong> for WebRTC/ffmpeg details. Or set env <code>HIGHASCG_GO2RTC_LOG_LEVEL</code>. Do not edit <code>go2rtc.yaml</code> by hand; it will be overwritten.</p>
						</div>
					</div>
					<div class="settings-pane" id="settings-pane-audio">
						<div class="settings-group">
							<label>OSC listen port</label>
							<input type="number" id="set-osc-port" placeholder="6251" min="1" max="65535">
						</div>
						<div class="settings-group">
							<label>UDP bind address</label>
							<input type="text" id="set-osc-bind" placeholder="0.0.0.0">
						</div>
						<div class="settings-group">
							<label>Peak hold (ms)</label>
							<input type="number" id="set-osc-peak" placeholder="2000" min="100" max="30000">
						</div>
					</div>
					<div class="settings-pane" id="settings-pane-screens">
						<p class="settings-note">These values feed the <strong>generated CasparCG configuration</strong> (channels, consumers, Decklink/NDI, multiview, OSC block). <strong>Audio / OSC</strong> tab settings (master/monitor routing) and <strong>OSC listen port</strong> are merged into the same file. <strong>Same machine as Caspar:</strong> set the config path and use <em>Write &amp; restart</em>. <strong>Offline preparation</strong> (no server): design here, <em>Download</em> the file, and install it when you have access to the playout machine.</p>
						<div class="settings-group">
							<label>Number of main screen pairs (each pair = PGM + Preview channels)</label>
							<select id="set-caspar-screen-count">
								<option value="1">1 pair (2 channels)</option>
								<option value="2">2 pairs (4 channels)</option>
								<option value="3">3 pairs (6 channels)</option>
								<option value="4">4 pairs (8 channels)</option>
							</select>
						</div>
						<p class="settings-note" style="margin-top:-0.25rem">
							<strong>Caspar server build</strong> (stock vs custom PR binary) lives under <strong>System</strong> → Caspar config deploy — same control, easier to find.
						</p>
						<div id="set-caspar-screen-rows"></div>
						<div class="settings-group">
							<label><input type="checkbox" id="set-caspar-mv-enabled"> Extra multiview output channel</label>
							<p class="settings-note">Adds one more channel for the multiview composite (layout is pushed from the Multiview editor). Choose below whether Caspar also opens a physical screen window.</p>
						</div>
						<div class="settings-group" id="set-caspar-mv-output-wrap">
							<label>Multiview in Caspar</label>
							<select id="set-caspar-mv-output">
								<option value="screen_stream">Screen window + preview stream (when streaming enabled)</option>
								<option value="stream_only">Stream only (no screen consumer)</option>
							</select>
							<p class="settings-note">
								<strong>Stream only</strong> generates a multiview channel with the FFmpeg/SRT consumer used for WebRTC — no <code>&lt;screen&gt;</code>, so Caspar does not create a window. Requires
								<strong>Preview streaming</strong> enabled; otherwise the installer falls back to a screen consumer so the channel stays valid.
							</p>
						</div>
						<div class="settings-group">
							<label>Multiview video mode</label>
							<select id="set-caspar-mv-mode"></select>
						</div>
						<div class="settings-group" id="set-caspar-mv-consumer-wrap">
							<h4 style="margin:0 0 0.4rem;font-size:13px">Multiview screen consumer</h4>
							<p class="settings-note" style="margin-bottom:0.5rem">Same window options as PGM screen outputs (generated <code>&lt;screen&gt;</code> for the multiview channel).</p>
							<label style="display:inline-flex;align-items:center;gap:0.35rem">
								<input type="checkbox" id="set-caspar-mv-windowed"> Windowed</label>
							<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">
								<input type="checkbox" id="set-caspar-mv-vsync"> V-sync</label>
							<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">
								<input type="checkbox" id="set-caspar-mv-borderless"> Borderless</label>
							<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">
								<input type="checkbox" id="set-caspar-mv-aot"> Always on top</label>
							<label style="margin-top:0.5rem">Window X (px, empty = auto)</label>
							<input type="number" id="set-caspar-mv-px" step="1" placeholder="auto">
							<label style="margin-top:0.5rem">Window Y (px, empty = auto)</label>
							<input type="number" id="set-caspar-mv-py" step="1" placeholder="auto">
						</div>
						<div class="settings-group">
							<label>Decklink input channels (live inputs)</label>
							<input type="number" id="set-caspar-dl-inputs" min="0" max="8" value="0">
							<p class="settings-note">Adds empty Decklink-style input channel(s) after program/preview/multiview. Set 0 if you only use file playback.</p>
						</div>
						<div class="settings-group">
							<label>Input channel video mode (when inputs &gt; 0)</label>
							<select id="set-caspar-inputs-mode"></select>
						</div>
						<p class="settings-note">To <strong>write</strong> <code>casparcg.config</code> on the server and restart Caspar, use <strong>System</strong> → Write &amp; restart. Use <strong>Download</strong> there for a file copy.</p>
					</div>
					<div class="settings-pane" id="settings-pane-companion">
						<p class="settings-note">Configure the <strong>Companion</strong> instance that HighAsCG connects to for button press actions triggered by timeline flags. Companion must be running with its HTTP API enabled at the configured address.</p>
						<div class="settings-group">
							<label>Companion Host</label>
							<input type="text" id="set-companion-host" placeholder="127.0.0.1">
						</div>
						<div class="settings-group">
							<label>Companion Port</label>
							<input type="number" id="set-companion-port" placeholder="8000" min="1" max="65535">
						</div>
						<p class="settings-note">Uses Companion v3's HTTP API: <code>POST /api/location/&lt;page&gt;/&lt;row&gt;/&lt;column&gt;/press</code>. No authentication required for local connections.</p>
					</div>
					<div class="settings-pane" id="settings-pane-system">
						<div id="settings-caspar-deploy" class="settings-caspar-deploy" style="margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:1px solid var(--border-muted,#30363d)">
							<p class="settings-note">Deploy the <strong>generated</strong> Caspar config (screens / multiview / OSC merged from this app). HighAsCG-specific options auto-save from other tabs; this writes the XML file and restarts Caspar.</p>
							<div class="settings-group" id="set-caspar-build-profile-wrap">
								<label>Caspar server build</label>
								<select id="set-caspar-build-profile">
									<option value="stock">Stock CasparCG 2.5 (release)</option>
									<option value="custom_live">Custom build (PRs #1718–#1720)</option>
								</select>
								<p class="settings-note">Use <strong>Custom</strong> only with a matching <code>casparcg-server</code> binary. Generated XML adds <code>&lt;portaudio&gt;</code> (ASIO) and optional <code>&lt;aspect-ratio&gt;</code> / <code>&lt;enable-mipmaps&gt;</code> inside <code>&lt;screen&gt;</code>. Stock Caspar will not accept those tags. Per-screen PortAudio and aspect options are on the <strong>Screens</strong> tab.</p>
							</div>
							<div class="settings-group">
								<label>Caspar config path on the <strong>server</strong></label>
								<input type="text" id="set-caspar-config-path" placeholder="/opt/casparcg/config/casparcg.config">
								<p class="settings-note">Saved path here is used first. If empty, <code>CASPAR_CONFIG_PATH</code> on the HighAsCG process is used; otherwise default <code>/opt/casparcg/config/casparcg.config</code>. The file is overwritten; then <code>RESTART</code> is sent over AMCP.</p>
							</div>
							<div class="settings-group checkbox">
								<label><input type="checkbox" id="set-caspar-ndi-auto-load" checked /> <strong>Enable NDI auto-load</strong></label>
								<p class="settings-note">Sets <code>&lt;ndi&gt;&lt;auto-load&gt;true/false&lt;/auto-load&gt;&lt;/ndi&gt;</code> in the generated Caspar config (load NDI at startup). Disable if you do not use NDI and want to avoid loading the NDI runtime.</p>
							</div>
							<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
								<button type="button" class="btn btn--secondary" id="set-caspar-download">Download casparcg.config</button>
								<button type="button" class="btn btn--primary" id="set-caspar-apply">Write &amp; restart Caspar</button>
							</div>
							<p class="settings-note" id="set-caspar-apply-hint" style="display:none;color:#e67e22">Connect to Caspar (disable offline mode) and set the config path to use Write &amp; restart.</p>
						</div>
						<div id="system-settings-mount"></div>
					</div>
					<div class="settings-pane" id="settings-pane-variables"></div>
				</div>
			</div>
			<div class="modal-footer">
				<button class="btn btn--secondary" id="settings-cancel">Close</button>
				<span class="settings-autosave-hint" id="settings-save-status" style="font-size:12px;color:var(--text-muted,#8b949e);margin-left:auto"></span>
			</div>
		</div>
	`
	document.body.appendChild(modal)

	const close = () => modal.remove()
	modal.querySelector('#settings-close').onclick = close
	modal.querySelector('#settings-cancel').onclick = close

	const tabs = modal.querySelectorAll('.settings-tab')
	const panes = modal.querySelectorAll('.settings-pane')
	tabs.forEach((t) => {
		t.onclick = () => {
			tabs.forEach((x) => x.classList.remove('active'))
			panes.forEach((x) => x.classList.remove('active'))
			t.classList.add('active')
			modal.querySelector(`#settings-pane-${t.dataset.tab}`).classList.add('active')
		}
	})

	wireCasparSettingsModal(modal)

	const systemPane = modal.querySelector('#settings-pane-system')
	const systemMount = modal.querySelector('#system-settings-mount')
	const systemSettingsHost = systemMount || systemPane
	let autosaveSuspended = true

	const varPane = modal.querySelector('#settings-pane-variables')

	function buildSettingsPayload() {
		const prevAr = settingsState.getSettings()?.audioRouting || {}
		const openalAr = collectOpenalAudioRoutingFromModal(modal)
		const prevStream = settingsState.getSettings()?.streaming || {}
		const prevAll = settingsState.getSettings() || {}
		const settings = {
			caspar: {
				host: modal.querySelector('#set-caspar-host').value,
				port: modal.querySelector('#set-caspar-port').value,
			},
			streaming: {
				...prevStream,
				enabled: modal.querySelector('#set-stream-enabled').checked,
				captureMode: 'udp',
				quality: modal.querySelector('#set-stream-quality').value,
				basePort: modal.querySelector('#set-stream-port').value,
				hardware_accel: modal.querySelector('#set-stream-hw').checked,
				go2rtcLogLevel: (modal.querySelector('#set-stream-go2rtc-log') || {}).value ?? '',
				autoRelocateBasePort: (modal.querySelector('#set-stream-auto-relocate') || {}).checked ?? true,
			},
			periodic_sync_interval_sec: prevAll.periodic_sync_interval_sec ?? '',
			periodic_sync_interval_sec_osc: prevAll.periodic_sync_interval_sec_osc ?? '',
			offline_mode: modal.querySelector('#set-offline-mode').checked,
			osc: {
				listenPort: modal.querySelector('#set-osc-port').value,
				listenAddress: modal.querySelector('#set-osc-bind').value,
				peakHoldMs: modal.querySelector('#set-osc-peak').value,
			},
			ui: {
				oscFooterVu: true,
				rundownPlaybackTimer: true,
			},
			companion: {
				host: modal.querySelector('#set-companion-host').value || '127.0.0.1',
				port: parseInt(modal.querySelector('#set-companion-port').value, 10) || 8000,
			},
			audioRouting: { ...prevAr, ...openalAr },
			dmx: JSON.parse(
				JSON.stringify(
					settingsState.getSettings()?.dmx || {
						enabled: false,
						debugLogDmx: false,
						fps: 25,
						fixtures: [],
					}
				)
			),
			casparServer: buildCasparServerPayload(modal),
		}
		if (systemSettingsHost.getSystemSettings) Object.assign(settings, systemSettingsHost.getSystemSettings())
		return settings
	}

	const saveStatusEl = modal.querySelector('#settings-save-status')
	let autosaveTimer = null

	async function persistSettings() {
		const settings = buildSettingsPayload()
		try {
			const res = await api.post('/api/settings', settings)
			if (res.ok) {
				if (res.sideEffects?.length || res.oscRestarted) {
					const lines = []
					if (res.sideEffects?.length) lines.push(...res.sideEffects)
					if (res.oscRestarted) lines.push('OSC listener restarted.')
					if (lines.length) console.info('[Settings]', lines.join('\n'))
				}
				await settingsState.load()
				document.dispatchEvent(new CustomEvent('highascg-settings-applied', { detail: res }))
				const cs = settings.casparServer || {}
				if (
					String(cs.default_alsa_card ?? '').trim() !== '' &&
					String(cs.default_alsa_device ?? '').trim() !== ''
				) {
					try {
						await api.post('/api/audio/default-device', {
							card: parseInt(String(cs.default_alsa_card), 10),
							device: parseInt(String(cs.default_alsa_device), 10),
						})
					} catch (e) {
						console.warn('[Settings] ALSA default apply:', e)
						if (saveStatusEl) {
							saveStatusEl.textContent = 'Saved; ~/.asoundrc not written — check home directory permissions'
							clearTimeout(saveStatusEl._hideT)
							saveStatusEl._hideT = setTimeout(() => {
								saveStatusEl.textContent = ''
							}, 6000)
						}
					}
				}
				if (saveStatusEl) {
					saveStatusEl.textContent = 'Saved'
					clearTimeout(saveStatusEl._hideT)
					saveStatusEl._hideT = setTimeout(() => {
						saveStatusEl.textContent = ''
					}, 1800)
				}
			}
		} catch (e) {
			if (saveStatusEl) saveStatusEl.textContent = 'Save failed'
			console.error('[Settings]', e)
		}
	}

	function scheduleAutoSave() {
		if (autosaveSuspended) return
		clearTimeout(autosaveTimer)
		autosaveTimer = setTimeout(() => {
			autosaveTimer = null
			void persistSettings()
		}, 600)
	}

	modal.addEventListener('input', (e) => {
		if (e.target.closest('#settings-pane-variables')) return
		scheduleAutoSave()
	})
	modal.addEventListener('change', (e) => {
		if (e.target.closest('#settings-pane-variables')) return
		scheduleAutoSave()
	})

	async function load() {
		try {
			const cfg = await api.get('/api/settings')
			await loadCasparModes(modal)
			hydrateCasparSettingsFromConfig(modal, cfg)
			modal.querySelector('#set-caspar-host').value = cfg.caspar.host
			modal.querySelector('#set-caspar-port').value = cfg.caspar.port
			modal.querySelector('#set-stream-enabled').checked = cfg.streaming.enabled
			modal.querySelector('#set-stream-quality').value = cfg.streaming.quality
			modal.querySelector('#set-stream-hw').checked = cfg.streaming.hardware_accel
			modal.querySelector('#set-stream-port').value = cfg.streaming.basePort
			const g2l = modal.querySelector('#set-stream-go2rtc-log')
			if (g2l) g2l.value = cfg.streaming.go2rtcLogLevel || ''
			const arEl = modal.querySelector('#set-stream-auto-relocate')
			if (arEl) arEl.checked = cfg.streaming.autoRelocateBasePort !== false
			modal.querySelector('#set-offline-mode').checked = !!cfg.offline_mode
			updateCasparApplyHint(modal)
			const osc = cfg.osc || {}
			modal.querySelector('#set-osc-port').value = osc.listenPort ?? 6251
			modal.querySelector('#set-osc-bind').value = osc.listenAddress || '0.0.0.0'
			modal.querySelector('#set-osc-peak').value = osc.peakHoldMs ?? 2000
			const comp = cfg.companion || {}
			modal.querySelector('#set-companion-host').value = comp.host || '127.0.0.1'
			modal.querySelector('#set-companion-port').value = comp.port || 8000
		} catch (e) {
			console.error('Failed to load settings:', e)
		}
	}

	void (async () => {
		try {
			await mountSystemSettings(systemSettingsHost)
		} catch (e) {
			console.error('[Settings] system tab', e)
		}
		void mountVariablesPanel(varPane).catch(() => {})
		await load()
		autosaveSuspended = false
	})()
}
