/**
 * Status bar and network info logic for the main app.
 */
export function casparAmcpConnectedFromState(st) {
	const raw = st?.caspar
	const conn = raw && typeof raw.connection === 'object' && raw.connection !== null ? raw.connection : raw
	return !!(conn && conn.connected) && !conn.skipped
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

export function refreshCasparConnectionEye(connectionEye, stateStore) {
	if (!connectionEye) return
	const st = stateStore.getState(); const raw = st?.caspar
	const conn = raw && typeof raw.connection === 'object' && raw.connection !== null ? raw.connection : raw
	connectionEye.setConnected(!!(conn && conn.connected) && !conn.skipped)
}
