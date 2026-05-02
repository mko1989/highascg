/**
 * Parked switcher-related port bands for Device View.
 *
 * Kept separate while Device View operates in Caspar/HighAs-only mode.
 *
 * SWITCHER INTEGRATION STATUS: DISABLED (PARKED)
 * - Do not wire this renderer into active Device View segments.
 * - Keep as a parking module until switcher integration is resumed.
 */
import { PH, stateClass, pixelhueInputState } from './device-view-helpers.js'

/**
 * @param {'left' | 'right'} [dotSide]
 */
function addPortNodeDot(portEl, connectorId, onPortStartCable, key, data, dotSide = 'right') {
	if (!portEl || !connectorId) return
	const dot = document.createElement('span')
	dot.className = 'device-view__connector-dot' + (dotSide === 'left' ? ' device-view__connector-dot--left' : '')
	dot.title = 'Start or complete cable at this connector'
	dot.setAttribute('data-connector-id', connectorId)
	dot.addEventListener('click', (ev) => {
		ev.preventDefault()
		ev.stopPropagation()
		if (onPortStartCable) onPortStartCable(key, connectorId, data)
	})
	portEl.appendChild(dot)
	if (dotSide === 'left') portEl.classList.add('device-view__port--ph-sink')
	if (dotSide === 'right' && data?.phOut) portEl.classList.add('device-view__port--ph-source')
}

