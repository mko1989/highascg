/**
 * Status bar and network info logic for the main app.
 */
import { getSameOriginApiUrl } from './api-origin.js'

let _eyeRefreshGen = 0

export function casparAmcpConnectedFromState(st) {
	const raw = st?.caspar
	if (!raw || typeof raw !== 'object') return false
	if (raw.skipped) return false
	const nested =
		raw.connection && typeof raw.connection === 'object' && raw.connection !== null ? raw.connection : null
	if (nested && typeof nested.connected === 'boolean') {
		if (nested.skipped) return false
		return nested.connected
	}
	return !!raw.connected
}

/** Local Caspar AMCP status from this page's playout host only (ignores A/B API overrides). */
export async function fetchLocalCasparConnectionStatus() {
	const res = await fetch(getSameOriginApiUrl('/api/state'), {
		credentials: 'same-origin',
		cache: 'no-store',
	})
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	const st = await res.json()
	return casparAmcpConnectedFromState(st)
}

export function updateNetworkInfo() {
	const statusNet = document.getElementById('status-net'); if (!statusNet) return
	const host = window.location.hostname; let type = 'WAN'
	if (host === 'localhost' || host === '127.0.0.1') type = 'Local'
	else if (host.startsWith('192.168.') || host.startsWith('10.') || host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) type = 'LAN'
	else if (host.startsWith('100.')) type = 'Tailscale'
	statusNet.textContent = `[${type}]`; statusNet.className = 'status-net status-net--' + type.toLowerCase()
}

export function refreshStatusLine(stateStore, ws, httpConnected) {
	const statusText = document.getElementById('status-text'); if (!statusText) return
	const st = stateStore.getState(); const raw = st?.caspar
	const c = raw && typeof raw.connection === 'object' && raw.connection !== null ? raw.connection : raw
	const skipped = !!(c && c.skipped); const casparOk = !!(c && c.connected)
	let line = ws.connected ? 'Live' : (httpConnected ? 'HTTP' : 'Connecting…')
	if (skipped) line += ' · no AMCP'
	else if (casparOk) line += ' · Caspar'
	else if (ws.connected || httpConnected) line += ' · Caspar offline'

	const cc = st?.configComparison
	if (casparOk && cc?.serverPhysicalScreens?.length) {
		const n = cc.serverPhysicalScreens.length; const idx = cc.serverPhysicalScreens.map(s => s.index).join(', ')
		const m = cc.moduleScreenCount
		line += (typeof m === 'number' && m !== n) ? ` · Screens ${n} (ch ${idx}) ≠ app ${m}` : ` · Screens ${n} (ch ${idx})`
	}
	statusText.textContent = line; updateNetworkInfo()
}

export function updateConnectionStatus(connected, error, { ws, httpConnected, stateStore }) {
	updateNetworkInfo()
	const statusDot = document.getElementById('status-dot'); const statusText = document.getElementById('status-text')
	if (error) {
		statusDot?.classList.remove('connected', 'disconnected'); statusDot?.classList.add('error')
		if (statusText) statusText.textContent = error; return
	}
	if (connected) {
		statusDot?.classList.remove('disconnected', 'error'); statusDot?.classList.add('connected')
		refreshStatusLine(stateStore, ws, httpConnected)
	} else {
		statusDot?.classList.remove('connected', 'error'); statusDot?.classList.add('disconnected')
		if (statusText) statusText.textContent = 'Connecting…'
	}
}

/**
 * Connection eye = local HighAsCG + Caspar health only (never hot-backup peer reachability).
 * @param {{ wsConnected?: boolean, httpConnected?: boolean }} [connectivity]
 */
export function refreshCasparConnectionEye(connectionEye, stateStore, connectivity = {}) {
	if (!connectionEye) return
	const gen = ++_eyeRefreshGen
	void (async () => {
		try {
			const casparOk = await fetchLocalCasparConnectionStatus()
			if (gen !== _eyeRefreshGen) return
			connectionEye.setConnected(casparOk)
			return
		} catch {
			/* fall through to WS snapshot */
		}
		if (gen !== _eyeRefreshGen) return
		const highascgOk = !!(connectivity.wsConnected || connectivity.httpConnected)
		connectionEye.setConnected(highascgOk && casparAmcpConnectedFromState(stateStore.getState()))
	})()
}
