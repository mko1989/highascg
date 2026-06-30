/**
 * Settings modal: Companion connection status (HTTP press + Satellite preview).
 */
import { api } from '../lib/api-client.js'

function readCompanionFields(modal) {
	const host = modal.querySelector('#set-companion-host')?.value?.trim() || '127.0.0.1'
	const port = parseInt(modal.querySelector('#set-companion-port')?.value, 10) || 8000
	const satelliteEnabled = !!(modal.querySelector('#set-companion-satellite-enabled') || {}).checked
	const satelliteHost = modal.querySelector('#set-companion-satellite-host')?.value?.trim() || ''
	const satellitePort = parseInt(modal.querySelector('#set-companion-satellite-port')?.value, 10) || 16622
	return { host, port, satelliteEnabled, satelliteHost, satellitePort }
}

function buildStatusQuery(fields) {
	const q = new URLSearchParams({
		host: fields.host,
		port: String(fields.port),
		satelliteEnabled: fields.satelliteEnabled ? '1' : '0',
		satellitePort: String(fields.satellitePort),
	})
	if (fields.satelliteHost) q.set('satelliteHost', fields.satelliteHost)
	return q.toString()
}

function formatStatusText(st) {
	if (!st) return 'Could not check Companion connection.'
	const lines = []
	const http = st.http || {}
	lines.push(
		http.connected
			? `HTTP press API reachable at ${http.host}:${http.port}.`
			: `HTTP press API unreachable at ${http.host}:${http.port}${http.error ? ` (${http.error})` : ''}.`,
	)
	const sat = st.satellite
	if (sat?.enabled) {
		if (sat.connected) {
			if (sat.subscriptionsSupported === false) {
				lines.push(
					`Satellite TCP connected at ${sat.host}:${sat.port}, but Button Subscriptions API is not enabled in Companion.`,
				)
			} else if (sat.subscriptionsSupported === true) {
				lines.push(`Satellite preview connected at ${sat.host}:${sat.port}.`)
			} else {
				lines.push(`Satellite TCP reachable at ${sat.host}:${sat.port}.`)
			}
		} else {
			lines.push(
				`Satellite unreachable at ${sat.host}:${sat.port}${sat.error ? ` (${sat.error})` : ''}.`,
			)
		}
		if (sat.hint && sat.subscriptionsSupported === false) lines.push(sat.hint)
	} else {
		lines.push('Satellite preview disabled in these settings.')
	}
	return lines.join(' ')
}

function setConnectionUi(modal, { connected, label, detail }) {
	const dot = modal.querySelector('#companion-connection-dot')
	const labelEl = modal.querySelector('#companion-connection-label')
	const detailEl = modal.querySelector('#companion-connection-detail')
	if (dot) {
		dot.classList.remove('connected', 'disconnected')
		if (connected === true) dot.classList.add('connected')
		else if (connected === false) dot.classList.add('disconnected')
	}
	if (labelEl) labelEl.textContent = label
	if (detailEl) detailEl.textContent = detail || ''
}

/**
 * @param {HTMLElement} modal
 */
export async function refreshCompanionConnectionStatus(modal) {
	const refreshBtn = modal.querySelector('#companion-connection-refresh')
	if (!modal.querySelector('#companion-connection-dot')) return

	setConnectionUi(modal, { connected: null, label: 'Checking…', detail: '' })
	if (refreshBtn) refreshBtn.disabled = true

	try {
		const fields = readCompanionFields(modal)
		const st = await api.get(`/api/companion/connection-status?${buildStatusQuery(fields)}`)
		const connected = !!st?.connected
		setConnectionUi(modal, {
			connected,
			label: connected ? 'Connected' : 'Not connected',
			detail: formatStatusText(st),
		})
	} catch (e) {
		setConnectionUi(modal, {
			connected: false,
			label: 'Check failed',
			detail: e?.message || String(e),
		})
	} finally {
		if (refreshBtn) refreshBtn.disabled = false
	}
}

/**
 * @param {HTMLElement} modal
 */
export function wireCompanionConnectionStatus(modal) {
	modal.querySelector('#companion-connection-refresh')?.addEventListener('click', () => {
		void refreshCompanionConnectionStatus(modal)
	})

	return {
		onTabActive() {
			void refreshCompanionConnectionStatus(modal)
		},
		onTabInactive() {},
		dispose() {},
	}
}
