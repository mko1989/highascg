/**
 * Live input sources band for Device View (DeckLink, NDI, USB, live audio, webpage).
 * Configured host channels render as destination cards above (with cable output ports).
 */
import { CASPAR_HOST } from './device-view-helpers.js'
import { isDecklinkIoIn } from '../lib/decklink-io-direction.js'
import { decklinkSlotFromConnector } from '../lib/input-channels.js'
import {
	hostChannelDestinationId,
	hostDestinationIdForExtraLiveSource,
	listHostChannelDestinations,
	reconcileExtraLiveSourceChannel,
} from '../lib/device-view-host-channels.js'
import { effectiveChannelMap } from '../lib/planned-channel-map.js'
import { getAppStateStore } from '../lib/app-runtime.js'
import { showLiveInputModal } from './live-input-modal.js'

export function openAddLiveSourceModal({ load, statusEl, setStatusFn }) {
	const store = getAppStateStore()
	if (!store) {
		if (typeof setStatusFn === 'function' && statusEl) {
			setStatusFn(statusEl, 'App not ready — open Devices again after the UI loads.', false)
		}
		return
	}
	showLiveInputModal(store, {
		onAdded: () => {
			void load?.()
		},
	})
}

function allConnectors(lastPayload) {
	return [
		...(Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []),
		...(Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []),
	]
}

function activeHostDestinationIds(lastPayload) {
	return new Set(listHostChannelDestinations(lastPayload).map((h) => String(h?.id || '')).filter(Boolean))
}

function detailForExtra(x, lastPayload) {
	const cm = effectiveChannelMap({
		payload: lastPayload,
		settings: lastPayload?._settings,
		liveChannelMap: getAppStateStore()?.getState?.()?.channelMap,
	})
	const row = reconcileExtraLiveSourceChannel(x, cm)
	const routeType = String(row?.routeType || '').toLowerCase()
	const type = String(row?.type || '').toLowerCase()
	if (routeType === 'decklink' || row?.decklinkSlot != null) {
		const ch = row?.inputsChannel != null ? `ch ${row.inputsChannel}` : ''
		const dev = row?.decklinkDevice != null ? `device ${row.decklinkDevice}` : ''
		return [ch, dev].filter(Boolean).join(' · ') || 'DeckLink'
	}
	if (type === 'ndi' || routeType === 'ndi_host') return 'NDI'
	if (type === 'browser' || routeType === 'webpage_host') return 'Webpage'
	if (routeType === 'live_audio') return 'Live audio'
	if (routeType === 'v4l2') return 'USB video'
	if (type === 'route' && x?.value) return String(x.value)
	return type || 'Live source'
}

