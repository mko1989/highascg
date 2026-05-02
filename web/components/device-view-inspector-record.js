/**
 * Record Output controls for Device View inspector.
 */
import * as Actions from './device-view-actions.js'
import { setStatus } from './device-view-ui-utils.js'

export function renderRecordOutControls(h, conn, { currentSettings, statusEl, load, onRemoveRecordOutput }) {
	const wrapCtl = Object.assign(document.createElement('div'), { className: 'device-view__inspector-links' })
	const nameIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'text', placeholder: 'record output name', value: String(conn?.caspar?.name || conn?.label || '') })
	const crfIn = Object.assign(document.createElement('input'), { className: 'device-view__destinations-type', type: 'number', min: '18', max: '51', value: String(conn?.caspar?.crf ?? 26) })
	const vCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	vCodecSel.innerHTML = '<option value="h264">h264</option><option value="hevc">hevc</option>'
	vCodecSel.value = String(conn?.caspar?.videoCodec || 'h264').toLowerCase()
	const vBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '0',
		step: '100',
		placeholder: 'video kbps (0=CRF mode)',
		value: String(conn?.caspar?.videoBitrateKbps ?? 4500),
	})
	const presetSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	presetSel.innerHTML = '<option value="ultrafast">ultrafast</option><option value="veryfast">veryfast</option><option value="fast">fast</option><option value="medium">medium</option><option value="slow">slow</option>'
	presetSel.value = String(conn?.caspar?.encoderPreset || 'veryfast').toLowerCase()
	const aCodecSel = Object.assign(document.createElement('select'), { className: 'device-view__destinations-type' })
	aCodecSel.innerHTML = '<option value="aac">aac</option><option value="copy">copy</option><option value="none">none</option>'
	aCodecSel.value = String(conn?.caspar?.audioCodec || 'aac').toLowerCase()
	const aBitrateIn = Object.assign(document.createElement('input'), {
		className: 'device-view__destinations-type',
		type: 'number',
		min: '32',
		step: '32',
		placeholder: 'audio kbps',
		value: String(conn?.caspar?.audioBitrateKbps ?? 128),
	})
	const saveBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Save record settings' })
	const startBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Start record' })
	const stopBtn = Object.assign(document.createElement('button'), { className: 'header-btn', textContent: 'Stop record' })
	saveBtn.onclick = async () => {
		const cur = Array.isArray(currentSettings?.recordOutputs) ? currentSettings.recordOutputs : []
		const idx = cur.findIndex((x) => String(x?.id || '') === String(conn.id || ''))
		if (idx < 0) throw new Error('Record output not found')
		const name = String(nameIn.value || conn?.label || conn.id).trim() || String(conn?.label || conn.id)
		const crf = Math.min(51, Math.max(18, parseInt(String(crfIn.value || '26'), 10) || 26))
		const next = [...cur]
		next[idx] = {
			...next[idx],
			id: String(conn.id),
			name,
			label: String(next[idx]?.label || name),
			crf,
			videoCodec: String(vCodecSel.value || 'h264').toLowerCase(),
			videoBitrateKbps: Math.max(0, parseInt(String(vBitrateIn.value || '0'), 10) || 0),
			encoderPreset: String(presetSel.value || 'veryfast').toLowerCase(),
			audioCodec: String(aCodecSel.value || 'aac').toLowerCase(),
			audioBitrateKbps: Math.max(32, parseInt(String(aBitrateIn.value || '128'), 10) || 128),
		}
		await Actions.saveSettingsPatch({ recordOutputs: next })
		await load()
	}
	startBtn.onclick = async () => {
		try {
			const crf = Math.min(51, Math.max(18, parseInt(String(crfIn.value || '26'), 10) || 26))
			await Actions.startPgmRecord({
				outputId: String(conn.id),
				crf,
				videoCodec: String(vCodecSel.value || 'h264').toLowerCase(),
				videoBitrateKbps: Math.max(0, parseInt(String(vBitrateIn.value || '0'), 10) || 0),
				preset: String(presetSel.value || 'veryfast').toLowerCase(),
				audioCodec: String(aCodecSel.value || 'aac').toLowerCase(),
				audioBitrateKbps: Math.max(32, parseInt(String(aBitrateIn.value || '128'), 10) || 128),
			})
			setStatus(statusEl, `Recording started (${conn.id})`, true)
			await load()
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	stopBtn.onclick = async () => {
		try {
			await Actions.stopPgmRecord({ outputId: String(conn.id) })
			setStatus(statusEl, `Recording stopped (${conn.id})`, true)
			await load()
		} catch (e) { setStatus(statusEl, e.message, false) }
	}
	const removeBtn = Object.assign(document.createElement('button'), {
		className: 'header-btn',
		type: 'button',
		textContent: 'Remove record output',
		title: 'Remove this output from settings and clear its cables',
	})
	removeBtn.onclick = async () => {
		if (!onRemoveRecordOutput) return
		if (!confirm(`Remove record output ${conn.id}?`)) return
		try {
			await onRemoveRecordOutput(String(conn.id || ''))
		} catch (e) {
			setStatus(statusEl, e?.message || String(e), false)
		}
	}
	wrapCtl.append(nameIn, crfIn, vCodecSel, vBitrateIn, presetSel, aCodecSel, aBitrateIn, saveBtn, startBtn, stopBtn, removeBtn)
	h.append(wrapCtl)
	h.append(Object.assign(document.createElement('p'), { className: 'device-view__note', textContent: 'Use cable from destination to choose which channel this record output captures.' }))
}
