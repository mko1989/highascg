/**
 * Simple rear-panel node layout for Device View (WO-82).
 */
import { CASPAR_HOST, connectorById } from './device-view-helpers.js'
import { isDecklinkIoIn } from '../lib/decklink-io-direction.js'
import { gpuPhysicalPortCableId } from '../lib/device-view-gpu-port-list.js'
import { casparRearKindTitle, casparRearKindToIcon } from './device-view-caspar-render-helpers.js'
import { buildCasparRearPanelData } from './device-view-caspar-rear-data.js'

function sectionTitleForItem(it) {
	const k = it.kind
	if (k === 'gpu_out') return 'GPU'
	if (k === 'decklink_io' || k === 'decklink_in' || k === 'decklink_out') return 'DeckLink'
	if (k === 'stream_out') return 'Stream'
	if (k === 'record_out') return 'Record'
	if (k === 'audio_out') return 'Audio'
	return null
}

function isInputKind(kind, connectorId, lastPayload) {
	if (kind === 'decklink_in') return true
	if (kind === 'decklink_io') {
		const conn = connectorById(lastPayload, connectorId)
		return conn ? isDecklinkIoIn(conn) : false
	}
	return kind === 'audio_in'
}

function statusSubtitle(it, live, lastPayload) {
	if (it.kind === 'gpu_out') {
		if (it.connected) {
			const parts = []
			if (it.monitor) parts.push(it.monitor)
			if (it.resolution) parts.push(it.resolution)
			if (Number.isFinite(it.refreshHz)) parts.push(`${it.refreshHz} Hz`)
			return parts.join(' · ') || 'Connected'
		}
		if (it.livePresent) return 'Present, not connected'
		return 'Disconnected'
	}
	if ((it.kind === 'decklink_out' || it.kind === 'decklink_io') && live?.decklink?.outputs) {
		const dlOut = live.decklink.outputs.find((o) => String(o?.connectorId || '') === String(it.connectorId || ''))
		if (dlOut && !dlOut.ok) return dlOut.reason || 'Invalid output'
		if (dlOut?.inherited?.standardModeId) {
			const inh = dlOut.inherited
			return `${inh.standardModeId} (${inh.width}×${inh.height})`
		}
	}
	if (it.kind === 'stream_out') {
		const active = !!(live.streaming?.activeOutputs?.some((id) => String(id) === String(it.connectorId)))
		return active ? 'Streaming' : 'Idle'
	}
	if (it.kind === 'record_out') {
		const active = !!(live.recording?.activeOutputs?.some((id) => String(id) === String(it.connectorId)))
		return active ? 'Recording' : 'Idle'
	}
	return casparRearKindTitle(it.kind)
}

function appendSimpleNodeDot(nodeEl, cableId, dotSide, onPortStartCable, portKey, connectorCtx) {
	const dot = document.createElement('span')
	dot.className =
		'device-view__connector-dot device-view__simple-node-dot' +
		(dotSide === 'left' ? ' device-view__connector-dot--left' : ' device-view__connector-dot--right')
	dot.title = 'Start or complete cable at this connector'
	dot.setAttribute('data-connector-id', cableId)
	if (connectorCtx.connector?.pairs) {
		dot.setAttribute('data-real-ids', connectorCtx.connector.pairs.join(','))
	}
	dot.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (onPortStartCable) onPortStartCable(portKey, cableId, connectorCtx)
	})
	if (dotSide === 'left') nodeEl.insertBefore(dot, nodeEl.firstChild)
	else nodeEl.appendChild(dot)
}

