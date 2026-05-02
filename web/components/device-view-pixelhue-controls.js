/**
 * PixelHue quick controls for Device View.
 *
 * SWITCHER INTEGRATION STATUS: DISABLED (PARKED)
 * - This module is intentionally detached from active Device View.
 * - Kept for future re-enable work.
 */
import * as Actions from './device-view-actions-switchers.js'

export function renderPixelhueControls(host, { setStatus, loadPixelhueDataCallback }) {
	const panel = document.createElement('div'); panel.className = 'device-view__inspector-links'
	const info = document.createElement('p'); info.className = 'device-view__note'
	info.textContent = 'PixelHue quick controls: screen control, layer routing/geometry, UMD and layer style.'
	const reloadBtn = document.createElement('button'); reloadBtn.type = 'button'; reloadBtn.className = 'header-btn'; reloadBtn.textContent = 'Refresh PixelHue data'
	const ftbOnBtn = document.createElement('button'); ftbOnBtn.type = 'button'; ftbOnBtn.className = 'header-btn'; ftbOnBtn.textContent = 'FTB On (all screens)'
	const ftbOffBtn = document.createElement('button'); ftbOffBtn.type = 'button'; ftbOffBtn.className = 'header-btn'; ftbOffBtn.textContent = 'FTB Off (all screens)'
	const freezeOnBtn = document.createElement('button'); freezeOnBtn.type = 'button'; freezeOnBtn.className = 'header-btn'; freezeOnBtn.textContent = 'Freeze On (all screens)'
	const freezeOffBtn = document.createElement('button'); freezeOffBtn.type = 'button'; freezeOffBtn.className = 'header-btn'; freezeOffBtn.textContent = 'Freeze Off (all screens)'
	const screenRow = document.createElement('div'); screenRow.className = 'device-view__links'
	const screenSel = document.createElement('select'); screenSel.className = 'device-view__destinations-type'
	const screenDirectionSel = document.createElement('select'); screenDirectionSel.className = 'device-view__destinations-type'; screenDirectionSel.innerHTML = '<option value="0">Direction: PVW->PGM</option><option value="1">Direction: PGM->PVW</option>'
	const screenSwapChk = document.createElement('label'); screenSwapChk.className = 'device-view__cablemode'
	const screenSwapInput = document.createElement('input'); screenSwapInput.type = 'checkbox'; screenSwapInput.checked = true
	screenSwapChk.append(screenSwapInput, document.createTextNode(' swap'))
	const screenEffectSel = document.createElement('select'); screenEffectSel.className = 'device-view__destinations-type'; screenEffectSel.innerHTML = '<option value="0">Effect: default</option><option value="1">Effect: custom</option>'
	const screenFxTypeSel = document.createElement('select'); screenFxTypeSel.className = 'device-view__destinations-type'; screenFxTypeSel.innerHTML = '<option value="1">Switch: fade</option><option value="0">Switch: cut</option>'
	const screenTimeInput = document.createElement('input'); screenTimeInput.type = 'number'; screenTimeInput.className = 'math-input'; screenTimeInput.placeholder = 'ms'; screenTimeInput.value = '500'
	const takeBtn = document.createElement('button'); takeBtn.type = 'button'; takeBtn.className = 'header-btn'; takeBtn.textContent = 'Take screen'
	const cutBtn = document.createElement('button'); cutBtn.type = 'button'; cutBtn.className = 'header-btn'; cutBtn.textContent = 'Cut screen'
	const sFtbOnBtn = document.createElement('button'); sFtbOnBtn.type = 'button'; sFtbOnBtn.className = 'header-btn'; sFtbOnBtn.textContent = 'FTB on'
	const sFtbOffBtn = document.createElement('button'); sFtbOffBtn.type = 'button'; sFtbOffBtn.className = 'header-btn'; sFtbOffBtn.textContent = 'FTB off'
	const sFreezeOnBtn = document.createElement('button'); sFreezeOnBtn.type = 'button'; sFreezeOnBtn.className = 'header-btn'; sFreezeOnBtn.textContent = 'Freeze on'
	const sFreezeOffBtn = document.createElement('button'); sFreezeOffBtn.type = 'button'; sFreezeOffBtn.className = 'header-btn'; sFreezeOffBtn.textContent = 'Freeze off'
	screenRow.append(screenSel, screenDirectionSel, screenSwapChk, screenEffectSel, screenFxTypeSel, screenTimeInput, takeBtn, cutBtn, sFtbOnBtn, sFtbOffBtn, sFreezeOnBtn, sFreezeOffBtn)

	const layerRow = document.createElement('div'); layerRow.className = 'device-view__links'
	const layerSel = document.createElement('select'); layerSel.className = 'device-view__destinations-type'
	const layerApplyBtn = document.createElement('button'); layerApplyBtn.type = 'button'; layerApplyBtn.className = 'header-btn'; layerApplyBtn.textContent = 'Select layer'
	layerRow.append(layerSel, layerApplyBtn)

	const sourceRow = document.createElement('div'); sourceRow.className = 'device-view__links'
	const ifaceSel = document.createElement('select'); ifaceSel.className = 'device-view__destinations-type'
	const sourceApplyBtn = document.createElement('button'); sourceApplyBtn.type = 'button'; sourceApplyBtn.className = 'header-btn'; sourceApplyBtn.textContent = 'Route source to layer'
	sourceRow.append(ifaceSel, sourceApplyBtn)

	const zRow = document.createElement('div'); zRow.className = 'device-view__links'
	const zInput = document.createElement('input'); zInput.type = 'number'; zInput.className = 'math-input'; zInput.placeholder = 'Z-order'
	const zApplyBtn = document.createElement('button'); zApplyBtn.type = 'button'; zApplyBtn.className = 'header-btn'; zApplyBtn.textContent = 'Apply z-order'
	zRow.append(zInput, zApplyBtn)

	const winRow = document.createElement('div'); winRow.className = 'device-view__links'
	const xInput = document.createElement('input'); xInput.type = 'number'; xInput.className = 'math-input'; xInput.placeholder = 'x'
	const yInput = document.createElement('input'); yInput.type = 'number'; yInput.className = 'math-input'; yInput.placeholder = 'y'
	const wInput = document.createElement('input'); wInput.type = 'number'; wInput.className = 'math-input'; wInput.placeholder = 'w'
	const hInput = document.createElement('input'); hInput.type = 'number'; hInput.className = 'math-input'; hInput.placeholder = 'h'
	const winApplyBtn = document.createElement('button'); winApplyBtn.type = 'button'; winApplyBtn.className = 'header-btn'; winApplyBtn.textContent = 'Apply window'
	winRow.append(xInput, yInput, wInput, hInput, winApplyBtn)

	const umdRow = document.createElement('div'); umdRow.className = 'device-view__links'
	const umdInput = document.createElement('input'); umdInput.type = 'text'; umdInput.className = 'math-input'; umdInput.placeholder = 'UMD text'
	const umdApplyBtn = document.createElement('button'); umdApplyBtn.type = 'button'; umdApplyBtn.className = 'header-btn'; umdApplyBtn.textContent = 'Apply UMD'
	umdRow.append(umdInput, umdApplyBtn)

	const presetRow = document.createElement('div'); presetRow.className = 'device-view__links'
	const presetSel = document.createElement('select'); presetSel.className = 'device-view__destinations-type'
	const presetApplyBtn = document.createElement('button'); presetApplyBtn.type = 'button'; presetApplyBtn.className = 'header-btn'; presetApplyBtn.textContent = 'Apply layer style'
	presetRow.append(presetSel, presetApplyBtn)
	const showPresetRow = document.createElement('div'); showPresetRow.className = 'device-view__links'
	const showPresetSel = document.createElement('select'); showPresetSel.className = 'device-view__destinations-type'
	const showPresetTarget = document.createElement('select'); showPresetTarget.className = 'device-view__destinations-type'; showPresetTarget.innerHTML = '<option value="4">Load to Preview</option><option value="2">Load to Program</option>'
	const showPresetApplyBtn = document.createElement('button'); showPresetApplyBtn.type = 'button'; showPresetApplyBtn.className = 'header-btn'; showPresetApplyBtn.textContent = 'Apply show preset'
	showPresetRow.append(showPresetSel, showPresetTarget, showPresetApplyBtn)
	const backupRow = document.createElement('div'); backupRow.className = 'device-view__links'
	const backupInput = document.createElement('textarea'); backupInput.className = 'math-input'; backupInput.rows = 4; backupInput.placeholder = 'Source backup JSON'
	const backupApplyBtn = document.createElement('button'); backupApplyBtn.type = 'button'; backupApplyBtn.className = 'header-btn'; backupApplyBtn.textContent = 'Write source backup'
	backupRow.append(backupInput, backupApplyBtn)

	async function loadPixelhueData() {
		layerSel.innerHTML = '<option value="">Loading layers…</option>'; ifaceSel.innerHTML = '<option value="">Loading interfaces…</option>'; presetSel.innerHTML = '<option value="">Loading styles…</option>'
		try {
			const d = await Actions.getPixelhueDeviceData(); const list = d.layers || []; const ifaces = d.interfaces || []; const presets = d.layerPresets || []; const showPresets = d.presets || []; const screens = d.screens || []
			screenSel.innerHTML = screens.length ? '' : '<option value="">No screens</option>'
			for (const s of screens) {
				const sid = Number(s?.screenId)
				if (sid > 0) {
					const opt = document.createElement('option')
					opt.value = String(sid)
					opt.dataset.json = JSON.stringify(s)
					opt.textContent = `${sid}: ${String(s?.general?.name || s?.screenName || `Screen ${sid}`)}`
					screenSel.append(opt)
				}
			}
			layerSel.innerHTML = list.length ? '' : '<option value="">No layers</option>'; for (const l of list) { const id = Number(l?.layerId); if (id > 0) { const opt = document.createElement('option'); opt.value = String(id); opt.textContent = `${id}: ${String(l?.name || l?.general?.name || '').trim() || `Layer ${id}`}${Number(l?.selected) === 1 ? ' (selected)' : ''}`; layerSel.append(opt) } }
			ifaceSel.innerHTML = ifaces.length ? '' : '<option value="">No interfaces</option>'; for (const it of ifaces) { const iid = Number(it?.interfaceId); if (iid > 0) { const opt = document.createElement('option'); opt.value = String(iid); opt.dataset.interfaceType = String(it?.auxiliaryInfo?.connectorInfo?.interfaceType ?? 0); opt.dataset.connectorType = String(it?.auxiliaryInfo?.connectorInfo?.type ?? 0); opt.textContent = `${iid}: ${String(it?.general?.name || it?.interfaceName || `Input ${iid}`).trim()}${it?.live?.signal ? ` (${it.live.signal})` : ''}`; ifaceSel.append(opt) } }
			presetSel.innerHTML = presets.length ? '' : '<option value="">No layer styles</option>'; for (const p of presets) { const pid = Number(p?.presetId ?? p?.id ?? p?.serial); const pName = String(p?.name || p?.presetName || `Style ${pid}`).trim(); const opt = document.createElement('option'); opt.value = Number.isFinite(pid) ? String(pid) : ''; opt.textContent = Number.isFinite(pid) ? `${pid}: ${pName}` : pName; opt.dataset.json = JSON.stringify(p); presetSel.append(opt) }
			showPresetSel.innerHTML = showPresets.length ? '' : '<option value="">No show presets</option>'; for (const p of showPresets) { const pName = String(p?.name || p?.presetName || p?.general?.name || '').trim(); const id = String(p?.guid || p?.presetId || p?.id || '').trim(); const label = pName || (id ? `Preset ${id}` : 'Preset'); const opt = document.createElement('option'); opt.value = id; opt.textContent = label; opt.dataset.json = JSON.stringify(p); showPresetSel.append(opt) }
			if (d.sourceBackup != null) backupInput.value = JSON.stringify(d.sourceBackup, null, 2)
			setStatus(`PixelHue ready (${screens.length} screens, ${list.length} layers, ${ifaces.length} inputs).`, true)
		} catch (e) { layerSel.innerHTML = '<option value="">Failed</option>'; screenSel.innerHTML = '<option value="">Failed</option>'; setStatus(String(e?.message || e), false) }
	}

	reloadBtn.addEventListener('click', () => void loadPixelhueData())
	ftbOnBtn.addEventListener('click', () => Actions.setPixelhueFtbAll(true).then(() => setStatus('FTB On', true)).catch(e => setStatus(e.message, false)))
	ftbOffBtn.addEventListener('click', () => Actions.setPixelhueFtbAll(false).then(() => setStatus('FTB Off', true)).catch(e => setStatus(e.message, false)))
	freezeOnBtn.addEventListener('click', () => Actions.setPixelhueFreezeAll(true).then(() => setStatus('Freeze On', true)).catch(e => setStatus(e.message, false)))
	freezeOffBtn.addEventListener('click', () => Actions.setPixelhueFreezeAll(false).then(() => setStatus('Freeze Off', true)).catch(e => setStatus(e.message, false)))
	takeBtn.addEventListener('click', () => {
		const o = screenSel.selectedOptions[0]
		if (!o?.dataset?.json) return
		Actions.takePixelhueScreen(JSON.parse(o.dataset.json), {
			direction: Number(screenDirectionSel.value || 0),
			swapEnable: !!screenSwapInput.checked,
			effectSelect: Number(screenEffectSel.value || 0),
			switchType: Number(screenFxTypeSel.value || 1),
			switchTime: Number(screenTimeInput.value || 500),
		}).then(() => setStatus('Screen take sent', true)).catch(e => setStatus(e.message, false))
	})
	cutBtn.addEventListener('click', () => {
		const o = screenSel.selectedOptions[0]
		if (!o?.dataset?.json) return
		Actions.cutPixelhueScreen(JSON.parse(o.dataset.json), {
			direction: Number(screenDirectionSel.value || 0),
			swapEnable: !!screenSwapInput.checked,
		}).then(() => setStatus('Screen cut sent', true)).catch(e => setStatus(e.message, false))
	})
	sFtbOnBtn.addEventListener('click', () => { const sid = Number(screenSel.value); if (!(sid > 0)) return; Actions.setPixelhueScreenFtb(sid, true).then(() => setStatus(`Screen ${sid} FTB on`, true)).catch(e => setStatus(e.message, false)) })
	sFtbOffBtn.addEventListener('click', () => { const sid = Number(screenSel.value); if (!(sid > 0)) return; Actions.setPixelhueScreenFtb(sid, false).then(() => setStatus(`Screen ${sid} FTB off`, true)).catch(e => setStatus(e.message, false)) })
	sFreezeOnBtn.addEventListener('click', () => { const sid = Number(screenSel.value); if (!(sid > 0)) return; Actions.setPixelhueScreenFreeze(sid, true).then(() => setStatus(`Screen ${sid} freeze on`, true)).catch(e => setStatus(e.message, false)) })
	sFreezeOffBtn.addEventListener('click', () => { const sid = Number(screenSel.value); if (!(sid > 0)) return; Actions.setPixelhueScreenFreeze(sid, false).then(() => setStatus(`Screen ${sid} freeze off`, true)).catch(e => setStatus(e.message, false)) })
	layerApplyBtn.addEventListener('click', () => { const id = Number(layerSel.value); if (id > 0) Actions.selectPixelhueLayer(id).then(() => { setStatus(`Layer ${id} selected`, true); loadPixelhueData() }).catch(e => setStatus(e.message, false)) })
	sourceApplyBtn.addEventListener('click', () => { const lId = Number(layerSel.value); const iId = Number(ifaceSel.value); const opt = ifaceSel.selectedOptions[0]; if (lId > 0 && iId > 0) Actions.setPixelhueLayerSource(lId, iId, Number(opt?.dataset?.interfaceType || 0), Number(opt?.dataset?.connectorType || 0)).then(() => setStatus(`Layer ${lId} routed`, true)).catch(e => setStatus(e.message, false)) })
	zApplyBtn.addEventListener('click', () => { const lId = Number(layerSel.value); const z = Number(zInput.value); if (lId > 0) Actions.setPixelhueLayerZorder(lId, z).then(() => setStatus(`Z-order ${z}`, true)).catch(e => setStatus(e.message, false)) })
	winApplyBtn.addEventListener('click', () => { const lId = Number(layerSel.value); if (lId > 0) Actions.setPixelhueLayerWindow(lId, xInput.value, yInput.value, wInput.value, hInput.value).then(() => setStatus('Window updated', true)).catch(e => setStatus(e.message, false)) })
	umdApplyBtn.addEventListener('click', () => { const lId = Number(layerSel.value); if (lId > 0) Actions.setPixelhueLayerUmdText(lId, umdInput.value).then(() => setStatus('UMD updated', true)).catch(e => setStatus(e.message, false)) })
	presetApplyBtn.addEventListener('click', () => { const lId = Number(layerSel.value); const opt = presetSel.selectedOptions[0]; if (lId > 0 && opt?.dataset?.json) Actions.applyPixelhueLayerPreset(lId, JSON.parse(opt.dataset.json)).then(() => setStatus('Style applied', true)).catch(e => setStatus(e.message, false)) })
	showPresetApplyBtn.addEventListener('click', () => { const opt = showPresetSel.selectedOptions[0]; if (!opt?.dataset?.json) return; Actions.applyPixelhuePresetToRegion(JSON.parse(opt.dataset.json), Number(showPresetTarget.value || 4)).then(() => setStatus('Show preset applied', true)).catch(e => setStatus(e.message, false)) })
	backupApplyBtn.addEventListener('click', () => {
		let payload = null
		try { payload = JSON.parse(backupInput.value || '{}') } catch (e) { setStatus(`Invalid backup JSON: ${e.message || e}`, false); return }
		Actions.setPixelhueSourceBackupRaw(payload).then(() => setStatus('Source backup written', true)).catch(e => setStatus(e.message, false))
	})

	panel.append(info, reloadBtn, ftbOnBtn, ftbOffBtn, freezeOnBtn, freezeOffBtn, screenRow, showPresetRow, layerRow, sourceRow, zRow, winRow, umdRow, presetRow, backupRow)
	host.append(panel); void loadPixelhueData()
}
