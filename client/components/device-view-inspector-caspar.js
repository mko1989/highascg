/**
 * Caspar / HighAsCG server inspector — project frame rate, network, factory reset (WO-59).
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'
import { buildInspectorTable } from './device-view-ui-utils.js'
import { STANDARD_PROJECT_FPS, resolveProjectFpsFromSettings } from '../lib/project-fps.js'
import { api } from '../lib/api-client.js'
import { renderReplicationInspector } from './device-view-inspector-replication.js'

/**
 * @param {HTMLElement} host
 * @param {object} ctx
 */
export function renderCasparSettingsInspector(host, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty }) {
	const live = lastPayload?.live
	const s = currentSettings && typeof currentSettings === 'object' ? currentSettings : {}
	const projectFps = resolveProjectFpsFromSettings(s)
	const networkCfg = s.network && typeof s.network === 'object' ? s.network : {}

	// Keep #panel-inspector-scroll layout classes (panel-inspector__scroll); content lives in inner shell.
	host.innerHTML = ''
	const shell = document.createElement('div')
	shell.className = 'device-view__server-inspector'
	host.append(shell)

	const title = document.createElement('p')
	title.className = 'device-view__inspector-title'
	title.textContent = 'Server'
	shell.append(title)

	const rows = [
		{ label: 'Hostname', value: String(live?.host?.hostname || '-') },
		{ label: 'Hardware ID', value: String(live?.host?.hardwareId || '-') },
		{ label: 'Platform', value: String(live?.host?.platform || '-') },
		{ label: 'AMCP', value: live?.caspar?.connected ? 'connected' : 'disconnected' },
		{ label: 'Host', value: String(live?.caspar?.host || s?.caspar?.host || '-') },
	]
	shell.append(buildInspectorTable(rows))

	const projectSec = document.createElement('div')
	projectSec.className = 'device-view__inspector-section'
	projectSec.innerHTML = '<p class="device-view__note"><strong>Project</strong></p>'
	const fpsLab = document.createElement('label')
	fpsLab.className = 'device-view__field'
	fpsLab.innerHTML = '<span class="device-view__field-label">Default project frame rate</span>'
	const fpsSel = document.createElement('select')
	fpsSel.className = 'device-view__destinations-type'
	fpsSel.title = 'New outputs default to video modes matching this frame rate until customized'
	for (const f of STANDARD_PROJECT_FPS) {
		const opt = document.createElement('option')
		opt.value = String(f)
		opt.textContent = `${f} fps`
		if (Math.abs(f - projectFps) < 0.06) opt.selected = true
		fpsSel.append(opt)
	}
	fpsLab.append(fpsSel)
	const fpsHint = document.createElement('p')
	fpsHint.className = 'device-view__note small'
	fpsHint.textContent = 'Output video modes inherit this rate until you change them per connector.'
	projectSec.append(fpsLab, fpsHint)

	const saveFpsBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Save project frame rate',
	})
	saveFpsBtn.onclick = async () => {
		saveFpsBtn.disabled = true
		try {
			const fps = parseFloat(fpsSel.value)
			await Actions.saveSettingsPatch({
				machineProfile: { defaultProjectFps: fps },
			})
			setCasparRestartDirty(true)
			setStatus(statusEl, `Project frame rate saved (${fps} fps)`, true)
			await load()
		} catch (e) {
			setStatus(statusEl, e?.message || String(e), false)
		} finally {
			saveFpsBtn.disabled = false
		}
	}
	projectSec.append(saveFpsBtn)
	shell.append(projectSec)

	const netSec = document.createElement('div')
	netSec.className = 'device-view__inspector-section'
	netSec.innerHTML = '<p class="device-view__note"><strong>Network</strong></p>'
	const netStatus = document.createElement('p')
	netStatus.className = 'device-view__note small'
	netStatus.textContent = 'Loading…'
	netSec.append(netStatus)

	const ifaceLab = document.createElement('label')
	ifaceLab.className = 'device-view__field'
	ifaceLab.innerHTML = '<span class="device-view__field-label">Ethernet interface</span>'
	const ifaceSel = document.createElement('select')
	ifaceSel.className = 'device-view__destinations-type'
	ifaceLab.append(ifaceSel)

	const modeWrap = document.createElement('div')
	modeWrap.className = 'device-view__field'
	modeWrap.style.display = 'flex'
	modeWrap.style.gap = '0.75rem'
	modeWrap.style.flexWrap = 'wrap'
	const modeAuto = Object.assign(document.createElement('label'), { className: 'device-view__cablemode' })
	modeAuto.innerHTML = '<input type="radio" name="srv-net-mode" value="dhcp" checked /> Auto (DHCP)'
	const modeManual = Object.assign(document.createElement('label'), { className: 'device-view__cablemode' })
	modeManual.innerHTML = '<input type="radio" name="srv-net-mode" value="static" /> Manual (static)'

	const staticBox = document.createElement('div')
	staticBox.className = 'device-view__inspector-grid'
	staticBox.style.display = 'none'
	const ipIn = fieldInput('IPv4 address', networkCfg.static?.address || '')
	const prefixIn = fieldInput('Prefix length', String(networkCfg.static?.prefixLength ?? 24))
	const gwIn = fieldInput('Gateway', networkCfg.static?.gateway || '')
	const dnsIn = fieldInput('DNS', (networkCfg.static?.dns && networkCfg.static.dns[0]) || '')
	staticBox.append(ipIn.wrap, prefixIn.wrap, gwIn.wrap, dnsIn.wrap)

	function syncStaticVisible() {
		const manual = netSec.querySelector('input[name="srv-net-mode"][value="static"]')?.checked
		staticBox.style.display = manual ? '' : 'none'
	}
	modeWrap.append(modeAuto, modeManual)
	modeAuto.querySelector('input')?.addEventListener('change', syncStaticVisible)
	modeManual.querySelector('input')?.addEventListener('change', syncStaticVisible)

	const applyNetBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'header-btn',
		textContent: 'Apply network',
	})
	applyNetBtn.onclick = async () => {
		const iface = ifaceSel.value
		if (!iface) {
			setStatus(statusEl, 'Select an Ethernet interface', false)
			return
		}
		const mode = netSec.querySelector('input[name="srv-net-mode"]:checked')?.value === 'static' ? 'static' : 'dhcp'
		const body = {
			interface: iface,
			mode,
			static: {
				address: ipIn.input.value.trim(),
				prefixLength: parseInt(prefixIn.input.value, 10) || 24,
				gateway: gwIn.input.value.trim(),
				dns: dnsIn.input.value.trim() ? [dnsIn.input.value.trim()] : [],
			},
		}
		applyNetBtn.disabled = true
		try {
			const res = await api.post('/api/system/network/apply', body)
			setStatus(statusEl, res?.log || 'Network applied', true)
			await refreshNetwork()
			await load()
		} catch (e) {
			setStatus(statusEl, e?.message || String(e), false)
		} finally {
			applyNetBtn.disabled = false
		}
	}

	netSec.append(ifaceLab, modeWrap, staticBox, applyNetBtn)
	shell.append(netSec)

	renderReplicationInspector(shell, { statusEl, load })

	async function refreshNetwork() {
		try {
			const st = await api.get('/api/system/network')
			ifaceSel.innerHTML = ''
			const ifaces = Array.isArray(st?.interfaces) ? st.interfaces : []
			if (!ifaces.length) {
				const opt = document.createElement('option')
				opt.value = ''
				opt.textContent = '(no Ethernet found)'
				ifaceSel.append(opt)
			}
			for (const i of ifaces) {
				const opt = document.createElement('option')
				opt.value = i.name
				const addr = i.address ? ` — ${i.address}` : ''
				opt.textContent = `${i.name}${addr}`
				if (i.name === (st.primaryInterface || networkCfg.primaryInterface)) opt.selected = true
				ifaceSel.append(opt)
			}
			const active = st.active
			const applied = st.appliedMode || 'unknown'
			netStatus.textContent = active
				? `Current: ${active.address || 'no IPv4'} · ${applied} · ${active.operstate || 'link?'}`
				: 'No active Ethernet interface detected'
			const cfgMode = networkCfg.mode === 'static' ? 'static' : 'dhcp'
			const pick = st.appliedMode === 'static' || st.appliedMode === 'dhcp' ? st.appliedMode : cfgMode
			const radio = netSec.querySelector(`input[name="srv-net-mode"][value="${pick}"]`)
			if (radio) radio.checked = true
			syncStaticVisible()
		} catch (e) {
			netStatus.textContent = `Network status unavailable: ${e?.message || e}`
		}
	}
	void refreshNetwork()

	const danger = document.createElement('div')
	danger.className = 'device-view__inspector-section device-view__inspector-section--danger'
	danger.innerHTML = '<p class="device-view__note"><strong>Danger zone</strong></p>'
	const factoryResetBtn = Object.assign(document.createElement('button'), {
		type: 'button',
		className: 'device-view__btn device-view__btn--danger',
		textContent: 'Factory reset',
	})
	factoryResetBtn.onclick = async () => {
		if (
			!confirm(
				'PURGE ALL CONFIG? This resets Device View / Caspar settings to factory defaults, clears all looks, and loads an empty Untitled project.',
			)
		) {
			return
		}
		factoryResetBtn.disabled = true
		try {
			await Actions.factoryResetConfig()
			location.reload()
		} catch (e) {
			factoryResetBtn.disabled = false
			setStatus(statusEl, e?.message || String(e), false)
		}
	}
	danger.append(factoryResetBtn)
	shell.append(danger)
}

/**
 * @param {string} label
 * @param {string} value
 */
function fieldInput(label, value) {
	const wrap = Object.assign(document.createElement('label'), { className: 'device-view__field' })
	const span = Object.assign(document.createElement('span'), { className: 'device-view__field-label', textContent: label })
	const input = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'text',
		value,
	})
	wrap.append(span, input)
	return { wrap, input }
}
