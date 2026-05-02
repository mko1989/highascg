/**
 * Screen Destinations UI for Device View.
 */
import { destinationRectLabel } from './device-view-ui-utils.js'
import { renderDestinationInspector, edgeOutputLayer } from './device-view-destinations-inspector.js'
import { wireDestinationDrag } from './device-view-destinations-drag.js'

export function renderDestinations(ctx) {
	const {
		destBody,
		lastPayload,
		highlightDestinationIntent,
		clearChipHighlights,
		renderIntoInspector,
		patchDestination,
		removeDestination,
		applyPlan,
		resolveDestinationSinkConnectorId,
		cableSourceId,
		onDestinationPortClick,
		onDecklinkDropToDestinationOutput,
		updateDestinationOutputLayer,
		persistDestinationLayout,
		resetDestinationLayout,
		requestCableOverlayRender,
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

	const plan = lastPayload?.live?.caspar?.applyPlan
	if (plan && typeof plan === 'object') {
		const box = document.createElement('div')
		box.className = 'device-view__channel-order'
		const h = document.createElement('p')
		h.className = 'device-view__note'
		const blockersN = Array.isArray(plan.blockers) ? plan.blockers.length : 0
		const warningsN = Array.isArray(plan.warnings) ? plan.warnings.length : 0
		const actionsN = Array.isArray(plan.actions) ? plan.actions.length : 0
		h.textContent = `Apply dry-run: ${plan.canApply ? 'ready' : 'blocked'} · blockers ${blockersN} · warnings ${warningsN} · actions ${actionsN}`
		box.appendChild(h)
		const byDest = Array.isArray(plan.byDestination) ? plan.byDestination : []
		if (byDest.length) {
			const ul = document.createElement('ul')
			ul.className = 'device-view__edge-list'
			for (const d of byDest) {
				const li = document.createElement('li')
				li.className = 'device-view__edge-item'
				const b = Array.isArray(d.blockers) ? d.blockers.length : 0
				const w = Array.isArray(d.warnings) ? d.warnings.length : 0
				li.textContent = `${d.label}: ${b ? `${b} blocker(s)` : 'no blockers'}${w ? ` · ${w} warning(s)` : ''}`
				ul.appendChild(li)
			}
			box.appendChild(ul)
		}
		const actions = document.createElement('div')
		actions.className = 'device-view__inspector-links'
		const applyBtn = document.createElement('button')
		applyBtn.type = 'button'
		applyBtn.className = 'header-btn'
		applyBtn.textContent = 'Apply plan'
		applyBtn.disabled = !applyPlan
		applyBtn.addEventListener('click', () => {
			if (applyPlan) applyPlan()
		})
		actions.appendChild(applyBtn)
		box.appendChild(actions)
		destBody.appendChild(box)
	}

	const destinationsRaw = Array.isArray(lastPayload?.tandemTopology?.destinations) ? lastPayload.tandemTopology.destinations : []
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

	const layoutCache =
		lastPayload?.graph?.layout &&
		typeof lastPayload.graph.layout === 'object' &&
		!Array.isArray(lastPayload.graph.layout)
			? lastPayload.graph.layout
			: {}
	const visual = document.createElement('div')
	visual.className = 'device-view__destination-visual'
	const visualHead = document.createElement('div')
	visualHead.className = 'device-view__destination-visual-head'
	const visualTitle = document.createElement('p')
	visualTitle.className = 'device-view__note'
	visualTitle.textContent = 'Visual layout'
	const resetBtn = document.createElement('button')
	resetBtn.type = 'button'
	resetBtn.className = 'header-btn'
	resetBtn.textContent = 'Reset destination layout'
	resetBtn.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (typeof resetDestinationLayout === 'function') resetDestinationLayout()
	})
	visualHead.append(visualTitle, resetBtn)
	destBody.appendChild(visualHead)

	const otherDestinations = []

	for (const d of destinationsList) {
		const mode = String(d?.mode || 'pgm_prv')
		const b = document.createElement('button')
		b.type = 'button'
		b.className = `device-view__destination device-view__destination--mode-${mode}`
		const main = parseInt(String(d?.mainScreenIndex ?? 0), 10) || 0
		const title = document.createElement('strong')
		title.textContent = String(d?.label || d?.id || 'Destination')
		const subtitle = document.createElement('small')
		subtitle.textContent = destinationRectLabel(d)
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
		if (mode === 'pgm_prv') b.classList.add('device-view__destination--pair')
		
		const intent = intentItems.find((x) => String(x?.id || '') === String(d?.id || '')) || null
		const mainFromIntent = Number.isFinite(intent?.mainScreenIndex) ? intent.mainScreenIndex : main
		if (mode !== 'multiview' && mode !== 'stream') {
			addDestinationKey(`${mainFromIntent}:pgm`, b)
			if (mode !== 'pgm_only') addDestinationKey(`${mainFromIntent}:prv`, b)
		} else if (mode === 'multiview') {
			const mvIdx = intent?.mainScreenIndex ?? destinationsList.filter(x => x.mode === 'multiview').indexOf(d)
			addDestinationKey(`mv:${mvIdx}`, b)
		}
		
		b.addEventListener('mouseenter', () => localHighlightIntent(intent))
		b.addEventListener('mouseleave', () => localClearHighlights())
		b.addEventListener('click', () => {
			localHighlightIntent(intent)
			renderIntoInspector((host) => renderDestinationInspector({
				host,
				d,
				mode,
				intent,
				mappedOutputEdges,
				connectorById,
				patchDestination,
				removeDestination,
				updateDestinationOutputLayer,
			}))
		})

		if (mode === 'multiview' || mode === 'stream') {
			otherDestinations.push(b)
			continue
		}

		// Visual rectangle (draggable/resizable representation)

		const vb = b.cloneNode(true)
		vb.classList.add('device-view__destination--visual')
		if (sinkConnectorId) vb.dataset.connectorId = sinkConnectorId
		if (mode === 'pgm_prv') {
			const basePorts = vb.querySelector('.device-view__destination-ports')
			if (basePorts) basePorts.remove()
			const pair = document.createElement('div')
			pair.className = 'device-view__destination-pair'
			pair.innerHTML = '<div class="device-view__destination-pair-half device-view__destination-pair-half--pgm">PGM<span class="device-view__destination-port device-view__destination-port--pair-out" data-pair-node="pgm-out"></span></div><div class="device-view__destination-pair-half device-view__destination-pair-half--prv">PRV<span class="device-view__destination-port device-view__destination-port--pair-out" data-pair-node="prv-out"></span></div>'
			if (switcherBusMode) {
				const prvDot = pair.querySelector('[data-pair-node="prv-out"]')
				if (prvDot) prvDot.remove()
			}
			for (const half of pair.querySelectorAll('.device-view__destination-pair-half')) {
				if (sinkConnectorId) half.dataset.connectorId = sinkConnectorId
			}
			vb.appendChild(pair)
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
					vb.classList.add('device-view__destination--active')
				})
				nd.addEventListener('dragleave', () => vb.classList.remove('device-view__destination--active'))
				nd.addEventListener('drop', (ev) => {
					vb.classList.remove('device-view__destination--active')
					const parsed = parseDecklinkDrop(ev)
					if (!parsed) return
					ev.preventDefault()
					if (onDecklinkDropToDestinationOutput) onDecklinkDropToDestinationOutput(parsed.connectorId, d, intent)
				})
			}
		}
		if (mappedOutputEdges.length) {
			const chips = document.createElement('div')
			chips.className = 'device-view__destination-map-chips'
			for (const edge of mappedOutputEdges) {
				const c = connectorById.get(String(edge?.sinkId || '')) || null
				const chip = document.createElement('span')
				chip.className = 'device-view__channel-chip'
				chip.style.fontSize = '10px'
				chip.style.padding = '1px 6px'
				chip.textContent = `${String(c?.label || edge?.sinkId || 'OUT')} · L${edgeOutputLayer(edge)}`
				chips.appendChild(chip)
			}
			vb.appendChild(chips)
		}
		vb.addEventListener('mouseenter', () => localHighlightIntent(intent))
		vb.addEventListener('mouseleave', () => localClearHighlights())
		vb.addEventListener('click', (ev) => {
			if (ev.target?.closest('.device-view__destination-resize')) return
			b.click()
		})
		const vbOutDot = vb.querySelector('.device-view__destination-port--output')
		if (vbOutDot && mode !== 'stream') {
			vbOutDot.addEventListener('click', (ev) => {
				ev.preventDefault()
				ev.stopPropagation()
				if (onDestinationPortClick) onDestinationPortClick(sinkConnectorId)
			})
			vbOutDot.addEventListener('dragover', (ev) => {
				const parsed = parseDecklinkDrop(ev)
				if (!parsed) return
				ev.preventDefault()
				vb.classList.add('device-view__destination--active')
			})
			vbOutDot.addEventListener('dragleave', () => vb.classList.remove('device-view__destination--active'))
			vbOutDot.addEventListener('drop', (ev) => {
				vb.classList.remove('device-view__destination--active')
				const parsed = parseDecklinkDrop(ev)
				if (!parsed) return
				ev.preventDefault()
				if (onDecklinkDropToDestinationOutput) onDecklinkDropToDestinationOutput(parsed.connectorId, d, intent)
			})
		}
		const cache = layoutCache[String(d?.id || '')] || {}
		const width = Math.max(120, Math.round((Math.max(64, Number(d?.width) || 1920) / 1920) * 170))
		const height = Math.max(70, Math.round((Math.max(64, Number(d?.height) || 1080) / 1080) * 120))
		vb.style.width = `${Math.max(120, Number(cache.w) || width)}px`
		vb.style.height = `${Math.max(70, Number(cache.h) || height)}px`
		vb.style.left = `${Math.max(0, Number(cache.x) || 0)}px`
		vb.style.top = `${Math.max(0, Number(cache.y) || 0)}px`
		wireDestinationDrag({
			vb,
			visual,
			destinationId: String(d?.id || ''),
			layoutCache,
			persistDestinationLayout,
			requestCableOverlayRender,
		})
		visual.appendChild(vb)
	}
	destBody.appendChild(visual)

	if (otherDestinations.length > 0) {
		const othersContainer = document.createElement('div')
		othersContainer.className = 'device-view__destinations-other'
		othersContainer.style.display = 'flex'
		othersContainer.style.gap = '16px'
		othersContainer.style.marginTop = '16px'
		othersContainer.style.flexWrap = 'wrap'
		for (const ob of otherDestinations) {
			othersContainer.appendChild(ob)
		}
		destBody.appendChild(othersContainer)
	}
}
