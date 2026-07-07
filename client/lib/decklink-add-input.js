/**
 * Add / remove a DeckLink SDI input slot from Sources → Live / Device View (WO-53 dedicated host channel).
 * Config changes mark Caspar restart dirty; capture starts only after manual Apply (or when the host channel already exists).
 */
import { api } from './api-client.js'
import { settingsState } from './settings-state.js'
import { markCasparRestartDirty } from './caspar-restart-hint.js'
import { decklinkInputForSlot, decklinkSlotFromConnector, routeForDecklinkSlot } from './input-channels.js'
import { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } from './decklink-io-direction.js'
import { hostChannelDestinationId } from './device-view-host-channels.js'
import { updateConnector, loadDeviceView } from '../components/device-view-actions.js'

/**
 * @param {object | null | undefined} payload
 * @param {number} devNum
 * @param {number} [preferredSlot]
 */
export function findDecklinkConnectorForDevice(payload, devNum, preferredSlot = 0) {
	const connectors = [
		...(Array.isArray(payload?.graph?.connectors) ? payload.graph.connectors : []),
		...(Array.isArray(payload?.suggested?.connectors) ? payload.suggested.connectors : []),
	].filter((c) => c?.kind === 'decklink_io')

	if (!connectors.length) return null

	if (preferredSlot > 0) {
		const bySlot = connectors.find((c) => decklinkSlotFromConnector(c) === preferredSlot)
		if (bySlot) return bySlot
	}

	if (devNum > 0) {
		const byDev = connectors.find((c) => parseInt(String(c?.externalRef ?? 0), 10) === devNum)
		if (byDev) return byDev
		if (devNum <= connectors.length) {
			return connectors.find((c) => decklinkSlotFromConnector(c) === devNum) || connectors[devNum - 1]
		}
	}

	return null
}

function channelMapFromPayload(stateStore, payload) {
	return {
		...(stateStore?.getState?.()?.channelMap || {}),
		...(payload?.live?.caspar?.channelMap || {}),
	}
}

function plannedChannelMap(stateStore, payload) {
	return {
		...channelMapFromPayload(stateStore, payload),
		...(settingsState.getSettings()?.channelMap || {}),
	}
}

function buildDecklinkLiveSource({ entry, resolvedSlot, devNum, connectorId, connector }) {
	const layer = entry?.layer ?? resolvedSlot
	const hostChannel = entry?.channel ?? null
	const routeValue =
		entry?.route ||
		(hostChannel != null ? `route://${hostChannel}-${layer}` : `decklink://${devNum}`)
	return {
		type: 'route',
		routeType: 'decklink',
		value: routeValue,
		label: entry?.label || connector?.label || `DeckLink ${resolvedSlot}`,
		decklinkSlot: resolvedSlot,
		inputsChannel: hostChannel,
		inputsLayer: layer,
		decklinkDevice: devNum,
		connectorId,
	}
}

async function playDecklinkOnHost(entry, resolvedSlot, devNum) {
	if (entry?.channel == null) return false
	const layer = entry.layer ?? resolvedSlot
	const cl = `${entry.channel}-${layer}`
	await api.post('/api/raw', { cmd: `STOP ${cl}` }).catch(() => {})
	await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }).catch(() => {})
	await api.post('/api/raw', { cmd: `PLAY ${cl} DECKLINK ${devNum}` })
	return true
}

/**
 * Change the Caspar DeckLink device index on an existing input host channel (AMCP only).
 * @param {import('./state-store.js').StateStore | null} stateStore
 * @param {{ slot: number, device: number, connectorId?: string, value?: string }} payload
 */
