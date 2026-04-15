import { api, getApiBase } from '../lib/api-client.js'
import { settingsState } from '../lib/settings-state.js'
import { refreshSystemTabOpenal } from './system-settings.js'

let casparModeChoices = []

export function fillModeSelect(modal, sel) {
	if (!sel) return
	sel.innerHTML = ''
	for (const m of casparModeChoices) {
		const opt = document.createElement('option')
		opt.value = m.id
		opt.textContent = m.label
		sel.appendChild(opt)
	}
}

/**
 * @param {Record<string, unknown>} cs - casparServer slice
 * @param {Record<string, unknown>} [audioAr] - audioRouting slice (OpenAL fields); defaults from settingsState
 */
/**
 * @param {HTMLDivElement} row
 * @param {number} n
 * @param {Record<string, unknown>} cs
 */
function appendCustomLiveScreenFields(row, n, cs) {
	if (String(cs?.caspar_build_profile || 'stock') !== 'custom_live') return
	const ar = String(cs[`screen_${n}_aspect_ratio`] || '')
	const mm = cs[`screen_${n}_enable_mipmaps`] === true || cs[`screen_${n}_enable_mipmaps`] === 'true'
	const paEn = cs[`screen_${n}_portaudio_enabled`] === true || cs[`screen_${n}_portaudio_enabled`] === 'true'
	const paDev = String(cs[`screen_${n}_portaudio_device_name`] || '')
	const paCh = cs[`screen_${n}_portaudio_output_channels`] ?? 2
	const paBuf = cs[`screen_${n}_portaudio_buffer_frames`] ?? 128
	const paLat = cs[`screen_${n}_portaudio_latency_ms`] ?? 40
	const paFifo = cs[`screen_${n}_portaudio_fifo_ms`] ?? 50
	const paTune = cs[`screen_${n}_portaudio_auto_tune`] !== false && cs[`screen_${n}_portaudio_auto_tune`] !== 'false'
	const sub = document.createElement('div')
	sub.className = 'settings-group'
	sub.style.marginTop = '0.65rem'
	sub.style.paddingTop = '0.5rem'
	sub.style.borderTop = '1px solid #30363d'
	sub.innerHTML =
		`<p class="settings-note" style="margin:0 0 0.4rem;font-size:12px"><strong>Custom build</strong> — screen + PortAudio (ASIO)</p>` +
		`<label>Aspect ratio (optional, e.g. 16:9 or 3840:1080)</label>` +
		`<input type="text" id="set-caspar-screen-${n}-aspect" placeholder="auto from mode">` +
		`<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">` +
		`<input type="checkbox" id="set-caspar-screen-${n}-mipmaps"> Enable mipmaps (LED walls)</label>` +
		`<h5 style="margin:0.6rem 0 0.25rem;font-size:12px">PortAudio / ASIO (PGM audio — disables OpenAL for this screen)</h5>` +
		`<p class="settings-note" style="margin:0 0 0.4rem;font-size:11px;color:#e67e22">` +
		`<strong>Binary must include PR #1720.</strong> If Caspar exits with ` +
		`<code style="font-size:10px">No consumer factory registered for element name portaudio</code>, ` +
		`this server was built <em>without</em> the PortAudio consumer — leave this off, or deploy a matching <code>casparcg-server</code> binary.</p>` +
		`<label style="display:inline-flex;align-items:center;gap:0.35rem">` +
		`<input type="checkbox" id="set-caspar-screen-${n}-pa-en"> Enable PortAudio consumer</label>` +
		(n === 1
			? `<p class="settings-note" style="margin:0.35rem 0 0;font-size:11px">Device names come from PortAudio on this machine (same list Caspar uses). ` +
				`<button type="button" class="btn btn--secondary" id="set-caspar-pa-devices-refresh" style="font-size:11px;padding:0.15rem 0.45rem">Refresh list</button> ` +
				`<span id="set-caspar-pa-devices-status" style="color:var(--text-muted,#8b949e)"></span></p>`
			: '') +
		`<label style="margin-top:0.35rem">Output device (pick from list or type; empty = default)</label>` +
		`<input type="text" id="set-caspar-screen-${n}-pa-dev" placeholder="Device name" list="set-caspar-screen-${n}-pa-devlist" autocomplete="off">` +
		`<datalist id="set-caspar-screen-${n}-pa-devlist"></datalist>` +
		`<label style="margin-top:0.35rem">Output channels</label>` +
		`<input type="number" id="set-caspar-screen-${n}-pa-ch" min="1" max="64" step="1" value="${paCh}">` +
		`<label style="margin-top:0.35rem">Buffer (frames)</label>` +
		`<input type="number" id="set-caspar-screen-${n}-pa-buf" min="16" max="4096" step="1" value="${paBuf}">` +
		`<label style="margin-top:0.35rem">Latency compensation (ms)</label>` +
		`<input type="number" id="set-caspar-screen-${n}-pa-lat" min="0" max="500" step="1" value="${paLat}">` +
		`<label style="margin-top:0.35rem">FIFO (ms)</label>` +
		`<input type="number" id="set-caspar-screen-${n}-pa-fifo" min="1" max="500" step="1" value="${paFifo}">` +
		`<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">` +
		`<input type="checkbox" id="set-caspar-screen-${n}-pa-tune"> Auto-tune latency</label>`
	row.appendChild(sub)
	const aEl = sub.querySelector(`#set-caspar-screen-${n}-aspect`)
	if (aEl) aEl.value = ar
	sub.querySelector(`#set-caspar-screen-${n}-mipmaps`).checked = mm
	sub.querySelector(`#set-caspar-screen-${n}-pa-en`).checked = paEn
	sub.querySelector(`#set-caspar-screen-${n}-pa-dev`).value = paDev
	sub.querySelector(`#set-caspar-screen-${n}-pa-tune`).checked = paTune
}