function collectUnlistedLiveSourceRows(lastPayload) {
	const hostIds = activeHostDestinationIds(lastPayload)
	const suggested = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
	const extra = Array.isArray(lastPayload?.extraLiveSources) ? lastPayload.extraLiveSources : []
	const rows = []

	for (const x of extra) {
		const hostId = hostDestinationIdForExtraLiveSource(x)
		if (hostId && hostIds.has(hostId)) continue
		const routeType = String(x?.routeType || '').toLowerCase()
		const label = String(x?.label || x?.ndiName || x?.value || 'Live source')
		let connectorId = String(x?.connectorId || '').trim() || null
		if ((routeType === 'decklink' || x?.decklinkSlot != null) && !connectorId && x.decklinkSlot != null) {
			const io = allConnectors(lastPayload).find(
				(c) => c?.kind === 'decklink_io' && decklinkSlotFromConnector(c) === Number(x.decklinkSlot),
			)
			connectorId = io?.id || null
		}
		rows.push({
			label,
			detail: detailForExtra(x, lastPayload),
			connectorId,
			portKey: connectorId ? `conn:${connectorId}` : `live_extra:${x.value || label}`,
			extra: x,
		})
	}

	for (const c of suggested.filter((x) => x?.deviceId === CASPAR_HOST && x.kind === 'v4l2_in')) {
		const slot = parseInt(String(c?.index ?? ''), 10)
		const hostId =
			Number.isFinite(slot) && slot >= 0
				? hostChannelDestinationId('v4l2_input', 1, slot + 1)
				: null
		if (hostId && hostIds.has(hostId)) continue
		rows.push({
			label: c.label || c.externalRef || c.id,
			detail: String(c.externalRef || 'USB video'),
			connectorId: c.id,
			portKey: c.id ? `conn:${c.id}` : null,
			extra: null,
		})
	}

	const deckSlotsShown = new Set()
	for (const x of extra) {
		const hostId = hostDestinationIdForExtraLiveSource(x)
		if (hostId && hostIds.has(hostId) && x.decklinkSlot != null) {
			const slot = Number(x.decklinkSlot)
			if (Number.isFinite(slot) && slot >= 1) deckSlotsShown.add(slot)
		}
	}
	const deckInputs = (lastPayload?.live?.decklink?.inputs || []).filter((i) => {
		const slot = Number(i?.slot) || 0
		if (slot <= 0 || deckSlotsShown.has(slot)) return false
		const hostId = hostChannelDestinationId('decklink_input', Number(i.hostChannel) || 1, slot)
		if (hostIds.has(hostId)) return false
		const io = suggested.find((c) => c?.kind === 'decklink_io' && decklinkSlotFromConnector(c) === slot)
		return io ? isDecklinkIoIn(io) : String(i?.ioDirection || '').toLowerCase() === 'in'
	})

	for (const i of deckInputs) {
		const connectorId =
			allConnectors(lastPayload).find(
				(c) => c?.kind === 'decklink_io' && decklinkSlotFromConnector(c) === Number(i.slot),
			)?.id || null
		rows.push({
			label: `DeckLink input ${i.slot}`,
			detail: `device ${i.resolvedDevice || i.device || '?'}`,
			connectorId,
			portKey: connectorId ? `conn:${connectorId}` : `decklink_slot:${i.slot}`,
			extra: null,
		})
	}

	return rows
}

export function renderLiveSourcesBand(ctx) {
	const { lastPayload, onAddLiveSource, selectedKey, onPortClick } = ctx
	const band = document.createElement('div')
	band.className = 'device-view__band device-view__band--live-sources'
	band.innerHTML =
		'<div class="device-view__destinations-head"><h3 style="margin:0">Add live input</h3><button type="button" class="header-btn" data-add-live-source title="Add DeckLink, NDI, USB video, live audio, or webpage">+</button></div><div class="device-view__ports" data-live-source-ports></div>'

	const addBtn = band.querySelector('[data-add-live-source]')
	if (addBtn) {
		addBtn.addEventListener('click', () => {
			if (typeof onAddLiveSource === 'function') onAddLiveSource()
		})
	}

	const ports = band.querySelector('[data-live-source-ports]')
	const rows = collectUnlistedLiveSourceRows(lastPayload)
	const connectors = allConnectors(lastPayload)
	const hostCount = listHostChannelDestinations(lastPayload).length

	if (!rows.length) {
		ports.appendChild(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note device-view__live-sources-note',
				textContent: hostCount
					? 'Configured live inputs appear above as host channel destinations — use the output dot on the right to cable to Record, Stream, or other outputs.'
					: 'No live inputs yet. Click + to add DeckLink, NDI, USB video, or live audio.',
			}),
		)
		return band
	}

	for (const row of rows) {
		const canSelect = !!(row.connectorId && typeof onPortClick === 'function')
		const el = document.createElement(canSelect ? 'button' : 'div')
		el.className =
			'device-view__port device-view__live-source-port' + (canSelect ? '' : ' device-view__port--readonly')
		if (canSelect) el.type = 'button'
		if (row.portKey) el.dataset.portKey = row.portKey
		if (row.connectorId) el.setAttribute('data-connector-id', row.connectorId)
		el.append(
			Object.assign(document.createElement('span'), { textContent: row.label }),
			Object.assign(document.createElement('small'), { textContent: row.detail }),
		)
		if (canSelect) {
			const conn = connectors.find((c) => String(c?.id || '') === row.connectorId) || { id: row.connectorId }
			el.addEventListener('click', () => {
				onPortClick(row.portKey, row.connectorId, { type: 'decklink_io', connector: conn, extra: row.extra })
			})
		}
		if (selectedKey && row.portKey && selectedKey === row.portKey) {
			el.classList.add('device-view__port--selected')
		}
		ports.appendChild(el)
	}
	return band
}
