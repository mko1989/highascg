/**
 * Caspar Host setup for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'

export function renderCasparSettingsInspector(host, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, showSettingsModal }) {
	const s = currentSettings && typeof currentSettings === 'object' ? currentSettings : {}
	const cs = s?.casparServer && typeof s.casparServer === 'object' ? s.casparServer : {}
	const ar = s?.audioRouting && typeof s.audioRouting === 'object' ? s.audioRouting : {}
	const screenCount = Math.max(1, Math.min(4, parseInt(String(cs.screen_count ?? s?.screen_count ?? 1), 10) || 1))
	const box = document.createElement('div')
	box.className = 'device-view__inspector-links'
	const htmlRows = []
	for (let n = 1; n <= screenCount; n++) {
		htmlRows.push(`
			<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
				<strong>Screen ${n}</strong>
				<label class="device-view__cablemode">Mode <input type="text" data-k="screen_${n}_mode" value="${String(cs[`screen_${n}_mode`] || '1080p5000').replace(/"/g, '&quot;')}" /></label>
			</div>
		`)
	}
	const currentProfile = String(cs.caspar_build_profile || 'stock')
	box.innerHTML = `
		<p class="device-view__note"><strong>Caspar host setup</strong></p>
		<label class="device-view__cablemode">AMCP host <input type="text" data-k="caspar.host" value="${String(s?.caspar?.host || '').replace(/"/g, '&quot;')}" /></label>
		<label class="device-view__cablemode">AMCP port <input type="number" min="1" max="65535" data-k="caspar.port" value="${parseInt(String(s?.caspar?.port ?? 5250), 10) || 5250}" /></label>
		<label class="device-view__cablemode"><input type="checkbox" data-k="osc.enabled" ${(s?.osc?.enabled !== false) ? 'checked' : ''} /> OSC enabled</label>
		<label class="device-view__cablemode">OSC listen port <input type="number" min="1" max="65535" data-k="osc.listenPort" value="${parseInt(String(s?.osc?.listenPort ?? 6251), 10) || 6251}" /></label>
		<label class="device-view__cablemode">Inputs host <select data-k="decklink_inputs_host"><option value="dedicated" ${String(cs.decklink_inputs_host || 'dedicated') === 'dedicated' ? 'selected' : ''}>Dedicated</option><option value="preview_1" ${String(cs.decklink_inputs_host || '') === 'preview_1' ? 'selected' : ''}>Preview 1</option><option value="multiview_if_match" ${String(cs.decklink_inputs_host || '') === 'multiview_if_match' ? 'selected' : ''}>Multiview if match</option></select></label>
		${htmlRows.join('')}
		<p class="device-view__note"><strong>Build profile</strong></p>
		<label class="device-view__cablemode">CasparCG build <select data-k="caspar_build_profile"><option value="custom_live" ${currentProfile === 'custom_live' ? 'selected' : ''}>Custom Live (PortAudio, extended screen)</option><option value="stock" ${currentProfile === 'stock' ? 'selected' : ''}>Stock (standard CasparCG)</option></select></label>
		<p class="device-view__note"><strong>Audio Monitoring</strong></p>
		<label class="device-view__cablemode">Browser monitor <select data-k="audio.browserMonitor"><option value="pgm" ${String(ar.browserMonitor || 'pgm') === 'pgm' ? 'selected' : ''}>PGM</option><option value="off" ${String(ar.browserMonitor || '') === 'off' ? 'selected' : ''}>Off</option></select></label>
		<p class="device-view__note"><strong>System Actions</strong></p>
		<button class="device-view__btn device-view__btn--danger" onclick="if(confirm('PURGE ALL CONFIG? This will reset everything to factory defaults.')) fetch('/api/config/reset',{method:'POST',body:JSON.stringify({reset:true})}).then(()=>location.reload())">Factory Reset</button>
	`
	// Show/hide PortAudio warning dynamically when build profile changes
	const profileSel = box.querySelector('[data-k="caspar_build_profile"]')
	const paWarning = box.querySelector('[data-portaudio-warning]')
	if (profileSel && paWarning) {
		profileSel.addEventListener('change', () => {
			paWarning.style.display = profileSel.value === 'custom_live' ? 'none' : ''
		})
	}
	const save = Object.assign(document.createElement('button'), { type: 'button', className: 'header-btn', textContent: 'Save Caspar host setup' })
	save.onclick = async () => {
		const get = (k) => box.querySelector(`[data-k="${k}"]`)
		const patch = {
			caspar: {
				host: String(get('caspar.host')?.value || '').trim() || String(s?.caspar?.host || ''),
				port: Math.max(1, parseInt(String(get('caspar.port')?.value || s?.caspar?.port || 5250), 10) || 5250),
			},
			osc: {
				enabled: !!get('osc.enabled')?.checked,
				listenPort: Math.max(1, parseInt(String(get('osc.listenPort')?.value || s?.osc?.listenPort || 6251), 10) || 6251),
			},
			casparServer: {
				decklink_inputs_host: String(get('decklink_inputs_host')?.value || 'dedicated'),
				caspar_build_profile: String(get('caspar_build_profile')?.value || 'custom_live'),
			},
			audioRouting: {
				browserMonitor: String(get('audio.browserMonitor')?.value || 'pgm'),
			},
		}
		for (let n = 1; n <= screenCount; n++) {
			patch.casparServer[`screen_${n}_mode`] = String(get(`screen_${n}_mode`)?.value || '1080p5000').trim() || '1080p5000'
		}
		try {
			await Actions.saveSettingsPatch(patch)
			setCasparRestartDirty(true)
			setStatus(statusEl, 'Saved Caspar host setup', true)
			await load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	const links = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const b = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Settings → Companion' })
	b.onclick = () => showSettingsModal('companion')
	links.append(b)

	host.append(links, save, box)
}