/**
 * Fills PortAudio `<datalist>` options from GET /api/audio/portaudio-devices (PortAudio via naudiodon, or Linux `aplay -L` fallback).
 * @param {HTMLElement} modal
 */
export async function refreshPortAudioDeviceLists(modal) {
	const status = modal.querySelector('#set-caspar-pa-devices-status')
	const count = Math.min(
		4,
		Math.max(1, parseInt(String(modal.querySelector('#set-caspar-screen-count')?.value || '1'), 10) || 1)
	)
	if (status) status.textContent = '…'
	try {
		const r = await api.get('/api/audio/portaudio-devices?refresh=1')
		const devs = Array.isArray(r.devices) ? r.devices : []
		const err = r.error
		const hint = r.hint || r.detail
		const src = r.source
		for (let n = 1; n <= count; n++) {
			const dl = modal.querySelector(`#set-caspar-screen-${n}-pa-devlist`)
			if (!dl) continue
			dl.innerHTML = ''
			for (const d of devs) {
				const name = String(d.name || '').trim()
				if (!name) continue
				const opt = document.createElement('option')
				opt.value = name
				dl.appendChild(opt)
			}
		}
		if (status) {
			if (devs.length) {
				const tag =
					src === 'aplay-l' ? ' (aplay -L)' : src === 'naudiodon' ? ' (PortAudio)' : ''
				status.textContent = `${devs.length} output device(s)${tag}`
			} else if (err) {
				status.textContent = String(hint || err)
			} else {
				status.textContent = 'No output devices'
			}
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		if (status) status.textContent = msg
	}
}

export function renderCasparScreenRows(modal, cs, audioAr) {
	const ar = audioAr || settingsState.getSettings()?.audioRouting || {}
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
		const windowed =
			cs[`screen_${n}_windowed`] !== false && cs[`screen_${n}_windowed`] !== 'false'
		const vsync = cs[`screen_${n}_vsync`] !== false && cs[`screen_${n}_vsync`] !== 'false'
		const borderless =
			cs[`screen_${n}_borderless`] === true || cs[`screen_${n}_borderless`] === 'true'
		const alwaysOnTop =
			cs[`screen_${n}_always_on_top`] !== false && cs[`screen_${n}_always_on_top`] !== 'false'
		const posX = cs[`screen_${n}_x`]
		const posY = cs[`screen_${n}_y`]
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
			`<p class="settings-note" style="margin-top:0.5rem;margin-bottom:0.35rem">Screen consumer (Caspar <code>&lt;screen&gt;</code>)</p>` +
			`<label style="display:inline-flex;align-items:center;gap:0.35rem">` +
			`<input type="checkbox" id="set-caspar-screen-${n}-windowed"> Windowed</label>` +
			`<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">` +
			`<input type="checkbox" id="set-caspar-screen-${n}-vsync"> V-sync</label>` +
			`<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">` +
			`<input type="checkbox" id="set-caspar-screen-${n}-borderless"> Borderless</label>` +
			`<label style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">` +
			`<input type="checkbox" id="set-caspar-screen-${n}-aot"> Always on top</label>` +
			`<label style="margin-top:0.5rem">Window X (px, empty = auto)</label>` +
			`<input type="number" id="set-caspar-screen-${n}-px" step="1" placeholder="auto">` +
			`<label style="margin-top:0.5rem">Window Y (px, empty = auto)</label>` +
			`<input type="number" id="set-caspar-screen-${n}-py" step="1" placeholder="auto">` +
			`<label style="margin-top:0.5rem;display:inline-flex;align-items:center;gap:0.35rem">` +
			`<input type="checkbox" id="set-caspar-screen-${n}-ndi"> NDI output</label>` +
			`<label style="margin-top:0.5rem">NDI name</label>` +
			`<input type="text" id="set-caspar-screen-${n}-ndi-name">`
		wrap.appendChild(div)
		div.querySelector(`#set-caspar-screen-${n}-ndi-name`).value = ndiName
		const sel = div.querySelector(`#set-caspar-screen-${n}-mode`)
		fillModeSelect(modal, sel)
		if ([...sel.options].some((o) => o.value === mode)) sel.value = mode
		else sel.value = '1080p5000'
		div.querySelector(`#set-caspar-screen-${n}-ndi`).checked = ndi
		div.querySelector(`#set-caspar-screen-${n}-windowed`).checked = windowed
		div.querySelector(`#set-caspar-screen-${n}-vsync`).checked = vsync
		div.querySelector(`#set-caspar-screen-${n}-borderless`).checked = borderless
		div.querySelector(`#set-caspar-screen-${n}-aot`).checked = alwaysOnTop
		const pxEl = div.querySelector(`#set-caspar-screen-${n}-px`)
		const pyEl = div.querySelector(`#set-caspar-screen-${n}-py`)
		if (pxEl && posX != null && posX !== '') pxEl.value = String(posX)
		if (pyEl && posY != null && posY !== '') pyEl.value = String(posY)
		const customWrap = div.querySelector(`#set-caspar-screen-${n}-custom-wrap`)
		function syncCustomVisibility() {
			const show = sel.value === 'custom'
			if (customWrap) customWrap.style.display = show ? 'block' : 'none'
		}
		syncCustomVisibility()
		sel.addEventListener('change', syncCustomVisibility)
		appendCustomLiveScreenFields(div, n, cs)
	}
	modal.querySelector('#set-caspar-screen-count').value = String(count)
	const arMerged = audioAr || settingsState.getSettings()?.audioRouting || {}
	void refreshSystemTabOpenal(cs, arMerged)
	if (String(cs?.caspar_build_profile || 'stock') === 'custom_live') {
		void refreshPortAudioDeviceLists(modal)
	}
}

