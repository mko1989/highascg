/**
 * System Settings — manages OS-level hardware mapping (monitors, X11 layout).
 * @see 11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md Phase 4
 */

import { api } from '../lib/api-client.js'
import { getVariableStore } from '../lib/variable-state.js'
import { ws } from '../app.js'
import { drmShort, findDisplayDetail, multiviewUiShowsScreenRow, packOsValue, escAttr, escHtml, renderCasparOpenalSection, refreshSystemTabOpenal } from './system-settings-helpers.js'



export async function mountSystemSettings(container) {
	container.innerHTML = `
		<div class="system-settings-loading">Loading hardware info...</div>
	`

	try {
		const [hw, hwA, cfg, hostStats] = await Promise.all([
			api.get('/api/hardware/displays'),
			api.get('/api/audio/devices'),
			api.get('/api/settings'),
			api.get('/api/host-stats').catch(() => null),
		])
		let displayDetails = hw.displays || []
		if (displayDetails.length && typeof displayDetails[0] === 'string') {
			displayDetails = displayDetails.map((name) => ({
				name,
				connected: true,
				resolution: 'unknown',
				refreshHz: null,
				modes: [],
			}))
		}

		const pillHtml = displayDetails.length
			? displayDetails
					.map((d) => {
						const name = typeof d === 'string' ? d : d.name
						const res = typeof d === 'string' ? '' : d.resolution || 'unknown'
						const hz =
							typeof d === 'string' ? '' : d.refreshHz != null ? ` @ ${d.refreshHz} Hz` : ''
						return `<span class="hw-pill" title="${res}${hz}">${name}${res && res !== 'unknown' ? ` — ${res}${hz}` : ''}</span>`
					})
					.join('')
			: '<span class="hw-pill status-warn">None detected</span>'

		container.innerHTML = `
			<p class="settings-note">Map each physical output to an on-screen role. <strong>Screen 1…N</strong> follow Caspar&rsquo;s main-screen count. With <strong>one</strong> main screen and a <strong>multiview</strong> window, use <strong>Multiview monitor</strong> for the second head so X11 extends the desktop (not mirror). By default, outputs are placed left-to-right. <strong>Reverse horizontal order</strong> swaps that order.</p>
			
			<div class="settings-group">
				<label>Detected Displays (Hardware)</label>
				<div class="hw-pill-box">
					${pillHtml}
				</div>
			</div>

			<div class="settings-group">
				<label>Number of Main Screens</label>
				<input type="number" id="sys-screen-count" min="1" max="4" value="${cfg.screen_count ?? cfg.casparServer?.screen_count ?? 1}">
			</div>

			<div class="settings-group settings-group--audio-bundle">
				<div class="settings-popover-title">Audio</div>
				<p class="settings-note" style="margin-top:0">Caspar OpenAL (per screen) uses device <strong>names</strong> from the server. Default ALSA below sets the user’s <code>~/.asoundrc</code> on save.</p>
				<div id="sys-caspar-openal-rows"></div>
				<label style="margin-top:0.75rem;display:block">Default system output (${hwA.cached ? 'cached' : 'fresh'})</label>
				<select id="sys-audio-device" style="width: 100%; margin-bottom: 0.35rem;">
					<option value="">System default (ALSA/Pulse)</option>
					${hwA.devices
						.filter((d) => d.type === 'alsa')
						.map((d) => `<option value="${d.card},${d.device}">${d.name} (${d.id})</option>`)
						.join('')}
				</select>
				<p class="settings-note">Machine-wide output needs <code>POST /api/audio/default-device</code> with <code>scope: system</code> (sudo).</p>
			</div>

			<div id="sys-mapping-container"></div>

			<div id="sys-x11-swap-wrap" class="settings-group" style="display:none">
				<label class="checkbox" style="display:inline-flex;align-items:flex-start;gap:0.35rem;cursor:pointer">
					<input type="checkbox" id="sys-x11-swap">
					<span>Reverse horizontal order (e.g. Screen 2 on the left, Screen 1 on the right)</span>
				</label>
				<p class="settings-note small">Applies only to <code>xrandr --pos</code> placement. Caspar channel → output mapping above is unchanged.</p>
			</div>

			<div class="settings-actions">
				<button class="btn btn--danger" id="sys-apply-os">Apply OS / X11 Changes</button>
				<button class="btn btn--primary" id="sys-install-hd" style="margin-left: 0.5rem;">Install to Hard Drive</button>
				<p class="settings-note small">⚠️ Warning: Applying OS changes will restart the display server and cause flickering or temporary disconnection.</p>
			</div>

			<div class="settings-group diagnostics-panel">
				<div class="settings-popover-title">Server Health &amp; Diagnostics</div>
				<div class="diag-row"><strong>Server Uptime:</strong> <span id="diag-uptime">—</span></div>
				<div class="diag-row"><strong>Memory (RSS):</strong> <span id="diag-memory">—</span></div>
				<div class="diag-row"><strong>HighAsCG process user:</strong> <span id="diag-process-user">—</span></div>
				<div class="diag-row"><strong>Caspar Status:</strong> <span id="diag-caspar">—</span></div>
			</div>
		`

		const cs0 = cfg.casparServer || {}
		const ar0 = cfg.audioRouting || {}
		const openalMount = container.querySelector('#sys-caspar-openal-rows')
		if (openalMount) renderCasparOpenalSection(openalMount, hwA.devices || [], cs0, ar0 || {})

		const mappingContainer = container.querySelector('#sys-mapping-container')

		function fillOsModeSelect(screenIdx, outputId, currentPacked) {
			const sel = mappingContainer.querySelector(`.sys-os-mode[data-screen="${screenIdx}"]`)
			if (!sel) return
			const det = findDisplayDetail(displayDetails, outputId)
			sel.innerHTML = '<option value="">Match Caspar / auto</option>'
			if (!det || !det.modes?.length) return
			const seen = new Set()
			for (const m of det.modes) {
				const hasHz = m.hz != null && Number.isFinite(m.hz)
				const key = hasHz ? `${m.width}x${m.height}@${m.hz}` : `${m.width}x${m.height}`
				if (seen.has(key)) continue
				seen.add(key)
				const opt = document.createElement('option')
				opt.value = key
				opt.textContent = hasHz ? `${m.width}×${m.height} @ ${m.hz} Hz` : `${m.width}×${m.height}`
				sel.appendChild(opt)
			}
			if (!currentPacked) return
			if ([...sel.options].some((o) => o.value === currentPacked)) {
				sel.value = currentPacked
				return
			}
			const pref = currentPacked.includes('@') ? currentPacked.split('@')[0] : currentPacked
			const opt = [...sel.options].find((o) => o.value.startsWith(pref + '@') || o.value === pref)
			if (opt) sel.value = opt.value
		}

		const renderMapping = () => {
			const count = parseInt(container.querySelector('#sys-screen-count').value, 10) || 1
			const cs = cfg.casparServer || {}
			const mvOn = cs.multiview_enabled !== false && cs.multiview_enabled !== 'false'
			const mvSc = multiviewUiShowsScreenRow(cs)
			const showMvRow = count === 1 && mvOn && mvSc
			let html = ''
			for (let i = 1; i <= count; i++) {
				const current = cfg[`screen_${i}_system_id`] || ''
				const om = cfg[`screen_${i}_os_mode`] || ''
				const orate = cfg[`screen_${i}_os_rate`]
				const packed =
					om && orate != null && String(orate).trim() !== ''
						? packOsValue(om, orate)
						: om
							? packOsValue(om, '')
							: ''
				html += `
					<div class="settings-group" data-sys-screen="${i}">
						<label>Screen ${i} Mapping</label>
						<select class="sys-map-select" data-screen="${i}">
							<option value="">Auto / Default</option>
							${displayDetails
								.map((d) => {
									const name = typeof d === 'string' ? d : d.name
									return `<option value="${name}" ${name === current ? 'selected' : ''}>${name}</option>`
								})
								.join('')}
						</select>
						<label style="margin-top:0.5rem">OS output resolution</label>
						<select class="sys-os-mode" data-screen="${i}"></select>
						<div style="display:flex; gap:0.5rem; margin-top:0.5rem">
							<div style="flex:1"><label>X Position</label><input type="number" class="sys-os-x" data-screen="${i}" placeholder="Auto"></div>
							<div style="flex:1"><label>Y Position</label><input type="number" class="sys-os-y" data-screen="${i}" placeholder="Auto"></div>
						</div>
						<p class="settings-note small">Uses xrandr <code>--mode</code> and optional <code>--rate</code> when you Apply OS Changes. X/Y overrides allow grid layouts.</p>
					</div>
				`
			}
			const mvCur = cfg.multiview_system_id || ''
			const mvOm = cfg.multiview_os_mode || ''
			const mvOrate = cfg.multiview_os_rate
			const mvPacked =
				mvOm && mvOrate != null && String(mvOrate).trim() !== ''
					? packOsValue(mvOm, mvOrate)
					: mvOm
						? packOsValue(mvOm, '')
						: ''
			html += `
				<div id="sys-multiview-os-wrap" class="settings-group" style="display:${showMvRow ? 'block' : 'none'}">
					<label>Multiview monitor (second display)</label>
					<p class="settings-note small">Required for <strong>two physical heads</strong> when Caspar has one main screen pair and a multiview channel. Pick the connector for the multiview window; it is placed to the right of Screen 1 (unless you enable <strong>Reverse horizontal order</strong>).</p>
					<select class="sys-map-select" data-screen="mv">
						<option value="">— choose output —</option>
						${displayDetails
							.map((d) => {
								const name = typeof d === 'string' ? d : d.name
								return `<option value="${name}" ${name === mvCur ? 'selected' : ''}>${name}</option>`
							})
							.join('')}
					</select>
					<label style="margin-top:0.5rem">OS output resolution</label>
					<select class="sys-os-mode" data-screen="mv"></select>
					<div style="display:flex; gap:0.5rem; margin-top:0.5rem">
						<div style="flex:1"><label>X Position</label><input type="number" class="sys-os-x" data-screen="mv" placeholder="Auto"></div>
						<div style="flex:1"><label>Y Position</label><input type="number" class="sys-os-y" data-screen="mv" placeholder="Auto"></div>
					</div>
				</div>
			`
			mappingContainer.innerHTML = html
			const swapWrap = container.querySelector('#sys-x11-swap-wrap')
			if (swapWrap) swapWrap.style.display = count >= 2 || showMvRow ? 'block' : 'none'
			for (let i = 1; i <= count; i++) {
				const mapSel = mappingContainer.querySelector(`.sys-map-select[data-screen="${i}"]`)
				const current = cfg[`screen_${i}_system_id`] || ''
				const om = cfg[`screen_${i}_os_mode`] || ''
				const orate = cfg[`screen_${i}_os_rate`]
				const packed =
					om && orate != null && String(orate).trim() !== ''
						? packOsValue(om, orate)
						: om
							? packOsValue(om, '')
							: ''
				fillOsModeSelect(i, mapSel?.value || current, packed)
				mapSel?.addEventListener('change', () => {
					fillOsModeSelect(i, mapSel.value, '')
				})
			}
			if (showMvRow) {
				const mvMap = mappingContainer.querySelector('.sys-map-select[data-screen="mv"]')
				fillOsModeSelect('mv', mvMap?.value || mvCur, mvPacked)
				mvMap?.addEventListener('change', () => {
					fillOsModeSelect('mv', mvMap.value, '')
				})
				const mvX = mappingContainer.querySelector('.sys-os-x[data-screen="mv"]')
				const mvY = mappingContainer.querySelector('.sys-os-y[data-screen="mv"]')
				if (mvX) mvX.value = cfg.multiview_os_x !== undefined ? cfg.multiview_os_x : ''
				if (mvY) mvY.value = cfg.multiview_os_y !== undefined ? cfg.multiview_os_y : ''
			}
			for (let i = 1; i <= count; i++) {
				const xIn = mappingContainer.querySelector(`.sys-os-x[data-screen="${i}"]`)
				const yIn = mappingContainer.querySelector(`.sys-os-y[data-screen="${i}"]`)
				if (xIn) xIn.value = cfg[`screen_${i}_os_x`] !== undefined ? cfg[`screen_${i}_os_x`] : ''
				if (yIn) yIn.value = cfg[`screen_${i}_os_y`] !== undefined ? cfg[`screen_${i}_os_y`] : ''
			}
		}

		renderMapping()
		const swapOnce = container.querySelector('#sys-x11-swap')
		if (swapOnce) swapOnce.checked = !!cfg.x11_horizontal_swap
		container.querySelector('#sys-screen-count').onchange = renderMapping

		const audioSel = container.querySelector('#sys-audio-device')
		const dc = cfg.casparServer?.default_alsa_card
		const dd = cfg.casparServer?.default_alsa_device
		if (
			audioSel &&
			dc !== undefined &&
			dc !== null &&
			String(dc).trim() !== '' &&
			dd !== undefined &&
			dd !== null &&
			String(dd).trim() !== ''
		) {
			const want = `${String(dc).trim()},${String(dd).trim()}`
			if ([...audioSel.options].some((o) => o.value === want)) audioSel.value = want
		}

		container.getSystemSettings = () => {
			const data = {
				screen_count: parseInt(container.querySelector('#sys-screen-count').value, 10),
				x11_horizontal_swap: !!(container.querySelector('#sys-x11-swap') || {}).checked,
			}
			container.querySelectorAll('.sys-map-select').forEach((sel) => {
				const screenIdx = sel.dataset.screen
				if (screenIdx === 'mv') {
					data.multiview_system_id = sel.value
				} else {
					data[`screen_${screenIdx}_system_id`] = sel.value
				}
			})
			container.querySelectorAll('.sys-os-mode').forEach((sel) => {
				const screenIdx = sel.dataset.screen
				const v = sel.value.trim()
				const prefix = screenIdx === 'mv' ? 'multiview' : `screen_${screenIdx}`
				if (!v) {
					data[`${prefix}_os_mode`] = ''
					data[`${prefix}_os_rate`] = ''
				} else {
					const at = v.indexOf('@')
					if (at === -1) {
						data[`${prefix}_os_mode`] = v
						data[`${prefix}_os_rate`] = ''
					} else {
						data[`${prefix}_os_mode`] = v.slice(0, at)
						data[`${prefix}_os_rate`] = v.slice(at + 1)
					}
				}
			})
			container.querySelectorAll('.sys-os-x').forEach((el) => {
				const screenIdx = el.dataset.screen
				const prefix = screenIdx === 'mv' ? 'multiview' : `screen_${screenIdx}`
				const v = parseInt(el.value, 10)
				if (!isNaN(v)) data[`${prefix}_os_x`] = v
				else data[`${prefix}_os_x`] = undefined
			})
			container.querySelectorAll('.sys-os-y').forEach((el) => {
				const screenIdx = el.dataset.screen
				const prefix = screenIdx === 'mv' ? 'multiview' : `screen_${screenIdx}`
				const v = parseInt(el.value, 10)
				if (!isNaN(v)) data[`${prefix}_os_y`] = v
				else data[`${prefix}_os_y`] = undefined
			})
			return data
		}

		const btnApply = container.querySelector('#sys-apply-os')
		btnApply.onclick = async () => {
			if (
				!confirm(
					'Apply X11 layout changes now and persist for reboot?',
				)
			)
				return

			const oldText = btnApply.textContent
			btnApply.disabled = true
			btnApply.textContent = 'Applying...'
			try {
				const payload = container.getSystemSettings ? container.getSystemSettings() : {}
				const res = await api.post('/api/settings/apply-os', payload)
				if (res.ok) {
					alert('OS changes applied and persisted for reboot.')
				} else {
					alert('Error: ' + (res.error || 'Unknown error'))
				}
			} catch (e) {
				alert('Failed to apply OS changes: ' + e.message)
			} finally {
				btnApply.disabled = false
				btnApply.textContent = oldText
			}
		}

		const btnInstall = container.querySelector('#sys-install-hd')
		if (btnInstall) {
			btnInstall.onclick = async () => {
				if (!confirm('This will launch the Calamares installer on the local screen. Continue?')) return
				const oldText = btnInstall.textContent
				btnInstall.disabled = true
				btnInstall.textContent = 'Launching...'
				try {
					const res = await api.post('/api/system/setup/install', {})
					if (res.ok) {
						alert('Calamares launched on the local screen.')
					} else {
						alert('Error: ' + (res.error || 'Unknown error'))
					}
				} catch (e) {
					alert('Failed to launch installer: ' + e.message)
				} finally {
					btnInstall.disabled = false
					btnInstall.textContent = oldText
				}
			}
		}

		const procEl = container.querySelector('#diag-process-user')
		if (procEl && hostStats && hostStats.process) {
			const p = hostStats.process
			procEl.textContent =
				p.username != null ? `${p.username} (uid ${p.uid})` : p.uid != null ? `uid ${p.uid}` : '—'
			if (p.username && p.username !== 'casparcg') {
				procEl.title = 'Default audio uses ~/.asoundrc for this process user; system-wide /etc/asound.conf needs NOPASSWD tee only when the host was installed with HIGHASCG_INSTALL_ASOUND_SUDOERS=1 and scope=system.'
			}
		}

		const vars = getVariableStore(ws)
		const uptimeEl = container.querySelector('#diag-uptime')
		const memEl = container.querySelector('#diag-memory')
		const casparEl = container.querySelector('#diag-caspar')

		const unsub = vars.subscribe((all) => {
			if (uptimeEl) uptimeEl.textContent = all.app_uptime || 'N/A'
			if (memEl) {
				const bytes = parseInt(all.app_memory_rss, 10)
				memEl.textContent = !isNaN(bytes) ? `${Math.round(bytes / 1024 / 1024)} MB` : 'N/A'
			}
			if (casparEl) {
				const offline = all.offline_mode === 'true'
				const conn = all.caspar_connected === 'true'
				if (offline) {
					casparEl.textContent = 'Simulation'
					casparEl.style.color = 'var(--accent-blue)'
				} else {
					casparEl.textContent = conn ? 'Connected' : 'Disconnected'
					casparEl.style.color = conn ? 'var(--accent-green)' : 'var(--accent-red)'
				}
				casparEl.style.fontWeight = 'bold'
			}
		})

		const _destroy = container.destroy || (() => {})
		container.destroy = () => {
			unsub()
			_destroy()
		}
	} catch (e) {
		container.innerHTML = `<div class="status-error">Failed to load system info: ${e.message}</div>`
	}
}
