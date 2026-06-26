/**
 * Screen Destinations UI for Device View (Static Stacked Nodes).
 */
import { destinationRectLabel } from './device-view-ui-utils.js'
import { edgeOutputLayer } from './device-view-destinations-inspector.js'
import { friendlyConnectorLabel } from './device-view-helpers.js'
import { listAllScreenDestinationsForDeviceView } from '../lib/device-view-host-channels.js'

function getDestinationConnectionLabel(edge, lastPayload, connectorById) {
	const id = String(edge?.sinkId || '').trim()
	if (!id) return 'OUT'
	const conn = connectorById.get(id) || null
	const label = friendlyConnectorLabel(lastPayload, id)
	
	if (conn?.kind === 'gpu_out') {
		const cleanPort = label.replace(/^gpu_/i, '').replace(/^p(\d+)/i, 'p$1')
		const displayPort = cleanPort.startsWith('p') ? 'p' + cleanPort.slice(1) : cleanPort
		return `Gpu ${displayPort}`
	}
	if (conn?.kind === 'stream_out') {
		return `Stream ${label}`
	}
	if (conn?.kind === 'record_out') {
		return `Record ${label}`
	}
	if (conn?.kind === 'decklink_io' || conn?.kind === 'decklink_out' || conn?.kind === 'decklink_in') {
		const num = label.match(/(\d+)/)?.[1] || ''
		return `DeckLink ${num || label}`
	}
	if (conn?.kind === 'audio_out') {
		return `Audio ${label}`
	}
	return label || id
}