export function collectOpenalAudioRoutingFromModal(modal) {
	const programSystemAudioDevices = []
	const previewSystemAudioEnabled = []
	const previewSystemAudioDevices = []
	for (let n = 1; n <= 4; n++) {
		const pgmIn = modal.querySelector(`#set-caspar-screen-${n}-pgm-openal`)
		const prvEn = modal.querySelector(`#set-caspar-screen-${n}-prv-openal-en`)
		const prvIn = modal.querySelector(`#set-caspar-screen-${n}-prv-openal`)
		programSystemAudioDevices.push(pgmIn ? pgmIn.value.trim() : '')
		previewSystemAudioEnabled.push(!!(prvEn && prvEn.checked))
		previewSystemAudioDevices.push(prvIn ? prvIn.value.trim() : '')
	}
	return { programSystemAudioDevices, previewSystemAudioEnabled, previewSystemAudioDevices }
}

export function collectCasparServerFromUI(modal) {
	const cs = {}
	const bpEl = modal.querySelector('#set-caspar-build-profile')
	if (bpEl) cs.caspar_build_profile = bpEl.value || 'stock'
	cs.screen_count = parseInt(modal.querySelector('#set-caspar-screen-count').value, 10) || 1
	cs.multiview_enabled = modal.querySelector('#set-caspar-mv-enabled').checked
	const mvOut = modal.querySelector('#set-caspar-mv-output')
	cs.multiview_screen_consumer = !mvOut || mvOut.value !== 'stream_only'
	cs.multiview_mode = modal.querySelector('#set-caspar-mv-mode').value
	cs.multiview_windowed = modal.querySelector('#set-caspar-mv-windowed').checked
	cs.multiview_vsync = modal.querySelector('#set-caspar-mv-vsync').checked
	cs.multiview_borderless = modal.querySelector('#set-caspar-mv-borderless').checked
	cs.multiview_always_on_top = modal.querySelector('#set-caspar-mv-aot').checked
	const mvPx = modal.querySelector('#set-caspar-mv-px')
	const mvPy = modal.querySelector('#set-caspar-mv-py')
	if (mvPx) {
		const t = mvPx.value.trim()
		cs.multiview_x = t === '' ? '' : parseInt(t, 10) || 0
	}
	if (mvPy) {
		const t = mvPy.value.trim()
		cs.multiview_y = t === '' ? '' : parseInt(t, 10) || 0
	}
	cs.decklink_input_count = parseInt(modal.querySelector('#set-caspar-dl-inputs').value, 10) || 0
	cs.inputs_channel_mode = modal.querySelector('#set-caspar-inputs-mode').value
	cs.configPath = modal.querySelector('#set-caspar-config-path').value.trim()
	const ndiAl = modal.querySelector('#set-caspar-ndi-auto-load')
	if (ndiAl) cs.ndi_auto_load = ndiAl.checked
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
		cs[`screen_${n}_windowed`] = modal.querySelector(`#set-caspar-screen-${n}-windowed`).checked
		cs[`screen_${n}_vsync`] = modal.querySelector(`#set-caspar-screen-${n}-vsync`).checked
		cs[`screen_${n}_borderless`] = modal.querySelector(`#set-caspar-screen-${n}-borderless`).checked
		cs[`screen_${n}_always_on_top`] = modal.querySelector(`#set-caspar-screen-${n}-aot`).checked
		const pxIn = modal.querySelector(`#set-caspar-screen-${n}-px`)
		const pyIn = modal.querySelector(`#set-caspar-screen-${n}-py`)
		if (pxIn) {
			const t = pxIn.value.trim()
			cs[`screen_${n}_x`] = t === '' ? '' : parseInt(t, 10) || 0
		}
		if (pyIn) {
			const t = pyIn.value.trim()
			cs[`screen_${n}_y`] = t === '' ? '' : parseInt(t, 10) || 0
		}
		cs[`screen_${n}_ndi_enabled`] = modal.querySelector(`#set-caspar-screen-${n}-ndi`).checked
		cs[`screen_${n}_ndi_name`] =
			modal.querySelector(`#set-caspar-screen-${n}-ndi-name`).value.trim() || `HighAsCG-CH${n}`
		const arEl = modal.querySelector(`#set-caspar-screen-${n}-aspect`)
		if (arEl) cs[`screen_${n}_aspect_ratio`] = arEl.value.trim()
		const mmEl = modal.querySelector(`#set-caspar-screen-${n}-mipmaps`)
		if (mmEl) cs[`screen_${n}_enable_mipmaps`] = mmEl.checked
		const paEn = modal.querySelector(`#set-caspar-screen-${n}-pa-en`)
		if (paEn) cs[`screen_${n}_portaudio_enabled`] = paEn.checked
		const paDev = modal.querySelector(`#set-caspar-screen-${n}-pa-dev`)
		if (paDev) cs[`screen_${n}_portaudio_device_name`] = paDev.value.trim()
		const paCh = modal.querySelector(`#set-caspar-screen-${n}-pa-ch`)
		if (paCh) cs[`screen_${n}_portaudio_output_channels`] = parseInt(paCh.value, 10) || 2
		const paBuf = modal.querySelector(`#set-caspar-screen-${n}-pa-buf`)
		if (paBuf) cs[`screen_${n}_portaudio_buffer_frames`] = parseInt(paBuf.value, 10) || 128
		const paLat = modal.querySelector(`#set-caspar-screen-${n}-pa-lat`)
		if (paLat) cs[`screen_${n}_portaudio_latency_ms`] = parseFloat(paLat.value) || 40
		const paFifo = modal.querySelector(`#set-caspar-screen-${n}-pa-fifo`)
		if (paFifo) cs[`screen_${n}_portaudio_fifo_ms`] = parseFloat(paFifo.value) || 50
		const paTune = modal.querySelector(`#set-caspar-screen-${n}-pa-tune`)
		if (paTune) cs[`screen_${n}_portaudio_auto_tune`] = paTune.checked
	}
	return cs
}

