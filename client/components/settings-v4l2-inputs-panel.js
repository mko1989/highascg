/**
 * Settings → USB / V4L2 video inputs.
 */
import { api } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import {
	buildV4l2ConfigBody,
	readV4l2CasparSettings,
	v4l2AlsaDeviceOptions,
	v4l2CaptureDeviceOptions,
	V4L2_MAX_SLOTS,
} from '../lib/v4l2-inputs.js'
import { listInputChannels } from '../lib/input-channels.js'
import { markCasparRestartDirty } from '../lib/caspar-restart-hint.js'
import { escapeHtml } from '../lib/dom-escape.js'

/**
 * @param {HTMLElement} container
 */
export async function mountV4l2InputsSettingsPanel(container) {
	container.innerHTML = `<div id="v4l2-settings-main"><p class="settings-note">Loading USB video settings…</p></div>`
	const mainEl = container.querySelector('#v4l2-settings-main')

	let captureDevices = []
	let alsaDevices = []
	let liveState = null

	async function loadDevices(refresh = false) {
		const q = refresh ? '?refresh=1' : ''
		const data = await api.get(`/api/system/v4l2-devices${q}`)
		captureDevices = Array.isArray(data?.devices) ? data.devices : []
	}

	async function loadAlsaDevices(refresh = false) {
		const q = refresh ? '?refresh=1' : ''
		const data = await api.get(`/api/audio/devices${q}`)
		alsaDevices = Array.isArray(data?.devices) ? data.devices : []
	}

	async function loadV4l2Inputs() {
		try {
			liveState = await api.get('/api/v4l2-inputs')
		} catch {
			liveState = null
		}
	}

	function readUiFromDom() {
		const cs = settingsState.getSettings()?.casparServer || {}
		const base = readV4l2CasparSettings(cs)
		const countEl = mainEl.querySelector('#v4l2-slot-count')
		const count = countEl ? parseInt(String(countEl.value || '0'), 10) || 0 : base.count
		const slots = []
		const labels = []
		const formats = []
		const widths = []
		const heights = []
		const fps = []
		const audio = []
		for (let i = 1; i <= V4L2_MAX_SLOTS; i++) {
			slots.push(String(mainEl.querySelector(`#v4l2-slot-${i}-device`)?.value || '').trim())
			labels.push(String(mainEl.querySelector(`#v4l2-slot-${i}-label`)?.value || '').trim())
			formats.push(String(mainEl.querySelector(`#v4l2-slot-${i}-format`)?.value || 'auto').trim())
			widths.push(parseInt(String(mainEl.querySelector(`#v4l2-slot-${i}-width`)?.value || '0'), 10) || 0)
			heights.push(parseInt(String(mainEl.querySelector(`#v4l2-slot-${i}-height`)?.value || '0'), 10) || 0)
			fps.push(parseInt(String(mainEl.querySelector(`#v4l2-slot-${i}-fps`)?.value || '0'), 10) || 0)
			const audioSel = mainEl.querySelector(`#v4l2-slot-${i}-audio-select`)
			const audioManual = mainEl.querySelector(`#v4l2-slot-${i}-audio`)
			const audioVal =
				audioSel?.value && audioSel.value !== '__custom__'
					? String(audioSel.value).trim()
					: String(audioManual?.value || 'none').trim() || 'none'
			audio.push(audioVal)
		}
		return {
			...base,
			count: Math.max(0, Math.min(V4L2_MAX_SLOTS, count)),
			slots,
			labels,
			formats,
			widths,
			heights,
			fps,
			audio,
		}
	}

	function renderSlotRows(ui) {
		const wrap = mainEl.querySelector('#v4l2-slots')
		if (!wrap) return
		const opts = v4l2CaptureDeviceOptions(captureDevices)
		const audioOpts = v4l2AlsaDeviceOptions(alsaDevices)
		const configured = liveState?.configured?.slots || []
		let html = ''
		for (let i = 1; i <= V4L2_MAX_SLOTS; i++) {
			const show = i <= ui.count
			const cur = ui.slots[i - 1] || ''
			const cfg = configured.find((s) => s && Number(s.slot) === i)
			const routeHint = cfg?.route
				? `<span class="settings-note small" style="display:block;margin-top:0.25rem">${escapeHtml(cfg.route)}</span>`
				: ''
			let optHtml = opts
				.map((o) => {
					const dis = o.disabled ? ' disabled' : ''
					const sel = o.value === cur ? ' selected' : ''
					return `<option value="${escapeHtml(o.value)}"${sel}${dis}>${escapeHtml(o.label)}</option>`
				})
				.join('')
			if (cur && !opts.some((o) => o.value === cur)) {
				optHtml += `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)} (saved)</option>`
			}
			const curAudio = ui.audio?.[i - 1] || 'none'
			const audioSel = audioOpts.some((o) => o.value === curAudio) ? curAudio : '__custom__'
			const audioOptHtml = audioOpts
				.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === curAudio ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
				.join('')
			html += `
				<div class="settings-group v4l2-slot-row" data-slot="${i}" style="display:${show ? 'block' : 'none'};margin-bottom:1rem;padding-bottom:0.75rem;border-bottom:1px solid rgba(255,255,255,0.08)">
					<label><strong>Slot ${i}</strong> — V4L2 device</label>
					<select id="v4l2-slot-${i}-device" style="width:100%">${optHtml}</select>
					<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.5rem">
						<div style="flex:1 1 12rem"><label>Label</label><input type="text" id="v4l2-slot-${i}-label" value="${escapeHtml(ui.labels?.[i - 1] || '')}" style="width:100%" /></div>
						<div><label>Format</label>
							<select id="v4l2-slot-${i}-format">
								<option value="auto"${(ui.formats?.[i - 1] || 'auto') === 'auto' ? ' selected' : ''}>auto</option>
								<option value="mjpeg"${ui.formats?.[i - 1] === 'mjpeg' ? ' selected' : ''}>mjpeg</option>
								<option value="yuyv422"${ui.formats?.[i - 1] === 'yuyv422' ? ' selected' : ''}>yuyv422</option>
							</select>
						</div>
						<div><label>W</label><input type="number" id="v4l2-slot-${i}-width" min="0" value="${ui.widths?.[i - 1] || 0}" style="width:5rem" /></div>
						<div><label>H</label><input type="number" id="v4l2-slot-${i}-height" min="0" value="${ui.heights?.[i - 1] || 0}" style="width:5rem" /></div>
						<div><label>FPS</label><input type="number" id="v4l2-slot-${i}-fps" min="0" value="${ui.fps?.[i - 1] || 0}" style="width:4rem" /></div>
					</div>
					<div style="margin-top:0.35rem"><label>Audio (optional ALSA mux)</label>
						<select id="v4l2-slot-${i}-audio-select" style="width:100%;margin-bottom:0.25rem">${audioOptHtml}<option value="__custom__"${audioSel === '__custom__' ? ' selected' : ''}>Custom…</option></select>
						<input type="text" id="v4l2-slot-${i}-audio" value="${escapeHtml(curAudio)}" placeholder="none or hw:3,0" style="width:100%;display:${audioSel === '__custom__' ? 'block' : 'none'}" />
					</div>
					${routeHint}
				</div>`
		}
		wrap.innerHTML = html
		for (let i = 1; i <= V4L2_MAX_SLOTS; i++) {
			const sel = wrap.querySelector(`#v4l2-slot-${i}-audio-select`)
			const manual = wrap.querySelector(`#v4l2-slot-${i}-audio`)
			sel?.addEventListener('change', () => {
				if (!manual || !sel) return
				if (sel.value === '__custom__') {
					manual.style.display = 'block'
					manual.focus()
				} else {
					manual.style.display = 'none'
					manual.value = sel.value
				}
			})
		}
	}

	function renderStatus() {
		const el = mainEl.querySelector('#v4l2-status')
		if (!el) return
		const st = liveState?.status
		const cm = { inputChannels: listInputChannels({ inputChannels: liveState?.configured?.slots?.map((s) => ({
			kind: 'v4l2',
			slot: s.slot,
			channel: s.channel,
			layer: s.layer,
			route: s.route,
			label: s.label,
		})) }) }
		const inputEntries = listInputChannels(liveState?.v4l2InputChannels ? {
			v4l2InputCount: liveState.v4l2InputCount,
			v4l2InputChannels: liveState.v4l2InputChannels,
			inputChannels: liveState.configured?.slots?.map((s) => ({
				kind: 'v4l2',
				slot: s.slot,
				channel: s.channel,
				layer: s.layer,
				route: s.route,
			})),
		} : cm)
		const v4l2Entries = inputEntries.filter((e) => e.kind === 'v4l2')
		if (!v4l2Entries.length) {
			const count = parseInt(String(liveState?.v4l2InputCount ?? '0'), 10) || 0
			if (count <= 0) {
				el.innerHTML = '<span class="settings-note">Configure USB cameras below. Each slot gets a dedicated Caspar host channel (apply config + restart when count changes).</span>'
				return
			}
			el.innerHTML = '<span class="status-warn">V4L2 channels not in channelMap yet — apply Caspar config and restart.</span>'
			return
		}
		const lines = [
			`<strong>USB video inputs:</strong> ${v4l2Entries.length} channel(s)`,
			`<span class="settings-note small">${v4l2Entries.map((e) => `Slot ${e.slot} → ch ${e.channel} (${e.route})`).join(' · ')}</span>`,
		]
		if (st?.enabled === false && st.reason) lines.push(`<span class="status-warn">${escapeHtml(st.reason)}</span>`)
		if (st?.playSucceeded != null) lines.push(`<span class="status-ok">PLAY OK: ${st.playSucceeded}/${st.scheduledPlays ?? '?'}</span>`)
		if (Array.isArray(st?.failed) && st.failed.length) {
			lines.push(`<span class="status-warn">Failed: ${st.failed.map((x) => escapeHtml(x.message || x.device || x.slot)).join('; ')}</span>`)
		}
		el.innerHTML = lines.join('<br>')
	}

	function renderPanel() {
		const cfg = settingsState.getSettings() || {}
		const ui = readV4l2CasparSettings(cfg.casparServer || {})
		ui.labels = []
		ui.formats = []
		ui.widths = []
		ui.heights = []
		ui.fps = []
		ui.audio = []
		for (let i = 1; i <= V4L2_MAX_SLOTS; i++) {
			const cs = cfg.casparServer || {}
			ui.labels.push(String(cs[`v4l2_input_${i}_label`] ?? '').trim())
			ui.formats.push(String(cs[`v4l2_input_${i}_format`] ?? 'auto').trim() || 'auto')
			ui.widths.push(parseInt(String(cs[`v4l2_input_${i}_width`] ?? 0), 10) || 0)
			ui.heights.push(parseInt(String(cs[`v4l2_input_${i}_height`] ?? 0), 10) || 0)
			ui.fps.push(parseInt(String(cs[`v4l2_input_${i}_fps`] ?? 0), 10) || 0)
			ui.audio.push(String(cs[`v4l2_input_${i}_audio`] ?? 'none').trim() || 'none')
		}

		mainEl.innerHTML = `
			<h3 class="settings-category">USB / V4L2 video inputs</h3>
			<p class="settings-note">Capture UVC webcams and USB switchers (e.g. ATEM Mini). Caspar opens each device directly via <code>v4l2://</code> on a dedicated host channel — route with <code>route://</code> like DeckLink/NDI. Optional FFmpeg UDP bridge is off by default (enable <code>v4l2_capture_bridge</code> only for legacy setups).</p>
			<div id="v4l2-status" class="settings-note" style="margin-bottom:0.75rem"></div>
			<div class="settings-group">
				<label for="v4l2-slot-count">Input count (0–${V4L2_MAX_SLOTS})</label>
				<input type="number" id="v4l2-slot-count" min="0" max="${V4L2_MAX_SLOTS}" value="${ui.count}" style="width:5rem" />
			</div>
			<div id="v4l2-slots"></div>
			<div class="settings-group" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:1rem">
				<button type="button" class="btn btn--secondary" id="v4l2-refresh-devices">Refresh devices</button>
				<button type="button" class="btn btn--primary" id="v4l2-save-config">Save config</button>
				<button type="button" class="btn btn--secondary" id="v4l2-apply-play">Apply PLAY</button>
			</div>
			<p class="settings-note" id="v4l2-action-status" style="margin-top:0.35rem"></p>
			<p class="settings-note small"><strong>ATEM Mini tip:</strong> pick <code>/dev/video0</code> (not video1 metadata). Use 1920×1080, 50 fps, format mjpeg if auto fails.</p>
		`

		renderSlotRows(ui)
		renderStatus()

		const statusLine = mainEl.querySelector('#v4l2-action-status')
		const setActionStatus = (msg, ok = true) => {
			if (statusLine) {
				statusLine.textContent = msg || ''
				statusLine.style.color = ok ? 'var(--accent-green, #86efac)' : 'var(--accent-red, #f87171)'
			}
		}

		mainEl.querySelector('#v4l2-slot-count')?.addEventListener('input', () => {
			renderSlotRows(readUiFromDom())
		})

		mainEl.querySelector('#v4l2-refresh-devices')?.addEventListener('click', async () => {
			setActionStatus('Refreshing V4L2 devices…', true)
			try {
				await Promise.all([loadDevices(true), loadAlsaDevices(true)])
				renderSlotRows(readUiFromDom())
				setActionStatus('Device lists updated.', true)
			} catch (e) {
				setActionStatus(e?.message || String(e), false)
			}
		})

		mainEl.querySelector('#v4l2-save-config')?.addEventListener('click', async () => {
			setActionStatus('Saving…', true)
			try {
				const r = await api.post('/api/v4l2-inputs/config', buildV4l2ConfigBody(readUiFromDom()))
				await settingsState.load()
				markCasparRestartDirty()
				await loadV4l2Inputs()
				renderStatus()
				const warns = Array.isArray(r?.warnings) ? r.warnings.filter(Boolean) : []
				const warnMsg = warns.length ? ` Warnings: ${warns.join(' ')}` : ''
				setActionStatus(`Saved.${warnMsg} Apply Caspar config + restart if slot count changed.`, !warns.length)
				document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
				document.dispatchEvent(new CustomEvent('highascg-v4l2-configured', { detail: liveState }))
			} catch (e) {
				setActionStatus(e?.message || String(e), false)
			}
		})

		mainEl.querySelector('#v4l2-apply-play')?.addEventListener('click', async () => {
			setActionStatus('Applying V4L2 PLAY…', true)
			try {
				await api.post('/api/v4l2-inputs/apply', {})
				await loadV4l2Inputs()
				renderStatus()
				setActionStatus('V4L2 PLAY sent (requires AMCP connected).', true)
			} catch (e) {
				setActionStatus(e?.message || String(e), false)
			}
		})
	}

	try {
		await Promise.all([loadDevices(false), loadAlsaDevices(false), loadV4l2Inputs(), settingsState.load()])
		renderPanel()
	} catch (e) {
		mainEl.innerHTML = `<p class="status-error">Failed to load USB video settings: ${escapeHtml(e?.message || e)}</p>`
	}

	return async function refresh() {
		await Promise.all([loadDevices(false), loadAlsaDevices(false), loadV4l2Inputs()])
		renderPanel()
	}
}
