/**
 * Inspector Rendering for Device View.
 */
import { CASPAR_HOST } from './device-view-helpers.js'
import { SWITCHER_INTEGRATION_DISABLED } from './device-view-switcher-integration-disabled.js'
import { buildInspectorTable } from './device-view-ui-utils.js'

/**
 * @param {any} connector
 * @param {any} ctx
 * @returns {Array<{label: string, value: string}>}
 */
export function readableConnectorRows(connector, ctx) {
	if (!connector) {
		return [{ label: 'Connector', value: 'Not mapped yet (run Sync from hardware).' }]
	}
	const rows = [
		{ label: 'Name', value: String(connector.label || connector.id) },
		{
			label: 'Device',
			value:
				connector.deviceId === CASPAR_HOST
					? 'Caspar / HighAsCG host'
					: String(connector.deviceId || 'Unknown'),
		},
	]
	if (connector.kind === 'gpu_out') {
		rows.push({ label: 'Type', value: 'GPU output (DisplayPort / HDMI)' })
	} else if (connector.kind === 'decklink_out') {
		const mainIdx = connector?.caspar?.mainIndex
		const main = Number.isFinite(mainIdx) ? Number(mainIdx) + 1 : null
		rows.push(
			{ label: 'Type', value: 'DeckLink output (Caspar consumer)' },
			{ label: 'DeckLink device', value: String(connector.externalRef ?? ctx?.output?.device ?? ctx?.multiviewDevice ?? '0') },
			{ label: 'Caspar main', value: main != null ? `Main ${main}` : 'Not mapped' }
		)
	} else if (connector.kind === 'decklink_in') {
		rows.push(
			{ label: 'Type', value: 'DeckLink input' },
			{ label: 'DeckLink device', value: String(connector.externalRef ?? ctx?.input?.device ?? '0') },
			{ label: 'Slot', value: String((ctx?.input?.slot ?? connector?.index + 1) || '?') },
			{ label: 'Signal state', value: String(ctx?.input?.state || 'unknown') },
			{ label: 'Status message', value: String(ctx?.input?.message || '-') },
			{
				label: 'Inputs host',
				value:
					ctx?.input?.hostingChannel != null
						? `ch ${ctx.input.hostingChannel}${ctx?.input?.hostLabel ? ` (${ctx.input.hostLabel})` : ''}`
						: '-',
			}
		)

	} else if (connector.kind === 'record_out') {
		rows.push(
			{ label: 'Type', value: 'Record output (FILE consumer)' },
			{ label: 'Output ID', value: String(connector.id || '-') },
			{ label: 'Source', value: String(connector?.caspar?.source || 'program_1') },
			{ label: 'CRF', value: String(connector?.caspar?.crf ?? 26) }
		)
	} else {
		rows.push({ label: 'Type', value: String(connector.kind || 'unknown') })
	}
	return rows
}

export function renderDeviceInspector(host, deviceId, live, dev) {
	const p = document.createElement('p')
	p.className = 'device-view__status'
	p.textContent = 'Selected device'
	const rows = [
		{ label: 'Name', value: String(dev?.label || deviceId || 'Device') },
		{
			label: 'Type',
			value:
				deviceId === CASPAR_HOST
					? 'Caspar / HighAsCG server'
					: String(dev?.role || 'device'),
		},
		{ label: 'Device ID', value: String(deviceId || '-') },
	]
	if (deviceId === CASPAR_HOST) {
		const intent = Array.isArray(live?.caspar?.destinationIntent?.items) ? live.caspar.destinationIntent.items : []
		rows.push(
			{ label: 'Host', value: String(live?.caspar?.host || '-') },
			{ label: 'AMCP port', value: String(live?.caspar?.port || '-') },
			{ label: 'Connected', value: live?.caspar?.connected ? 'yes' : 'no' },
			{ label: 'Hostname', value: String(live?.host?.hostname || '-') },
			{ label: 'Platform', value: String(live?.host?.platform || '-') },
			{ label: 'Arch', value: String(live?.host?.arch || '-') },
			{ label: 'Destinations', value: String(intent.length) },
			{ label: 'PGM-only intents', value: String(live?.caspar?.destinationIntent?.pgmOnlyCount ?? 0) }
		)
	}
	host.append(p, buildInspectorTable(rows))
	
	if (deviceId === CASPAR_HOST) {
		const intent = Array.isArray(live?.caspar?.destinationIntent?.items) ? live.caspar.destinationIntent.items : []
		if (intent.length) {
			const hint = document.createElement('p')
			hint.className = 'device-view__note'
			hint.textContent = 'Destination -> Caspar channel intent'
			const ul = document.createElement('ul')
			ul.className = 'device-view__edge-list'
			for (const it of intent) {
				const li = document.createElement('li')
				li.className = 'device-view__edge-item'
				const prvTxt =
					it.mode === 'multiview'
						? 'PRV n/a (multiview destination)'
						: it.mode === 'pgm_only'
						? `PRV intended: none (generator maps preview to PGM ch ${it.previewChannelGenerated ?? '?'})`
						: `PRV ch ${it.previewChannelIntended ?? it.previewChannelGenerated ?? '?'}`
				li.textContent = `${it.label}: PGM ch ${it.pgmChannel ?? '?'} · ${prvTxt}`
				ul.append(li)
			}
			host.append(hint, ul)
		}
	}
}

export function renderEdgeInspector(host, edge, removeFn) {
	const p = document.createElement('p')
	p.className = 'device-view__status'
	p.textContent = 'Selected cable'
	const rows = buildInspectorTable([
		{ label: 'Edge ID', value: edge.id || 'n/a' },
		{ label: 'Source connector', value: edge.sourceId || 'n/a' },
		{ label: 'Target connector', value: edge.sinkId || 'n/a' },
		{ label: 'Notes', value: edge.note || '-' },
	])
	const hint = document.createElement('p')
	hint.className = 'device-view__note'
	hint.textContent = 'The two endpoint connectors are highlighted in the backplane.'
	const buttons = document.createElement('div')
	buttons.className = 'device-view__inspector-links'
	const removeBtn = document.createElement('button')
	removeBtn.type = 'button'
	removeBtn.className = 'header-btn'
	removeBtn.textContent = 'Remove this cable'
	removeBtn.addEventListener('click', () => removeFn(edge.id))
	buttons.append(removeBtn)
	host.append(p, rows, hint, buttons)
}