export function buildCasparServerPayload(modal) {
	const cs = collectCasparServerFromUI(modal)
	const sel = modal.querySelector('#sys-audio-device')
	if (sel) {
		const v = sel.value.trim()
		if (!v) {
			cs.default_alsa_card = ''
			cs.default_alsa_device = ''
		} else {
			const parts = v.split(',')
			cs.default_alsa_card = parts[0] ?? ''
			cs.default_alsa_device = parts[1] ?? ''
		}
	}
	return cs
}

export async function loadCasparModes(modal) {
	try {
		const r = await api.get('/api/caspar-config/mode-choices')
		casparModeChoices = r.modes || []
	} catch (e) {
		console.warn('[Settings] caspar modes', e)
		casparModeChoices = [{ id: '1080p5000', label: '1080p5000' }]
	}
	fillModeSelect(modal, modal.querySelector('#set-caspar-mv-mode'))
	fillModeSelect(modal, modal.querySelector('#set-caspar-inputs-mode'))
}

export function syncMultiviewConsumerVisibility(modal) {
	const on = modal.querySelector('#set-caspar-mv-enabled').checked
	const mvOut = modal.querySelector('#set-caspar-mv-output')
	const streamOnly = mvOut && mvOut.value === 'stream_only'
	const wrap = modal.querySelector('#set-caspar-mv-consumer-wrap')
	if (wrap) wrap.style.display = on && !streamOnly ? '' : 'none'
	const outWrap = modal.querySelector('#set-caspar-mv-output-wrap')
	if (outWrap) outWrap.style.display = on ? '' : 'none'
}

