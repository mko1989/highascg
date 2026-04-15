/**
 * System Settings — manages OS-level hardware mapping (monitors, X11 layout).
 * @see 11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md Phase 4
 */

import { api } from '../lib/api-client.js'
import { getVariableStore } from '../lib/variable-state.js'
import { ws } from '../app.js'

/** @param {string} name */
function drmShort(name) {
	return String(name || '').replace(/^card\d+-/i, '')
}

/**
 * @param {Array<{ name?: string } | string>} displayList
 * @param {string} selectedId
 */
function findDisplayDetail(displayList, selectedId) {
	if (!selectedId) return null
	const s = String(selectedId)
	return (
		displayList.find((d) => {
			const n = typeof d === 'string' ? d : d.name
			return n === s || drmShort(n) === drmShort(s)
		}) || null
	)
}

/**
 * @param {string} mode
 * @param {string|number} rate
 */
function packOsValue(mode, rate) {
	const m = String(mode || '').trim()
	const r = String(rate || '').trim()
	if (!m) return ''
	if (!r) return m
	return `${m}@${r}`
}

function escAttr(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
}

function escHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

/**
 * Caspar OpenAL device names per screen — dropdowns use the same list as ALSA/PipeWire discovery (device name strings).
 * @param {HTMLElement} mount
 * @param {Array<{ name?: string, id?: string }>} devices
 * @param {Record<string, unknown>} cs - casparServer slice (needs screen_count)
 * @param {Record<string, unknown>} audioAr
 */
export function renderCasparOpenalSection(mount, devices, cs, audioAr) {
	const prog = audioAr.programSystemAudioDevices || []
	const prevEn = audioAr.previewSystemAudioEnabled || []
	const prevDev = audioAr.previewSystemAudioDevices || []
	const count = Math.min(4, Math.max(1, parseInt(String(cs?.screen_count ?? 1), 10) || 1))
	const names = []
	const seen = new Set()
	for (const d of devices) {
		const n = d.name || d.id
		if (n && !seen.has(n)) {
			seen.add(n)
			names.push(n)
		}
	}

	function selectHtml(id, current) {
		const cur = String(current ?? '').trim()
		let html = '<option value="">Default</option>'
		for (const name of names) {
			const sel = cur === name ? ' selected' : ''
			html += `<option value="${escAttr(name)}"${sel}>${escHtml(name)}</option>`
		}
		if (cur && !names.includes(cur)) {
			html += `<option value="${escAttr(cur)}" selected>${escHtml(cur)} (saved)</option>`
		}
		return `<select id="${id}" class="sys-openal-select" style="width:100%">${html}</select>`
	}

	let html = ''
	for (let n = 1; n <= count; n++) {
		const pgmVal = prog[n - 1]
		const prvE = prevEn[n - 1] === true
		const prvVal = prevDev[n - 1]
		html +=
			`<div class="settings-group settings-group--openal-screen" style="border-left:3px solid var(--border);padding-left:0.75rem;margin-bottom:0.75rem">` +
			`<h4 style="margin:0 0 0.4rem;font-size:13px;font-weight:600">Screen ${n} — Caspar (OpenAL)</h4>` +
			`<label>Program (PGM)</label>` +
			selectHtml(`set-caspar-screen-${n}-pgm-openal`, pgmVal) +
			`<label style="margin-top:0.5rem;display:inline-flex;align-items:center;gap:0.35rem">` +
			`<input type="checkbox" id="set-caspar-screen-${n}-prv-openal-en"${prvE ? ' checked' : ''}> Preview → system audio</label>` +
			`<label style="margin-top:0.5rem">Preview (PRV)</label>` +
			selectHtml(`set-caspar-screen-${n}-prv-openal`, prvVal) +
			`</div>`
	}
	mount.innerHTML = html
}

/**
 * Refresh OpenAL rows when Screens tab changes screen count (mount lives in System tab).
 * @param {Record<string, unknown>} cs
 * @param {Record<string, unknown>} [audioAr]
 */
export async function refreshSystemTabOpenal(cs, audioAr) {
	const mount = document.getElementById('sys-caspar-openal-rows')
	if (!mount) return
	const hwA = await api.get('/api/audio/devices')
	renderCasparOpenalSection(mount, hwA.devices || [], cs, audioAr || {})
}

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
			<p class="settings-note">Map physical monitor outputs to your CasparCG screens. "Apply OS Changes" runs xrandr and restarts the display manager (nodm). Optional OS resolution overrides Caspar video mode for the X11 output only.</p>
			
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

			<div class="settings-actions">
				<button class="btn btn--danger" id="sys-apply-os">Apply OS / X11 Changes</button>
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
						<p class="settings-note small">Uses xrandr <code>--mode</code> and optional <code>--rate</code> when you Apply OS Changes.</p>
					</div>
				`
			}
			mappingContainer.innerHTML = html
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
		}

		renderMapping()
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
			}
			container.querySelectorAll('.sys-map-select').forEach((sel) => {
				const screenIdx = sel.dataset.screen
				data[`screen_${screenIdx}_system_id`] = sel.value
			})
			container.querySelectorAll('.sys-os-mode').forEach((sel) => {
				const screenIdx = sel.dataset.screen
				const v = sel.value.trim()
				if (!v) {
					data[`screen_${screenIdx}_os_mode`] = ''
					data[`screen_${screenIdx}_os_rate`] = ''
				} else {
					const at = v.indexOf('@')
					if (at === -1) {
						data[`screen_${screenIdx}_os_mode`] = v
						data[`screen_${screenIdx}_os_rate`] = ''
					} else {
						data[`screen_${screenIdx}_os_mode`] = v.slice(0, at)
						data[`screen_${screenIdx}_os_rate`] = v.slice(at + 1)
					}
				}
			})
			return data
		}

		const btnApply = container.querySelector('#sys-apply-os')
		btnApply.onclick = async () => {
			if (
				!confirm(
					'Are you sure you want to apply X11 layout changes and restart the display manager? Screens will flicker.',
				)
			)
				return

			const oldText = btnApply.textContent
			btnApply.disabled = true
			btnApply.textContent = 'Applying...'
			try {
				const res = await api.post('/api/settings/apply-os', {})
				if (res.ok) {
					alert(
						'OS changes applied. Display manager restart triggered.\n' +
							(res.dmRestarted ? 'Success' : 'Restart failed (check server logs)'),
					)
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

		const procEl = container.querySelector('#diag-process-user')
		if (procEl && hostStats && hostStats.process) {
			const p = hostStats.process
			procEl.textContent =
				p.username != null ? `${p.username} (uid ${p.uid})` : p.uid != null ? `uid ${p.uid}` : '—'
			if (p.username && p.username !== 'casparcg') {
				procEl.title = 'Default audio uses ~/.asoundrc for this process user; system-wide /etc/asound.conf needs sudoers only if you use scope=system.'
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
				const conn = all.caspar_connected === 'true'
				casparEl.textContent = conn ? 'Connected' : 'Disconnected'
				casparEl.style.color = conn ? 'var(--accent-green)' : 'var(--accent-red)'
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