export function renderPixelHueBand(ctx) {
	const { live, resolveConnectorId, isConnectorVisible, selectedKey, cableSourceId, onPortClick, onPortStartCable, selectDevice } = ctx
	const ph = live.pixelhue
	if (!ph || !ph.available || !Array.isArray(ph.interfaces) || !ph.interfaces.length) {
		return null
	}

	const phBand = document.createElement('div')
	phBand.className = 'device-view__band device-view__band--pixelhue'
	phBand.innerHTML = `<h3>PixelHue switcher (rear panel)</h3>
		<div class="device-view__backpanel device-view__backpanel--pixelhue"><img src="/assets/pixelhue/p80-backpanel.png" alt="PixelHue P80 rear panel"><div class="device-view__backpanel-overlay" data-ph-overlay></div></div>
		<h4 class="device-view__band-subtitle">Video inputs (from Caspar / DeckLink)</h4>
		<div class="device-view__ports" data-ph-in-ports></div>
		<h4 class="device-view__band-subtitle">Program outputs (to screen destinations)</h4>
		<div class="device-view__ports" data-ph-out-ports></div>`

	if (ph.stale) {
		const staleNote = document.createElement('p')
		staleNote.className = 'device-view__note'
		const why = ph.staleReason ? ` — ${String(ph.staleReason)}` : ''
		const when = ph.lastGoodAt ? ` (last good: ${String(ph.lastGoodAt)})` : ''
		staleNote.textContent = `Using cached PixelHue snapshot${when}${why}`
		phBand.appendChild(staleNote)
	}

	const inPorts = phBand.querySelector('[data-ph-in-ports]')
	const outPorts = phBand.querySelector('[data-ph-out-ports]')
	const phOverlay = phBand.querySelector('[data-ph-overlay]')

	const phKind = (iface) => (String(iface?.live?.phKind || 'in') === 'out' ? 'out' : 'in')
	const inIfaces = ph.interfaces.filter((x) => phKind(x) === 'in')
	const outIfaces = ph.interfaces.filter((x) => phKind(x) === 'out')

	function sortByIfaceId(list) {
		return [...list].sort((a, b) => {
			const ai = parseInt(String(a?.interfaceId ?? a?.id ?? 0), 10) || 0
			const bi = parseInt(String(b?.interfaceId ?? b?.id ?? 0), 10) || 0
			return ai - bi
		})
	}
	const inSorted = sortByIfaceId(inIfaces)
	const outSorted = sortByIfaceId(outIfaces)

	function placeMarkers(list, sorted, y0, y1, isOut) {
		if (!phOverlay || !list.length) return
		const n = list.length
		const cols = Math.max(2, Math.min(10, Math.ceil(Math.sqrt(n * 1.2))))
		const rows = Math.ceil(n / cols)
		list.forEach((iface) => {
			const iid = iface.interfaceId != null ? iface.interfaceId : iface.id
			if (iid == null) return
			const iidStr = String(iid)
			const st = pixelhueInputState(iface)
			const sortedIdx = sorted.findIndex((x) => String(x?.interfaceId ?? x?.id ?? '') === iidStr)
			if (sortedIdx < 0) return
			const nm = (iface.general && iface.general.name) || iface.name || `IF ${iidStr}`
			const col = sortedIdx % cols
			const row = Math.floor(sortedIdx / cols)
			const x = cols <= 1 ? 50 : 8 + (84 * col) / Math.max(1, cols - 1)
			const y =
				rows <= 1
					? (y0 + y1) / 2
					: y0 + ((y1 - y0) * row) / Math.max(1, rows - 1)
			const k = isOut ? `phout:${iidStr}:` : `ph:${iidStr}:`
			const typ = isOut ? 'ph_out' : 'ph_in'
			const cid = isOut
				? resolveConnectorId('ph_out', { interfaceId: iid })
				: resolveConnectorId('ph_in', { interfaceId: iid })
			if (!isConnectorVisible(cid)) return
			const marker = document.createElement('button')
			marker.type = 'button'
			marker.className =
				'device-view__panel-marker device-view__panel-marker--ph' + (isOut ? '-out' : '-in') + stateClass(st.level)
			marker.style.left = x + '%'
			marker.style.top = y + '%'
			marker.title = isOut
				? `${nm} — PixelHue program out · id ${iidStr}`
				: `${nm} — PixelHue input · id ${iidStr}`
			marker.textContent = String(sortedIdx + 1)
			if (cid) marker.setAttribute('data-connector-id', cid)
			marker.addEventListener('click', () => onPortClick(k, cid, { type: typ, interfaceId: iid, iface }))
			if (selectedKey === k) marker.classList.add('device-view__panel-marker--selected')
			if (cableSourceId && cid === cableSourceId) marker.classList.add('device-view__panel-marker--armed')
			phOverlay.append(marker)
		})
	}
	placeMarkers(inIfaces, inSorted, 54, 68, false)
	placeMarkers(outIfaces, outSorted, 76, 90, true)

	function renderPhPortRow(iface, isOut) {
		const iid = iface.interfaceId != null ? iface.interfaceId : iface.id
		if (iid == null) return
		const iidStr = String(iid)
		const st = pixelhueInputState(iface)
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'device-view__port' + stateClass(st.level)
		const k = isOut ? `phout:${iidStr}:` : `ph:${iidStr}:`
		b.dataset.portKey = k
		const cid = isOut
			? resolveConnectorId('ph_out', { interfaceId: iid })
			: resolveConnectorId('ph_in', { interfaceId: iid })
		if (!isConnectorVisible(cid)) return
		if (cid) b.setAttribute('data-connector-id', cid)
		const nm = (iface.general && iface.general.name) || iface.name || `IF ${iidStr}`
		const sub = isOut ? `out · id ${iidStr}` : `in · id ${iidStr} · ${st.text}`
		b.appendChild(Object.assign(document.createElement('span'), { textContent: String(nm).slice(0, 32) }))
		b.appendChild(Object.assign(document.createElement('small'), { textContent: sub }))
		const typ = isOut ? 'ph_out' : 'ph_in'
		b.addEventListener('click', () => onPortClick(k, cid, { type: typ, interfaceId: iid, iface }))
		addPortNodeDot(
			b,
			cid,
			onPortStartCable,
			k,
			{ type: typ, interfaceId: iid, iface, phOut: isOut },
			isOut ? 'right' : 'left'
		)
		if (selectedKey === k) b.classList.add('device-view__port--selected')
		if (cableSourceId && cid === cableSourceId) b.classList.add('device-view__port--cable-armed')
		;(isOut ? outPorts : inPorts).append(b)
	}

	for (const iface of inIfaces) {
		if (!iface || typeof iface !== 'object') continue
		renderPhPortRow(iface, false)
	}
	for (const iface of outIfaces) {
		if (!iface || typeof iface !== 'object') continue
		renderPhPortRow(iface, true)
	}

	if (!inIfaces.length) {
		inPorts.appendChild(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				textContent: 'No input interfaces in the API list (or all classified as outputs).',
			})
		)
	}
	if (!outIfaces.length) {
		outPorts.appendChild(
			Object.assign(document.createElement('p'), {
				className: 'device-view__note',
				textContent: 'No program output interfaces in the API list. Firmware may only expose inputs here.',
			})
		)
	}

	phBand.addEventListener('click', (ev) => {
		if (ev.target?.closest?.('[data-port-key], [data-connector-id], .device-view__panel-marker')) return
		selectDevice(PH, live)
	})
	return phBand
}