export function updateCasparApplyHint(modal) {
	const offline = modal.querySelector('#set-offline-mode').checked
	modal.querySelector('#set-caspar-apply-hint').style.display = offline ? 'block' : 'none'
}

export function hydrateCasparSettingsFromConfig(modal, cfg) {
	const cs = cfg.casparServer || {}
	const bpSel = modal.querySelector('#set-caspar-build-profile')
	if (bpSel) {
		const v = cs.caspar_build_profile === 'custom_live' ? 'custom_live' : 'stock'
		bpSel.value = v
	}
	modal.querySelector('#set-caspar-mv-enabled').checked =
		cs.multiview_enabled !== false && cs.multiview_enabled !== 'false'
	const mvOut = modal.querySelector('#set-caspar-mv-output')
	if (mvOut) {
		const streamOnly = cs.multiview_screen_consumer === false || cs.multiview_screen_consumer === 'false'
		mvOut.value = streamOnly ? 'stream_only' : 'screen_stream'
	}
	const mv = cs.multiview_mode || '1080p5000'
	const mvSel = modal.querySelector('#set-caspar-mv-mode')
	if ([...mvSel.options].some((o) => o.value === mv)) mvSel.value = mv
	modal.querySelector('#set-caspar-mv-windowed').checked =
		cs.multiview_windowed !== false && cs.multiview_windowed !== 'false'
	modal.querySelector('#set-caspar-mv-vsync').checked =
		cs.multiview_vsync !== false && cs.multiview_vsync !== 'false'
	modal.querySelector('#set-caspar-mv-borderless').checked =
		cs.multiview_borderless === true || cs.multiview_borderless === 'true'
	modal.querySelector('#set-caspar-mv-aot').checked =
		cs.multiview_always_on_top !== false && cs.multiview_always_on_top !== 'false'
	const mvPxEl = modal.querySelector('#set-caspar-mv-px')
	const mvPyEl = modal.querySelector('#set-caspar-mv-py')
	const mvx = cs.multiview_x
	const mvy = cs.multiview_y
	if (mvPxEl) mvPxEl.value = mvx != null && mvx !== '' ? String(mvx) : ''
	if (mvPyEl) mvPyEl.value = mvy != null && mvy !== '' ? String(mvy) : ''
	syncMultiviewConsumerVisibility(modal)
	modal.querySelector('#set-caspar-dl-inputs').value = String(cs.decklink_input_count ?? 0)
	const im = cs.inputs_channel_mode || '1080p5000'
	const inSel = modal.querySelector('#set-caspar-inputs-mode')
	if ([...inSel.options].some((o) => o.value === im)) inSel.value = im
	modal.querySelector('#set-caspar-config-path').value = cs.configPath || ''
	const ndiAlEl = modal.querySelector('#set-caspar-ndi-auto-load')
	if (ndiAlEl) ndiAlEl.checked = cs.ndi_auto_load !== false && cs.ndi_auto_load !== 'false'
	renderCasparScreenRows(modal, cs, cfg.audioRouting || {})
}