export function renderDestinations(ctx) {
	const {
		destBody,
		lastPayload,
		highlightDestinationIntent,
		clearChipHighlights,
		selectDestinationById,
		resolveDestinationSinkConnectorId,
		onDestinationPortClick,
		onDecklinkDropToDestinationOutput,
	} = ctx

	destBody.innerHTML = ''

	const transitionModel = String(lastPayload?.live?.caspar?.channelMap?.transitionModel || 'legacy_layer')
	const switcherBusMode = transitionModel === 'switcher_bus'
	/** @type {Map<string, HTMLElement[]>} */
	const chipByKey = new Map()
	/** @type {Map<string, HTMLElement[]>} */
	const destinationByKey = new Map()

	function addChipKey(key, el) {
		if (!chipByKey.has(key)) chipByKey.set(key, [])
		chipByKey.get(key).push(el)
	}
	function addDestinationKey(key, el) {
		if (!destinationByKey.has(key)) destinationByKey.set(key, [])
		destinationByKey.get(key).push(el)
	}

	const localClearHighlights = () => {
		for (const els of chipByKey.values()) {
			for (const el of els) el.classList.remove('device-view__channel-chip--active')
		}
		for (const els of destinationByKey.values()) {
			for (const el of els) el.classList.remove('device-view__destination--active')
		}
		clearChipHighlights()
	}

	const localHighlightIntent = (intent) => {
		localClearHighlights()
		if (!intent) return
		if (intent.mode === 'multiview') {
			for (const el of chipByKey.get('mv') || []) el.classList.add('device-view__channel-chip--active')
			for (const el of destinationByKey.get('mv') || []) el.classList.add('device-view__destination--active')
			highlightDestinationIntent(intent)
			return
		}
		const main = Number.isFinite(intent.mainScreenIndex) ? intent.mainScreenIndex : 0
		const keyPgm = `${main}:pgm`
		for (const el of chipByKey.get(keyPgm) || []) el.classList.add('device-view__channel-chip--active')
		for (const el of destinationByKey.get(keyPgm) || []) el.classList.add('device-view__destination--active')
		if (intent.mode !== 'pgm_only') {
			const keyPrv = `${main}:prv`
			for (const el of chipByKey.get(keyPrv) || []) el.classList.add('device-view__channel-chip--active')
			for (const el of destinationByKey.get(keyPrv) || []) el.classList.add('device-view__destination--active')
		}
		highlightDestinationIntent(intent)
	}

	const parseDecklinkDrop = (ev) => {
		const raw = ev?.dataTransfer?.getData('application/x-highascg-connector') || ''
		if (!raw) return null
		try {
			const p = JSON.parse(raw)
			if (String(p?.kind || '') !== 'decklink_io') return null
			const connectorId = String(p?.connectorId || '').trim()
			return connectorId ? { connectorId } : null
		} catch {
			return null
		}
	}

	const destinationsRaw = listAllScreenDestinationsForDeviceView(lastPayload)
	const userDestCount = (Array.isArray(lastPayload?.screenDestinations?.destinations) ? lastPayload.screenDestinations.destinations : []).length
	const hostDestCount = destinationsRaw.length - userDestCount
	const seenDestinationIds = new Set()
	const destinationsList = destinationsRaw.filter((d) => {
		const id = String(d?.id || '').trim()
		if (!id) return false
		if (seenDestinationIds.has(id)) return false
		seenDestinationIds.add(id)
		return true
	})
	const intentItems = Array.isArray(lastPayload?.live?.caspar?.destinationIntent?.items)
		? lastPayload.live.caspar.destinationIntent.items
		: []
	if (!destinationsList.length) {
		const p = document.createElement('p')
		p.className = 'device-view__note'
		p.textContent = 'No destinations yet. Use + and choose PGM/PRV, PGM only, or Multiview.'
		destBody.appendChild(p)
		return
	}

	const container = document.createElement('div')
	container.className = 'device-view__destinations-vertical-stack'

	let hostHeadingAdded = false
	for (const d of destinationsList) {
		const isHost = String(d?.mode || '') === 'host_channel' || d?.virtual === true
		if (isHost && hostDestCount > 0 && !hostHeadingAdded && userDestCount > 0) {
			hostHeadingAdded = true
			const hostHead = document.createElement('div')
			hostHead.className = 'device-view__destinations-host-heading'
			hostHead.textContent = 'Input & host channels'
			container.appendChild(hostHead)
		}
		const destCardWrap = document.createElement('div')
		destCardWrap.className = 'device-view__destination-wrapper'
		destCardWrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; width: 100%; position: relative;'

		const mode = String(d?.mode || 'pgm_prv')
		const b = document.createElement('div')
		destCardWrap.appendChild(b)
		b.className = `device-view__destination device-view__destination--mode-${mode}${isHost ? ' device-view__destination--host-channel' : ''}`
		const main = parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0
		const title = document.createElement('strong')
		title.textContent = String(d?.label || d?.id || 'Destination')
		const subtitle = document.createElement('small')
		subtitle.textContent = isHost
			? `HOST · ch ${d?.casparChannel ?? intent?.pgmChannel ?? '?'}`
			: destinationRectLabel(d)
		
		const ports = document.createElement('div')
		ports.className = 'device-view__destination-ports'
		const outputDot = document.createElement('span')
		outputDot.className = 'device-view__destination-port device-view__destination-port--output'
		const sinkConnectorId = resolveDestinationSinkConnectorId ? resolveDestinationSinkConnectorId(d) : ''
		if (sinkConnectorId) b.dataset.connectorId = sinkConnectorId
		const graphEdges = Array.isArray(lastPayload?.graph?.edges) ? lastPayload.graph.edges : []
		const graphConnectors = Array.isArray(lastPayload?.graph?.connectors) ? lastPayload.graph.connectors : []
		const suggestedConnectors = Array.isArray(lastPayload?.suggested?.connectors) ? lastPayload.suggested.connectors : []
		const connectorById = new Map([...graphConnectors, ...suggestedConnectors].map((c) => [String(c?.id || ''), c]))
		const mappedOutputEdges = graphEdges.filter((e) => String(e?.sourceId || '') === String(sinkConnectorId || ''))
		if (sinkConnectorId) outputDot.dataset.connectorId = sinkConnectorId
		outputDot.title = sinkConnectorId ? `Output connector ${sinkConnectorId}` : 'No mapped output connector'
		outputDot.addEventListener('click', (ev) => {
			ev.preventDefault()
			ev.stopPropagation()
			if (onDestinationPortClick) onDestinationPortClick(sinkConnectorId)
		})
		
		const intent = intentItems.find((x) => String(x?.id || '') === String(d?.id || '')) || null
		
		if (mode !== 'stream') {
			outputDot.addEventListener('dragover', (ev) => {
				const parsed = parseDecklinkDrop(ev)
				if (!parsed) return
				ev.preventDefault()
				b.classList.add('device-view__destination--active')
			})
			outputDot.addEventListener('dragleave', () => b.classList.remove('device-view__destination--active'))
			outputDot.addEventListener('drop', (ev) => {
				b.classList.remove('device-view__destination--active')
				const parsed = parseDecklinkDrop(ev)
				if (!parsed) return
				ev.preventDefault()
				if (onDecklinkDropToDestinationOutput) onDecklinkDropToDestinationOutput(parsed.connectorId, d, intent)
			})
			ports.append(outputDot)
		} else {
			ports.append(outputDot)
		}
		
		b.append(title, subtitle, ports)
		if (mode === 'pgm_prv') {
			b.classList.add('device-view__destination--pair')
			const basePorts = b.querySelector('.device-view__destination-ports')
			if (basePorts) basePorts.remove()

			const pgmText = 'PGM'
			const prvText = 'PRV'

			const pair = document.createElement('div')
			pair.className = 'device-view__destination-pair'
			pair.innerHTML = `<div class="device-view__destination-pair-half device-view__destination-pair-half--pgm">${pgmText}<span class="device-view__destination-port device-view__destination-port--pair-out" data-pair-node="pgm-out"></span></div><div class="device-view__destination-pair-half device-view__destination-pair-half--prv">${prvText}<span class="device-view__destination-port device-view__destination-port--pair-out" data-pair-node="prv-out"></span></div>`
			if (switcherBusMode) {
				const prvDot = pair.querySelector('[data-pair-node="prv-out"]')
				if (prvDot) prvDot.remove()
			}
			for (const half of pair.querySelectorAll('.device-view__destination-pair-half')) {
				if (sinkConnectorId) half.dataset.connectorId = sinkConnectorId
			}
			b.appendChild(pair)
			for (const nd of pair.querySelectorAll('[data-pair-node$="-out"]')) {
				if (sinkConnectorId) nd.dataset.connectorId = sinkConnectorId
				nd.addEventListener('click', (ev) => {
					ev.preventDefault()
					ev.stopPropagation()
					if (onDestinationPortClick) onDestinationPortClick(sinkConnectorId)
				})
				nd.title = 'Drop DeckLink connector to assign destination output'
				nd.addEventListener('dragover', (ev) => {
					const parsed = parseDecklinkDrop(ev)
					if (!parsed) return
					ev.preventDefault()
					b.classList.add('device-view__destination--active')
				})
				nd.addEventListener('dragleave', () => b.classList.remove('device-view__destination--active'))
				nd.addEventListener('drop', (ev) => {
					b.classList.remove('device-view__destination--active')
					const parsed = parseDecklinkDrop(ev)
					if (!parsed) return
					ev.preventDefault()
					if (onDecklinkDropToDestinationOutput) onDecklinkDropToDestinationOutput(parsed.connectorId, d, intent)
				})
			}
		}
		
		if (mappedOutputEdges.length) {
			const sublist = document.createElement('ul')
			sublist.className = 'device-view__destination-connection-list'
			sublist.style.cssText = 'margin: 4px 0 8px 12px; padding: 0 0 0 12px; list-style-type: disc; font-size: 11px; opacity: 0.85; line-height: 1.4;'
			
			const sortedEdges = [...mappedOutputEdges].sort((a, b) => edgeOutputLayer(a) - edgeOutputLayer(b))
			for (const edge of sortedEdges) {
				const li = document.createElement('li')
				li.className = 'device-view__destination-connection-item'
				li.style.cssText = 'margin-bottom: 2px; color: #94a3b8;'
				
				const layer = edgeOutputLayer(edge)
				const prefix = mode === 'pgm_prv' ? (layer === 1 ? 'PGM: ' : 'PRV: ') : ''
				li.textContent = `${prefix}${getDestinationConnectionLabel(edge, lastPayload, connectorById)}`
				sublist.appendChild(li)
			}
			destCardWrap.appendChild(sublist)
		}
		
		const mainFromIntent = Number.isFinite(intent?.mainScreenIndex) ? intent.mainScreenIndex : main
		if (mode !== 'multiview' && mode !== 'stream' && mode !== 'host_channel') {
			addDestinationKey(`${mainFromIntent}:pgm`, b)
			if (mode !== 'pgm_only') addDestinationKey(`${mainFromIntent}:prv`, b)
		} else if (mode === 'multiview') {
			const mvIdx = intent?.mainScreenIndex ?? destinationsList.filter(x => x.mode === 'multiview').indexOf(d)
			addDestinationKey(`mv:${mvIdx}`, b)
		}
		
		b.addEventListener('mouseenter', () => localHighlightIntent(intent))
		b.addEventListener('mouseleave', () => localClearHighlights())
		b.addEventListener('click', (ev) => {
			localHighlightIntent(intent)
			if (typeof selectDestinationById === 'function') {
				selectDestinationById(d.id)
			}
		})

		container.appendChild(destCardWrap)
	}

	destBody.appendChild(container)
}
