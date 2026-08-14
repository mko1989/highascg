/**
 * DeckLink host channel — change device on an existing input channel (AMCP only).
 */
import { changeDecklinkInputDevice, reloadDecklinkInputDevice } from '../lib/decklink-add-input.js'
import { decklinkSlotFromConnector } from '../lib/input-channels.js'
import { showAppToast } from '../lib/app-toast.js'
import { mountSourceLabelControl } from './inspector-source-label.js'

function listDecklinkIoConnectors(lastPayload) {
	return [
		...(Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []),
		...(Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []),
	].filter((c) => c?.kind === 'decklink_io')
}

function currentDecklinkDeviceForSlot(currentSettings, slot, fallback) {
	const cs = currentSettings?.casparServer || {}
	const fromSettings = parseInt(String(cs[`decklink_input_${slot}_device`] ?? 0), 10) || 0
	return fromSettings > 0 ? fromSettings : fallback
}

function buildDeviceOptions(lastPayload, slot, activeDevice) {
	const connectors = listDecklinkIoConnectors(lastPayload)
	const deviceOptions = connectors
		.map((c) => {
			const n = parseInt(String(c?.externalRef ?? 0), 10) || decklinkSlotFromConnector(c)
			const s = decklinkSlotFromConnector(c)
			return n > 0 ? { device: n, label: c?.label || `SDI ${s}` } : null
		})
		.filter(Boolean)
	const seen = new Set()
	const unique = deviceOptions.filter((o) => {
		if (seen.has(o.device)) return false
		seen.add(o.device)
		return true
	})
	if (activeDevice > 0 && !unique.some((o) => o.device === activeDevice)) {
		unique.unshift({ device: activeDevice, label: `Device ${activeDevice}` })
	}
	if (!unique.length && slot > 0) {
		unique.push({ device: slot, label: `Device ${slot}` })
	}
	return unique
}

/**
 * @param {HTMLElement} container
 * @param {{ source: object, slot: number, lastPayload?: object, currentSettings?: object, onApplied?: (r: object) => void }} opts
 */
export function mountDecklinkHostSourceControls(container, { source, slot, lastPayload, currentSettings, onApplied }) {
	// Owner request 2026-07-26: dedicated DeckLink input slots have NO extraLiveSources entry, so
	// `source` is null for them — the device switcher must still mount (the server's slot-only
	// update path stops the host channel and PLAYs the new DECKLINK device).
	if (slot < 1) return

	const activeDevice =
		parseInt(String(source?.decklinkDevice ?? 0), 10) ||
		currentDecklinkDeviceForSlot(currentSettings, slot, slot)
	const options = buildDeviceOptions(lastPayload, slot, activeDevice)

	const section = document.createElement('div')
	section.className = 'inspector-section inspector-decklink-host-controls'
	section.style.marginTop = '10px'

	/* WO-525: the SAME control the DeckLink ports inspector mounts, on the same key — owner asked for
	 * "shared label in host channel and in decklink ports inspector". Rendered before the title so it
	 * reads as the thing this section is about, and only when the source has a stable connector id. */
	mountSourceLabelControl(container, {
		connectorId: source?.connectorId,
		sources: lastPayload?.extraLiveSources,
		fallbackLabel: `DeckLink ${slot}`,
		onSaved: () => onApplied?.({ message: 'Label saved.' }),
	})

	const title = document.createElement('div')
	title.className = 'inspector-section__title'
	title.textContent = 'DeckLink device'
	section.appendChild(title)

	const sel = document.createElement('select')
	sel.className = 'device-view__select'
	sel.style.width = '100%'
	sel.style.marginBottom = '8px'
	for (const opt of options) {
		const o = document.createElement('option')
		o.value = String(opt.device)
		o.textContent = opt.label
		if (opt.device === activeDevice) o.selected = true
		sel.appendChild(o)
	}
	section.appendChild(sel)

	const btnRow = document.createElement('div')
	btnRow.style.display = 'flex'
	btnRow.style.gap = '8px'
	btnRow.style.flexWrap = 'wrap'

	const applyBtn = document.createElement('button')
	applyBtn.type = 'button'
	applyBtn.className = 'header-btn'
	applyBtn.textContent = 'Apply source'

	const reloadBtn = document.createElement('button')
	reloadBtn.type = 'button'
	reloadBtn.className = 'header-btn'
	reloadBtn.textContent = 'Reload'

	const runApply = async () => {
		const nextDevice = parseInt(String(sel.value ?? ''), 10) || 0
		if (nextDevice < 1) return
		applyBtn.disabled = true
		reloadBtn.disabled = true
		try {
			const r = await changeDecklinkInputDevice(null, {
				slot,
				device: nextDevice,
				connectorId: source?.connectorId,
				value: source?.value,
			})
			if (r?.source && source) source.decklinkDevice = r.source.decklinkDevice
			onApplied?.(r)
			showAppToast(r?.message || 'DeckLink source updated', 'info')
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
		} finally {
			applyBtn.disabled = false
			reloadBtn.disabled = false
		}
	}

	applyBtn.addEventListener('click', () => void runApply())
	reloadBtn.addEventListener('click', async () => {
		applyBtn.disabled = true
		reloadBtn.disabled = true
		try {
			const r = await reloadDecklinkInputDevice({
				slot,
				connectorId: source?.connectorId,
				value: source?.value,
			})
			onApplied?.(r)
			showAppToast(r?.message || 'DeckLink reloaded', 'info')
		} catch (err) {
			showAppToast(err?.message || String(err), 'error')
		} finally {
			applyBtn.disabled = false
			reloadBtn.disabled = false
		}
	})

	btnRow.append(applyBtn, reloadBtn)
	section.appendChild(btnRow)
	container.appendChild(section)
}