export function renderCasparBandSimple(ctx) {
	const {
		live,
		lastPayload,
		selectDevice,
		onPortClick,
		onPortStartCable,
		selectedConnectorId,
		cableSourceId,
		onAddStreamOutput,
		onAddRecordOutput,
		onAddAudioOutput,
	} = ctx

	const { markerItems, resolveStatusClass } = buildCasparRearPanelData(ctx)

	const band = document.createElement('div')
	band.className = 'device-view__band device-view__band--caspar device-view__band--caspar-simple'
	band.innerHTML = '<h3>Rear panel</h3>'

	const stack = document.createElement('div')
	stack.className = 'device-view__simple-nodes-stack'
	band.appendChild(stack)

	const slotOrder = ['GPU', 'DeckLink', 'Stream', 'Record', 'Audio']
	for (const title of slotOrder) {
		const sectionItems = markerItems.filter(
			(it) => it.connectorId && !it.hidden && it.kind !== 'decklink_ref' && sectionTitleForItem(it) === title,
		)
		if (!sectionItems.length) continue

		const section = document.createElement('section')
		section.className = 'device-view__simple-section'

		const head = document.createElement('div')
		head.className = 'device-view__simple-section-head'
		const headTitle = document.createElement('h4')
		headTitle.textContent = title
		head.appendChild(headTitle)

		if (title === 'Stream' || title === 'Record' || title === 'Audio') {
			const plus = document.createElement('button')
			plus.type = 'button'
			plus.className = 'device-view__backpanel-slot-plus'
			plus.textContent = '+'
			plus.title = `Add new ${title.toLowerCase()} output`
			plus.addEventListener('click', (ev) => {
				ev.preventDefault()
				ev.stopPropagation()
				if (title === 'Stream') onAddStreamOutput?.()
				else if (title === 'Record') onAddRecordOutput?.()
				else onAddAudioOutput?.()
			})
			head.appendChild(plus)
		}
		section.appendChild(head)

		const list = document.createElement('div')
		list.className = 'device-view__simple-section-list'

		for (const it of sectionItems) {
			const kind = String(it.kind || '')
			const cableId =
				it.kind === 'gpu_out'
					? gpuPhysicalPortCableId(it.layoutSlotId || it.connectorId)
					: String(it.connectorId || '')
			if (!cableId) continue

			const statusCls = resolveStatusClass(it)
			const node = document.createElement('button')
			node.type = 'button'
			node.className = `device-view__simple-node ${statusCls}`
			if (it.isVirtual || (it.kind === 'gpu_out' && !it.connected)) {
				node.classList.add('device-view__simple-node--dim')
			}
			if (selectedConnectorId === cableId) node.classList.add('device-view__simple-node--selected')
			if (cableSourceId === cableId) node.classList.add('device-view__simple-node--armed')

			const iconPath = it.icon || casparRearKindToIcon(kind)
			const connectorCtx = {
				type: kind,
				connector: {
					id: cableId,
					kind,
					label: it.label,
					layoutSlotId: it.layoutSlotId,
					isVirtual: it.isVirtual,
					pairs: it.pairs,
				},
			}
			const portKey = `caspar_simple:${cableId}:`
			const inputSide = isInputKind(kind, it.connectorId, lastPayload)

			node.setAttribute('aria-label', `${it.label || cableId} — ${casparRearKindTitle(kind)}`)
			node.setAttribute('data-connector-id', cableId)

			const row = document.createElement('div')
			row.className = 'device-view__simple-node-row'

			const icon = document.createElement('img')
			icon.className = 'device-view__simple-node-icon'
			icon.width = 18
			icon.height = 18
			icon.src = iconPath
			icon.alt = ''
			icon.setAttribute('aria-hidden', 'true')

			const text = document.createElement('div')
			text.className = 'device-view__simple-node-text'
			const labelEl = document.createElement('strong')
			labelEl.textContent = String(it.labelHtml || it.label || cableId).replace(/<[^>]+>/g, '')
			const sub = document.createElement('small')
			sub.textContent = statusSubtitle(it, live, lastPayload)
			text.append(labelEl, sub)
			row.append(icon, text)
			node.appendChild(row)

			appendSimpleNodeDot(node, cableId, inputSide ? 'left' : 'right', onPortStartCable, portKey, connectorCtx)

			node.addEventListener('click', (ev) => {
				if (ev.target?.closest?.('.device-view__connector-dot')) return
				onPortClick(portKey, cableId, connectorCtx)
			})

			if (kind === 'decklink_io' || kind === 'decklink_in') {
				node.draggable = true
				node.addEventListener('dragstart', (ev) => {
					if (!ev.dataTransfer) return
					ev.dataTransfer.effectAllowed = 'copyMove'
					ev.dataTransfer.setData(
						'application/x-highascg-connector',
						JSON.stringify({ connectorId: cableId, kind }),
					)
				})
			}

			list.appendChild(node)
		}

		if (list.childNodes.length) {
			section.appendChild(list)
			stack.appendChild(section)
		}
	}

	band.addEventListener('click', (ev) => {
		if (ev.target?.closest?.('.device-view__simple-node, .device-view__connector-dot')) return
		selectDevice(CASPAR_HOST, live)
	})

	return band
}