export async function changeDecklinkInputDevice(stateStore, { slot, device, connectorId, value }) {
	const resolvedSlot = parseInt(String(slot ?? ''), 10) || 0
	const devNum = parseInt(String(device ?? ''), 10) || 0
	if (resolvedSlot < 1) throw new Error('Invalid DeckLink input slot')
	if (devNum < 1) throw new Error('DeckLink device index must be ≥ 1')

	const r = await api.post('/api/host-live/decklink', {
		action: 'update',
		slot: resolvedSlot,
		decklinkDevice: devNum,
		...(connectorId ? { connectorId } : {}),
		...(value ? { value } : {}),
	})
	if (Array.isArray(r?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
		window.__highascgApplyExtraLiveSources(r.extraLiveSources)
	}
	return r
}

/**
 * Replay DeckLink capture on an existing input host channel.
 * @param {{ slot: number, connectorId?: string, value?: string }} payload
 */
export async function reloadDecklinkInputDevice({ slot, connectorId, value }) {
	const resolvedSlot = parseInt(String(slot ?? ''), 10) || 0
	if (resolvedSlot < 1) throw new Error('Invalid DeckLink input slot')
	return api.post('/api/host-live/decklink', {
		action: 'reload',
		slot: resolvedSlot,
		...(connectorId ? { connectorId } : {}),
		...(value ? { value } : {}),
	})
}

/**
 * @param {import('./state-store.js').StateStore | null} stateStore
 * @param {{ device?: number, slot?: number }} payload — prefer `slot` (SDI port); Caspar device index comes from the connector.
 */
export async function addDecklinkInputSlot(stateStore, { device, slot }) {
	const slotHint = parseInt(String(slot ?? ''), 10) || 0
	const devHint = parseInt(String(device ?? ''), 10) || 0
	if (slotHint <= 0 && devHint <= 0) {
		throw new Error('Pick an SDI port')
	}

	await settingsState.load()
	const prevCount = Math.max(
		0,
		parseInt(String(settingsState.getSettings()?.casparServer?.decklink_input_count ?? 0), 10) || 0,
	)

	let dv = await loadDeviceView()
	const connector = findDecklinkConnectorForDevice(dv, devHint, slotHint)
	if (!connector?.id) {
		throw new Error(
			slotHint > 0
				? `No DeckLink connector for SDI port ${slotHint} — open Device View and refresh`
				: 'No DeckLink connector — open Device View and refresh',
		)
	}

	const connectorId = String(connector.id).trim()
	const resolvedSlot = decklinkSlotFromConnector(connector)
	const devNum = Math.max(
		1,
		parseInt(String(connector?.externalRef ?? resolvedSlot), 10) || resolvedSlot,
	)
	const alreadyInput = normalizeDecklinkIoDirection(connector?.caspar) === 'in'
	const existingExtras = Array.isArray(dv?.extraLiveSources) ? dv.extraLiveSources : []
	const existingTile = existingExtras.find(
		(x) =>
			String(x?.connectorId || '') === connectorId ||
			(x?.routeType === 'decklink' && Number(x?.decklinkSlot) === resolvedSlot),
	)

	await updateConnector(connectorId, { caspar: { ioDirection: 'in' } })
	await settingsState.load()

	const newCount = Math.max(
		0,
		parseInt(String(settingsState.getSettings()?.casparServer?.decklink_input_count ?? 0), 10) || 0,
	)
	const casparRestartNeeded = newCount > prevCount
	if (casparRestartNeeded) markCasparRestartDirty()

	dv = await loadDeviceView()
	const planned = plannedChannelMap(stateStore, dv)
	let entry = decklinkInputForSlot(planned, resolvedSlot)
	const runtimeEntry = decklinkInputForSlot(channelMapFromPayload(stateStore, dv), resolvedSlot)
	const channelLive = runtimeEntry?.channel != null

	if (casparRestartNeeded) {
		const liveSource = buildDecklinkLiveSource({ entry, resolvedSlot, devNum, connectorId, connector })
		const addRes = await api.post('/api/device-view', { addExtraLiveSource: liveSource })
		if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
			window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
		}
		return {
			ok: true,
			slot: resolvedSlot,
			hostChannel: entry?.channel ?? null,
			route: liveSource.value,
			connectorId,
			casparRestartNeeded: true,
			pendingApply: true,
			extraLiveSources: addRes?.extraLiveSources,
		}
	}

	if (alreadyInput && existingTile && channelLive) {
		const routeValue =
			runtimeEntry.route ||
			routeForDecklinkSlot(channelMapFromPayload(stateStore, dv), resolvedSlot) ||
			`route://${runtimeEntry.channel}-${runtimeEntry.layer ?? resolvedSlot}`
		const prevDevice = parseInt(String(existingTile.decklinkDevice ?? 0), 10) || 0
		if (prevDevice !== devNum) {
			const changeRes = await api.post('/api/host-live/decklink', {
				action: 'update',
				slot: resolvedSlot,
				decklinkDevice: devNum,
				connectorId,
				value: routeValue,
			})
			if (Array.isArray(changeRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
				window.__highascgApplyExtraLiveSources(changeRes.extraLiveSources)
			}
			return {
				ok: true,
				slot: resolvedSlot,
				hostChannel: runtimeEntry.channel,
				route: routeValue,
				connectorId,
				casparRestartNeeded: false,
				extraLiveSources: changeRes?.extraLiveSources ?? existingExtras,
				alreadyConfigured: true,
			}
		}
		await playDecklinkOnHost(runtimeEntry, resolvedSlot, devNum)
		return {
			ok: true,
			slot: resolvedSlot,
			hostChannel: runtimeEntry.channel,
			route: routeValue,
			connectorId,
			casparRestartNeeded: false,
			extraLiveSources: existingExtras,
			alreadyConfigured: true,
		}
	}

	entry = runtimeEntry || entry
	if (!entry?.channel) {
		const liveSource = buildDecklinkLiveSource({ entry, resolvedSlot, devNum, connectorId, connector })
		const addRes = await api.post('/api/device-view', { addExtraLiveSource: liveSource })
		if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
			window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
		}
		return {
			ok: true,
			slot: resolvedSlot,
			hostChannel: entry?.channel ?? null,
			route: liveSource.value,
			connectorId,
			casparRestartNeeded: true,
			pendingApply: true,
			extraLiveSources: addRes?.extraLiveSources,
		}
	}

	await playDecklinkOnHost(entry, resolvedSlot, devNum)
	const liveSource = buildDecklinkLiveSource({ entry, resolvedSlot, devNum, connectorId, connector })
	const addRes = await api.post('/api/device-view', { addExtraLiveSource: liveSource })
	if (Array.isArray(addRes?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
		window.__highascgApplyExtraLiveSources(addRes.extraLiveSources)
	}

	return {
		ok: true,
		slot: resolvedSlot,
		hostChannel: entry.channel,
		route: liveSource.value,
		connectorId,
		casparRestartNeeded: false,
		extraLiveSources: addRes?.extraLiveSources,
	}
}

/**
 * Tear down a DeckLink input host channel (stop capture, remove live tile, free SDI port).
 * @param {import('./state-store.js').StateStore | null} stateStore
 * @param {{ slot?: number, connectorId?: string, liveSourceValue?: string, destinationId?: string }} payload
 */
export async function removeDecklinkInputSlot(stateStore, { slot, connectorId, liveSourceValue, destinationId }) {
	const slotHint = parseInt(String(slot ?? ''), 10) || 0
	if (slotHint < 1) throw new Error('Invalid DeckLink input slot')

	await settingsState.load()
	const prevCount = Math.max(
		0,
		parseInt(String(settingsState.getSettings()?.casparServer?.decklink_input_count ?? 0), 10) || 0,
	)

	let dv = await loadDeviceView()
	const destId = String(destinationId || hostChannelDestinationId('decklink_input', 1, slotHint)).trim()
	const sinkId = destId ? `dst_in_${destId}` : ''
	const edges = Array.isArray(dv?.graph?.edges) ? dv.graph.edges : []
	for (const e of edges) {
		if (sinkId && String(e?.sourceId || '') === sinkId && e?.id) {
			await api.post('/api/device-view', { removeEdge: { id: e.id } }).catch(() => {})
		}
	}

	let connector =
		connectorId && String(connectorId).trim()
			? [...(dv?.graph?.connectors || []), ...(dv?.suggested?.connectors || [])].find(
					(c) => String(c?.id || '') === String(connectorId),
				) || null
			: null
	if (!connector) connector = findDecklinkConnectorForDevice(dv, 0, slotHint)
	const resolvedSlot = connector ? decklinkSlotFromConnector(connector) : slotHint
	const connectorIdResolved = String(connector?.id || connectorId || '').trim()

	const extras = Array.isArray(dv?.extraLiveSources) ? dv.extraLiveSources : []
	const liveSource =
		(liveSourceValue && extras.find((x) => String(x?.value || '') === String(liveSourceValue))) ||
		extras.find((x) => x?.routeType === 'decklink' && Number(x.decklinkSlot) === resolvedSlot) ||
		null

	const cm = channelMapFromPayload(stateStore, dv)
	const entry = decklinkInputForSlot(cm, resolvedSlot)
	if (entry?.channel != null) {
		const layer = entry.layer ?? resolvedSlot
		const cl = `${entry.channel}-${layer}`
		await api.post('/api/raw', { cmd: `STOP ${cl}` }).catch(() => {})
		await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }).catch(() => {})
	}

	const routeValue =
		liveSource?.value ||
		routeForDecklinkSlot(cm, resolvedSlot) ||
		(entry?.channel != null ? `route://${entry.channel}-${entry.layer ?? resolvedSlot}` : '')
	if (routeValue) {
		await api.post('/api/device-view', { removeExtraLiveSource: { value: routeValue } }).catch(() => {})
	}

	if (connectorIdResolved) {
		await updateConnector(connectorIdResolved, { caspar: { ioDirection: DECKLINK_IO_UNASSIGNED } })
	}

	await settingsState.load()
	const newCount = Math.max(
		0,
		parseInt(String(settingsState.getSettings()?.casparServer?.decklink_input_count ?? 0), 10) || 0,
	)
	const casparRestartNeeded = newCount < prevCount
	if (casparRestartNeeded) markCasparRestartDirty()

	if (destId) {
		await api.post('/api/device-view', { removeDestination: { id: destId } }).catch(() => {})
	}

	dv = await loadDeviceView()
	const extraLiveSources = Array.isArray(dv?.extraLiveSources) ? dv.extraLiveSources : []
	if (typeof window.__highascgApplyExtraLiveSources === 'function') {
		window.__highascgApplyExtraLiveSources(extraLiveSources)
	}

	return {
		ok: true,
		slot: resolvedSlot,
		connectorId: connectorIdResolved,
		casparRestartNeeded,
		extraLiveSources,
		payload: dv,
	}
}
