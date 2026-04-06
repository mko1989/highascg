/**
 * Settings Modal — multi-tab UI for application configuration.
 * @see 05_WO_LIVE_PREVIEW_SETTINGS.md Phase 4
 * @see 09_WO_OSC_PROTOCOL.md T5.2 (Audio / OSC)
 */

import { api, getApiBase } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { mountSystemSettings } from './system-settings.js'
import { mountVariablesPanel } from './variables-panel.js'

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
					<button class="settings-tab" data-tab="audio">Audio / OSC</button>
					<button class="settings-tab" data-tab="screens">Screens</button>
					<button class="settings-tab" data-tab="system">System</button>
					<button class="settings-tab" data-tab="variables">Variables</button>
					<button class="settings-tab" data-tab="advanced">Advanced</button>
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
							<label>Capture tier</label>
							<select id="set-stream-capture-mode">
								<option value="auto">Auto (local NDI → SRT)</option>
								<option value="local">Local (kmsgrab / x11grab)</option>
								<option value="ndi">NDI (FFmpeg receiver)</option>
								<option value="srt">SRT (CasparCG consumer)</option>
							</select>
							<p class="settings-note">Local prefers <strong>kmsgrab</strong> (DRM) and falls back to <strong>x11grab</strong> on the same machine.</p>
						</div>
						<div class="settings-group">
							<label>NDI source names</label>
							<select id="set-stream-ndi-naming">
								<option value="auto">Auto — discover &amp; match “CasparCG Channel N”</option>
								<option value="pattern">Pattern only</option>
								<option value="custom">Custom per channel</option>
							</select>
						</div>
						<div class="settings-group" id="set-stream-ndi-pattern-wrap">
							<label>NDI name pattern</label>
							<input type="text" id="set-stream-ndi-pattern" placeholder="CasparCG Channel {ch}">
							<p class="settings-note"><code>{ch}</code> is replaced with the Caspar channel number (1, 2, 3…).</p>
						</div>
						<div class="settings-group" id="set-stream-ndi-custom-wrap" style="display:none">
							<label>PGM (ch 1)</label>
							<input type="text" id="set-stream-ndi-ch1" placeholder="CasparCG Channel 1">
							<label style="margin-top:0.5rem">Preview (ch 2)</label>
							<input type="text" id="set-stream-ndi-ch2" placeholder="CasparCG Channel 2">
							<label style="margin-top:0.5rem">Multiview (ch 3)</label>
							<input type="text" id="set-stream-ndi-ch3" placeholder="CasparCG Channel 3">
						</div>
						<div class="settings-group">
							<button type="button" class="btn btn--secondary" id="set-stream-ndi-discover">Discover NDI sources (this server)</button>
							<pre id="set-stream-ndi-discover-out" class="settings-note" style="white-space:pre-wrap;max-height:8rem;overflow:auto;display:none;margin-top:0.5rem"></pre>
						</div>
						<div class="settings-group">
							<label>Quality Preset</label>
							<select id="set-stream-quality">
								<option value="low">Low (Fast)</option>
								<option value="medium">Medium</option>
								<option value="high">High (Better quality)</option>
								<option value="ultrafast">Ultrafast</option>
							</select>
						</div>
						<div class="settings-group checkbox">
							<label><input type="checkbox" id="set-stream-hw"> Use Hardware Acceleration (FFmpeg)</label>
						</div>
						<div class="settings-group">
							<label>Base Port (go2rtc)</label>
							<input type="number" id="set-stream-port" placeholder="8554">
						</div>
					</div>
					<div class="settings-pane" id="settings-pane-audio">
						<p class="settings-note"><strong>Audio output (Caspar)</strong> — used when generating Caspar config. Master is the main program mix; monitor adds a second FFmpeg consumer on the same channel (e.g. headphones). Refresh the device list on this machine after plugging hardware.</p>
						<p class="settings-note"><strong>Master output</strong></p>
						<div class="settings-group">
							<label>Channel layout</label>
							<select id="set-audio-prog-layout">
								<option value="stereo">Stereo (2 ch)</option>
								<option value="4ch">4 ch</option>
								<option value="8ch">8 ch</option>
								<option value="16ch">16 ch</option>
							</select>
						</div>
						<div class="settings-group">
							<label>Output device</label>
							<select id="set-audio-prog-output">
								<option value="default">Default (Caspar / no extra FFmpeg consumer)</option>
								<option value="system_audio">System audio (desktop sink)</option>
								<option value="alsa">ALSA / PipeWire (FFmpeg consumer)</option>
								<option value="ndi">NDI</option>
								<option value="custom">Custom FFmpeg path / args</option>
							</select>
						</div>
						<div class="settings-group" id="set-audio-prog-alsa-wrap" style="display:none">
							<label>ALSA / PipeWire device</label>
							<select id="set-audio-prog-alsa"></select>
							<button type="button" class="btn btn--secondary" id="set-audio-refresh-devices" style="margin-top:0.5rem">Refresh device list</button>
						</div>
						<div class="settings-group" id="set-audio-prog-custom-wrap" style="display:none">
							<label>FFmpeg input path</label>
							<input type="text" id="set-audio-prog-ff-path" placeholder="-f alsa hw:1,0">
							<label style="margin-top:0.5rem">Extra args (optional)</label>
							<input type="text" id="set-audio-prog-ff-args" placeholder="">
						</div>
						<p class="settings-note"><strong>Monitor / headphones</strong> — optional second output (same program mix, separate device).</p>
						<div class="settings-group">
							<label>Monitor output</label>
							<select id="set-audio-monitor-output">
								<option value="default">Off (no second consumer)</option>
								<option value="alsa">ALSA / PipeWire (FFmpeg)</option>
								<option value="custom">Custom FFmpeg path / args</option>
							</select>
						</div>
						<div class="settings-group" id="set-audio-monitor-alsa-wrap" style="display:none">
							<label>ALSA / PipeWire device</label>
							<select id="set-audio-monitor-alsa"></select>
						</div>
						<div class="settings-group" id="set-audio-monitor-custom-wrap" style="display:none">
							<label>FFmpeg input path</label>
							<input type="text" id="set-audio-monitor-ff-path" placeholder="-f alsa hw:0,0">
							<label style="margin-top:0.5rem">Extra args (optional)</label>
							<input type="text" id="set-audio-monitor-ff-args" placeholder="">
						</div>
						<div class="settings-group">
							<label>Browser monitoring preference</label>
							<select id="set-audio-browser-monitor">
								<option value="pgm">PGM</option>
								<option value="off">Off</option>
							</select>
						</div>
						<p class="settings-note"><strong>OSC</strong> (incoming from CasparCG)</p>
						<p class="settings-note">
							OSC from CasparCG to HighAsCG is <strong>required</strong> for mixer, layers, playback, VU, and timers. The UDP listener is always on unless the server was started with
							<code>--no-osc</code> (development only).
						</p>
						<div class="settings-group">
							<label>OSC listen port</label>
							<input type="number" id="set-osc-port" placeholder="6250" min="1" max="65535">
						</div>
						<div class="settings-group">
							<label>UDP bind address</label>
							<input type="text" id="set-osc-bind" placeholder="0.0.0.0">
						</div>
						<div class="settings-group">
							<label>Peak hold (ms)</label>
							<input type="number" id="set-osc-peak" placeholder="2000" min="100" max="30000">
						</div>
						<p class="settings-note">With OSC enabled, the app subscribes automatically: <strong>header PGM timer</strong> (elapsed / total / remaining from the topmost playing layer) and the <strong>Scenes rundown</strong> timer use the same OSC stream — no extra toggles. Use the floating <strong>Audio</strong> control for program master levels.</p>
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
						<div id="set-caspar-screen-rows"></div>
						<div class="settings-group">
							<label><input type="checkbox" id="set-caspar-mv-enabled"> Extra multiview output channel</label>
							<p class="settings-note">Adds one more channel with a screen consumer (Caspar multiview layout is configured separately in Caspar).</p>
						</div>
						<div class="settings-group">
							<label>Multiview video mode</label>
							<select id="set-caspar-mv-mode"></select>
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
						<div class="settings-group">
							<label>Caspar config path on <strong>this</strong> machine (Write &amp; restart)</label>
							<input type="text" id="set-caspar-config-path" placeholder="/opt/casparcg/config/casparcg.config">
							<p class="settings-note">Default: <code>/opt/casparcg/config/casparcg.config</code> (main server; media scanner uses its own config). Override with env <code>CASPAR_CONFIG_PATH</code>. The file is overwritten; then <code>RESTART</code> is sent over AMCP.</p>
						</div>
						<p class="settings-note"><strong>Download</strong> uses the last <em>saved</em> settings (click <strong>Save &amp; Apply</strong> first if you changed values above). <strong>Write &amp; restart</strong> sends the current form to the server, saves it, writes the file, and issues AMCP <code>RESTART</code>.</p>
						<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center">
							<button type="button" class="btn btn--secondary" id="set-caspar-download">Download casparcg.config</button>
							<button type="button" class="btn btn--primary" id="set-caspar-apply">Write &amp; restart Caspar</button>
						</div>
						<p class="settings-note" id="set-caspar-apply-hint" style="display:none;color:#e67e22">Connect to Caspar (disable offline mode) and set the config path to use Write &amp; restart.</p>
					</div>
					<div class="settings-pane" id="settings-pane-system"></div>
					<div class="settings-pane" id="settings-pane-variables"></div>
					<div class="settings-pane" id="settings-pane-advanced">
						<div class="settings-group">
							<label>Periodic Sync Interval (sec)</label>
							<input type="number" id="set-sync-sec" placeholder="10">
						</div>
						<div class="settings-group">
							<label>Sync Interval when OSC active (sec)</label>
							<input type="number" id="set-sync-osc-sec" placeholder="1">
						</div>
					</div>
				</div>
			</div>
			<div class="modal-footer">
				<button class="btn btn--secondary" id="settings-cancel">Cancel</button>
				<button class="btn btn--primary" id="settings-save">Save & Apply</button>
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

	const systemPane = modal.querySelector('#settings-pane-system')
	mountSystemSettings(systemPane)

	const varPane = modal.querySelector('#settings-pane-variables')
	void mountVariablesPanel(varPane).catch(() => {})

	const progOut = modal.querySelector('#set-audio-prog-output')
	const progAlsaWrap = modal.querySelector('#set-audio-prog-alsa-wrap')
	const progCustomWrap = modal.querySelector('#set-audio-prog-custom-wrap')
	const monitorOut = modal.querySelector('#set-audio-monitor-output')
	const monitorAlsaWrap = modal.querySelector('#set-audio-monitor-alsa-wrap')
	const monitorCustomWrap = modal.querySelector('#set-audio-monitor-custom-wrap')

	function syncAudioRoutingVisibility() {
		const po = progOut.value
		progAlsaWrap.style.display = po === 'alsa' ? '' : 'none'
		progCustomWrap.style.display = po === 'custom' ? '' : 'none'
		const mo = monitorOut.value
		monitorAlsaWrap.style.display = mo === 'alsa' ? '' : 'none'
		monitorCustomWrap.style.display = mo === 'custom' ? '' : 'none'
	}

	async function loadAudioDeviceSelects(ar) {
		try {
			const data = await api.get('/api/audio/devices')
			const fill = (sel, current) => {
				const cur = current || ''
				sel.innerHTML = '<option value="">— Select device —</option>'
				for (const d of data.devices || []) {
					const opt = document.createElement('option')
					opt.value = d.id
					opt.textContent = `${d.name} (${d.id})`
					sel.appendChild(opt)
				}
				if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur
			}
			fill(modal.querySelector('#set-audio-prog-alsa'), ar.programAlsaDevice)
			fill(modal.querySelector('#set-audio-monitor-alsa'), ar.monitorAlsaDevice)
		} catch (e) {
			console.warn('[Settings] audio devices:', e)
		}
	}

	function syncNdiNamingVisibility() {
		const mode = modal.querySelector('#set-stream-ndi-naming').value
		modal.querySelector('#set-stream-ndi-custom-wrap').style.display = mode === 'custom' ? 'block' : 'none'
		modal.querySelector('#set-stream-ndi-pattern-wrap').style.display = mode === 'custom' ? 'none' : 'block'
	}

	modal.querySelector('#set-stream-ndi-naming').addEventListener('change', syncNdiNamingVisibility)

	let casparModeChoices = []

	function fillModeSelect(sel) {
		if (!sel) return
		sel.innerHTML = ''
		for (const m of casparModeChoices) {
			const opt = document.createElement('option')
			opt.value = m.id
			opt.textContent = m.label
			sel.appendChild(opt)
		}
	}

	function renderCasparScreenRows(cs) {
		const count = Math.min(4, Math.max(1, parseInt(String(cs?.screen_count || 1), 10) || 1))
		const wrap = modal.querySelector('#set-caspar-screen-rows')
		wrap.innerHTML = ''
		for (let n = 1; n <= count; n++) {
			const mode = cs[`screen_${n}_mode`] || '1080p5000'
			const cw = cs[`screen_${n}_custom_width`] ?? 1920
			const ch = cs[`screen_${n}_custom_height`] ?? 1080
			const cfps = cs[`screen_${n}_custom_fps`] ?? 50
			const deck = cs[`screen_${n}_decklink_device`] ?? 0
			const ndi = cs[`screen_${n}_ndi_enabled`] === true || cs[`screen_${n}_ndi_enabled`] === 'true'
			const ndiName = String(cs[`screen_${n}_ndi_name`] || `HighAsCG-CH${n}`)
			const div = document.createElement('div')
			div.className = 'settings-group'
			div.style.borderLeft = '3px solid #444'
			div.style.paddingLeft = '0.75rem'
			div.style.marginBottom = '0.75rem'
			div.innerHTML =
				`<h4 style="margin:0 0 0.4rem;font-size:13px">Screen ${n} (PGM output)</h4>` +
				`<label>Video mode</label>` +
				`<select id="set-caspar-screen-${n}-mode"></select>` +
				`<div id="set-caspar-screen-${n}-custom-wrap" style="display:none;margin-top:0.5rem">` +
				`<label>Custom width (px)</label>` +
				`<input type="number" id="set-caspar-screen-${n}-cw" min="1" max="16384" step="1" value="${cw}">` +
				`<label style="margin-top:0.5rem">Custom height (px)</label>` +
				`<input type="number" id="set-caspar-screen-${n}-ch" min="1" max="16384" step="1" value="${ch}">` +
				`<label style="margin-top:0.5rem">Frame rate (fps)</label>` +
				`<input type="number" id="set-caspar-screen-${n}-cfps" min="1" max="240" step="0.01" value="${cfps}">` +
				`</div>` +
				`<label style="margin-top:0.5rem">Decklink device index (0 = none)</label>` +
				`<input type="number" id="set-caspar-screen-${n}-decklink" min="0" max="8" value="${deck}">` +
				`<label style="margin-top:0.5rem;display:inline-flex;align-items:center;gap:0.35rem">` +
				`<input type="checkbox" id="set-caspar-screen-${n}-ndi"> NDI output</label>` +
				`<label style="margin-top:0.5rem">NDI name</label>` +
				`<input type="text" id="set-caspar-screen-${n}-ndi-name">`
			wrap.appendChild(div)
			div.querySelector(`#set-caspar-screen-${n}-ndi-name`).value = ndiName
			const sel = div.querySelector(`#set-caspar-screen-${n}-mode`)
			fillModeSelect(sel)
			if ([...sel.options].some((o) => o.value === mode)) sel.value = mode
			else sel.value = '1080p5000'
			div.querySelector(`#set-caspar-screen-${n}-ndi`).checked = ndi
			const customWrap = div.querySelector(`#set-caspar-screen-${n}-custom-wrap`)
			function syncCustomVisibility() {
				const show = sel.value === 'custom'
				if (customWrap) customWrap.style.display = show ? 'block' : 'none'
			}
			syncCustomVisibility()
			sel.addEventListener('change', syncCustomVisibility)
		}
		modal.querySelector('#set-caspar-screen-count').value = String(count)
	}

	function collectCasparServerFromUI() {
		const cs = {}
		cs.screen_count = parseInt(modal.querySelector('#set-caspar-screen-count').value, 10) || 1
		cs.multiview_enabled = modal.querySelector('#set-caspar-mv-enabled').checked
		cs.multiview_mode = modal.querySelector('#set-caspar-mv-mode').value
		cs.decklink_input_count = parseInt(modal.querySelector('#set-caspar-dl-inputs').value, 10) || 0
		cs.inputs_channel_mode = modal.querySelector('#set-caspar-inputs-mode').value
		cs.configPath = modal.querySelector('#set-caspar-config-path').value.trim()
		for (let n = 1; n <= 4; n++) {
			const modeEl = modal.querySelector(`#set-caspar-screen-${n}-mode`)
			if (!modeEl) continue
			cs[`screen_${n}_mode`] = modeEl.value
			const cwEl = modal.querySelector(`#set-caspar-screen-${n}-cw`)
			const chEl = modal.querySelector(`#set-caspar-screen-${n}-ch`)
			const cfpsEl = modal.querySelector(`#set-caspar-screen-${n}-cfps`)
			if (cwEl) cs[`screen_${n}_custom_width`] = parseInt(String(cwEl.value), 10) || 1920
			if (chEl) cs[`screen_${n}_custom_height`] = parseInt(String(chEl.value), 10) || 1080
			if (cfpsEl) cs[`screen_${n}_custom_fps`] = parseFloat(String(cfpsEl.value)) || 50
			cs[`screen_${n}_decklink_device`] = parseInt(
				modal.querySelector(`#set-caspar-screen-${n}-decklink`).value,
				10
			) || 0
			cs[`screen_${n}_ndi_enabled`] = modal.querySelector(`#set-caspar-screen-${n}-ndi`).checked
			cs[`screen_${n}_ndi_name`] =
				modal.querySelector(`#set-caspar-screen-${n}-ndi-name`).value.trim() || `HighAsCG-CH${n}`
		}
		return cs
	}

	async function loadCasparModes() {
		try {
			const r = await api.get('/api/caspar-config/mode-choices')
			casparModeChoices = r.modes || []
		} catch (e) {
			console.warn('[Settings] caspar modes', e)
			casparModeChoices = [{ id: '1080p5000', label: '1080p5000' }]
		}
		fillModeSelect(modal.querySelector('#set-caspar-mv-mode'))
		fillModeSelect(modal.querySelector('#set-caspar-inputs-mode'))
	}

	function updateCasparApplyHint() {
		const offline = modal.querySelector('#set-offline-mode').checked
		modal.querySelector('#set-caspar-apply-hint').style.display = offline ? 'block' : 'none'
	}

	modal.querySelector('#set-caspar-screen-count').addEventListener('change', () => {
		const cur = collectCasparServerFromUI()
		cur.screen_count = parseInt(modal.querySelector('#set-caspar-screen-count').value, 10) || 1
		renderCasparScreenRows(cur)
	})

	modal.querySelector('#set-offline-mode').addEventListener('change', updateCasparApplyHint)

	modal.querySelector('#set-caspar-download').addEventListener('click', async () => {
		try {
			const url = getApiBase() + '/api/caspar-config/generate?download=1'
			const res = await fetch(url)
			if (!res.ok) {
				let detail = res.statusText
				try {
					const j = await res.json()
					if (j.error) detail = j.error
				} catch {}
				throw new Error(detail)
			}
			const blob = await res.blob()
			const a = document.createElement('a')
			a.href = URL.createObjectURL(blob)
			a.download = 'casparcg.config'
			a.click()
			URL.revokeObjectURL(a.href)
		} catch (e) {
			alert('Download failed: ' + e.message)
		}
	})

	modal.querySelector('#set-caspar-apply').addEventListener('click', async () => {
		if (!confirm('Overwrite the Caspar config file on this machine and send RESTART? Caspar will reload.')) return
		try {
			const casparServer = collectCasparServerFromUI()
			const res = await api.post('/api/caspar-config/apply', { casparServer })
			alert(res.message || 'OK')
		} catch (e) {
			alert('Apply failed: ' + e.message)
		}
	})

	modal.querySelector('#set-stream-ndi-discover').addEventListener('click', async () => {
		const pre = modal.querySelector('#set-stream-ndi-discover-out')
		pre.style.display = 'block'
		pre.textContent = 'Scanning…'
		try {
			const r = await api.get('/api/streaming/ndi-sources')
			if (r.sources && r.sources.length) pre.textContent = r.sources.join('\n')
			else pre.textContent = r.error || 'No sources found. Ensure FFmpeg has NDI (libndi) and sources are on the network.'
		} catch (e) {
			pre.textContent = e.message || String(e)
		}
	})

	progOut.addEventListener('change', syncAudioRoutingVisibility)
	monitorOut.addEventListener('change', syncAudioRoutingVisibility)
	modal.querySelector('#set-audio-refresh-devices').addEventListener('click', async () => {
		const ar = {
			programAlsaDevice: modal.querySelector('#set-audio-prog-alsa').value,
			monitorAlsaDevice: modal.querySelector('#set-audio-monitor-alsa').value,
		}
		await loadAudioDeviceSelects(ar)
	})

	async function load() {
		try {
			const cfg = await api.get('/api/settings')
			await loadCasparModes()
			const cs = cfg.casparServer || {}
			modal.querySelector('#set-caspar-mv-enabled').checked =
				cs.multiview_enabled !== false && cs.multiview_enabled !== 'false'
			const mv = cs.multiview_mode || '1080p5000'
			const mvSel = modal.querySelector('#set-caspar-mv-mode')
			if ([...mvSel.options].some((o) => o.value === mv)) mvSel.value = mv
			modal.querySelector('#set-caspar-dl-inputs').value = String(cs.decklink_input_count ?? 0)
			const im = cs.inputs_channel_mode || '1080p5000'
			const inSel = modal.querySelector('#set-caspar-inputs-mode')
			if ([...inSel.options].some((o) => o.value === im)) inSel.value = im
			modal.querySelector('#set-caspar-config-path').value = cs.configPath || ''
			renderCasparScreenRows(cs)
			modal.querySelector('#set-caspar-host').value = cfg.caspar.host
			modal.querySelector('#set-caspar-port').value = cfg.caspar.port
			modal.querySelector('#set-stream-enabled').checked = cfg.streaming.enabled
			modal.querySelector('#set-stream-capture-mode').value = cfg.streaming.captureMode || 'auto'
			modal.querySelector('#set-stream-ndi-naming').value = cfg.streaming.ndiNamingMode || 'auto'
			modal.querySelector('#set-stream-ndi-pattern').value = cfg.streaming.ndiSourcePattern || 'CasparCG Channel {ch}'
			const ndiN = cfg.streaming.ndiChannelNames || {}
			modal.querySelector('#set-stream-ndi-ch1').value = ndiN['1'] || ndiN[1] || ''
			modal.querySelector('#set-stream-ndi-ch2').value = ndiN['2'] || ndiN[2] || ''
			modal.querySelector('#set-stream-ndi-ch3').value = ndiN['3'] || ndiN[3] || ''
			syncNdiNamingVisibility()
			modal.querySelector('#set-stream-ndi-discover-out').style.display = 'none'
			modal.querySelector('#set-stream-quality').value = cfg.streaming.quality
			modal.querySelector('#set-stream-hw').checked = cfg.streaming.hardware_accel
			modal.querySelector('#set-stream-port').value = cfg.streaming.basePort
			modal.querySelector('#set-sync-sec').value = cfg.periodic_sync_interval_sec || ''
			modal.querySelector('#set-sync-osc-sec').value = cfg.periodic_sync_interval_sec_osc || ''
			modal.querySelector('#set-offline-mode').checked = !!cfg.offline_mode
			updateCasparApplyHint()
			const osc = cfg.osc || {}
			modal.querySelector('#set-osc-port').value = osc.listenPort ?? 6250
			modal.querySelector('#set-osc-bind').value = osc.listenAddress || '0.0.0.0'
			modal.querySelector('#set-osc-peak').value = osc.peakHoldMs ?? 2000
			const ui = cfg.ui || {}
			const ar = cfg.audioRouting || {}
			modal.querySelector('#set-audio-prog-layout').value = ar.programLayout || 'stereo'
			modal.querySelector('#set-audio-prog-output').value = ar.programOutput || 'default'
			modal.querySelector('#set-audio-prog-ff-path').value = ar.programFfmpegPath || ''
			modal.querySelector('#set-audio-prog-ff-args').value = ar.programFfmpegArgs || ''
			modal.querySelector('#set-audio-monitor-output').value = ar.monitorOutput || 'default'
			modal.querySelector('#set-audio-monitor-ff-path').value = ar.monitorFfmpegPath || ''
			modal.querySelector('#set-audio-monitor-ff-args').value = ar.monitorFfmpegArgs || ''
			modal.querySelector('#set-audio-browser-monitor').value = ar.browserMonitor || 'pgm'
			await loadAudioDeviceSelects(ar)
			syncAudioRoutingVisibility()
		} catch (e) {
			console.error('Failed to load settings:', e)
		}
	}
	load()

	modal.querySelector('#settings-save').onclick = async () => {
		const settings = {
			caspar: {
				host: modal.querySelector('#set-caspar-host').value,
				port: modal.querySelector('#set-caspar-port').value,
			},
			streaming: {
				enabled: modal.querySelector('#set-stream-enabled').checked,
				captureMode: modal.querySelector('#set-stream-capture-mode').value,
				ndiNamingMode: modal.querySelector('#set-stream-ndi-naming').value,
				ndiSourcePattern: modal.querySelector('#set-stream-ndi-pattern').value,
				ndiChannelNames: (() => {
					const o = {}
					const a = modal.querySelector('#set-stream-ndi-ch1').value.trim()
					const b = modal.querySelector('#set-stream-ndi-ch2').value.trim()
					const c = modal.querySelector('#set-stream-ndi-ch3').value.trim()
					if (a) o['1'] = a
					if (b) o['2'] = b
					if (c) o['3'] = c
					return o
				})(),
				quality: modal.querySelector('#set-stream-quality').value,
				basePort: modal.querySelector('#set-stream-port').value,
				hardware_accel: modal.querySelector('#set-stream-hw').checked,
			},
			periodic_sync_interval_sec: modal.querySelector('#set-sync-sec').value,
			periodic_sync_interval_sec_osc: modal.querySelector('#set-sync-osc-sec').value,
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
			audioRouting: {
				programLayout: modal.querySelector('#set-audio-prog-layout').value,
				programOutput: modal.querySelector('#set-audio-prog-output').value,
				programAlsaDevice: modal.querySelector('#set-audio-prog-alsa').value,
				programFfmpegPath: modal.querySelector('#set-audio-prog-ff-path').value,
				programFfmpegArgs: modal.querySelector('#set-audio-prog-ff-args').value,
				monitorOutput: modal.querySelector('#set-audio-monitor-output').value,
				monitorAlsaDevice: modal.querySelector('#set-audio-monitor-alsa').value,
				monitorFfmpegPath: modal.querySelector('#set-audio-monitor-ff-path').value,
				monitorFfmpegArgs: modal.querySelector('#set-audio-monitor-ff-args').value,
				browserMonitor: modal.querySelector('#set-audio-browser-monitor').value,
			},
			casparServer: collectCasparServerFromUI(),
		}

		// T4.2: Merge system mappings from component
		if (systemPane.getSystemSettings) {
			Object.assign(settings, systemPane.getSystemSettings())
		}

		try {
			const res = await api.post('/api/settings', settings)
			if (res.ok) {
				const lines = []
				if (res.sideEffects?.length) lines.push(...res.sideEffects)
				if (res.oscRestarted) lines.push('OSC listener restarted.')
				if (lines.length) alert('Settings saved.\n\n' + lines.join('\n'))
				else alert('Settings saved.')
				await settingsState.load()
				document.dispatchEvent(new CustomEvent('highascg-settings-applied', { detail: res }))
				close()
			} else {
				alert('Error: ' + (res.error || 'Unknown error'))
			}
		} catch (e) {
			alert('Failed to save: ' + e.message)
		}
	}
}