export function wireCasparSettingsModal(modal) {
	modal.querySelector('#set-caspar-screen-count').addEventListener('change', () => {
		const cur = collectCasparServerFromUI(modal)
		const openalAr = collectOpenalAudioRoutingFromModal(modal)
		cur.screen_count = parseInt(modal.querySelector('#set-caspar-screen-count').value, 10) || 1
		const ar = { ...(settingsState.getSettings()?.audioRouting || {}), ...openalAr }
		renderCasparScreenRows(modal, cur, ar)
	})

	modal.querySelector('#set-offline-mode').addEventListener('change', () => updateCasparApplyHint(modal))

	modal.querySelector('#set-caspar-mv-enabled').addEventListener('change', () => syncMultiviewConsumerVisibility(modal))
	const mvOutEl = modal.querySelector('#set-caspar-mv-output')
	if (mvOutEl) mvOutEl.addEventListener('change', () => syncMultiviewConsumerVisibility(modal))

	const bpEl = modal.querySelector('#set-caspar-build-profile')
	if (bpEl) {
		bpEl.addEventListener('change', () => {
			const cur = collectCasparServerFromUI(modal)
			const openalAr = collectOpenalAudioRoutingFromModal(modal)
			const ar = { ...(settingsState.getSettings()?.audioRouting || {}), ...openalAr }
			renderCasparScreenRows(modal, cur, ar)
		})
	}

	modal.addEventListener('click', (e) => {
		if (e.target?.closest?.('#set-caspar-pa-devices-refresh')) {
			e.preventDefault()
			void refreshPortAudioDeviceLists(modal)
		}
	})

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
		if (!confirm('Overwrite the Caspar config file on the server and send RESTART? Caspar will reload.')) return
		try {
			const casparServer = buildCasparServerPayload(modal)
			const audioRouting = {
				...(settingsState.getSettings()?.audioRouting || {}),
				...collectOpenalAudioRoutingFromModal(modal),
			}
			const res = await api.post('/api/caspar-config/apply', { casparServer, audioRouting })
			const extra = res.path ? `\n\n${res.path}` : ''
			alert((res.message || 'OK') + extra)
		} catch (e) {
			alert('Apply failed: ' + e.message)
		}
	})
}
