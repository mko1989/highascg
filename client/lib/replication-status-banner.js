/**
 * Hot backup replication status banner + failover controls (WO-54 Phase 5).
 */
import { api } from './api-client.js'
import {
	getActiveProfileOrigin,
	getPeerProfileOrigin,
	hasDualProfiles,
	loadConnectionProfiles,
	normalizeHostOrigin,
	saveConnectionProfiles,
	switchToPeerProfile,
} from './connection-profiles.js'
import { setApiOriginOverride } from './api-origin.js'

const BANNER_ID = 'highascg-replication-status-banner'
const POLL_MS = 3000

/** @type {ReturnType<typeof setInterval>|null} */
let _pollTimer = null

/**
 * @param {object|null} settings
 * @returns {boolean}
 */
function deviceProfileComplete(settings) {
	const cs = settings?.casparServer && typeof settings.casparServer === 'object' ? settings.casparServer : settings
	if (!cs || typeof cs !== 'object') return false
	for (let n = 1; n <= 4; n++) {
		const sid = String(cs[`screen_${n}_system_id`] || '').trim()
		if (sid) return true
	}
	return false
}

function ensureBanner() {
	let el = document.getElementById(BANNER_ID)
	if (el) return el
	el = document.createElement('div')
	el.id = BANNER_ID
	el.className = 'replication-status-banner replication-status-banner--hidden'
	el.setAttribute('role', 'status')
	document.body.appendChild(el)
	return el
}

function hideBanner() {
	const el = document.getElementById(BANNER_ID)
	if (el) el.classList.add('replication-status-banner--hidden')
}

/**
 * @param {object} status
 * @param {object|null} settings
 */
function renderBanner(status, settings) {
	const el = ensureBanner()
	if (!status?.enabled) {
		el.classList.add('replication-status-banner--hidden')
		return
	}

	const role = String(status.role || 'standalone')
	const roleClass =
		role === 'leader' ? 'replication-status-banner--leader' : role === 'follower' ? 'replication-status-banner--follower' : ''
	const peerOk = !!(status.peerLinkReady ?? status.peerReachable)
	const mediaPct = status.mediaSync?.percent ?? (status.mediaSync?.caughtUp ? 100 : 0)
	const lag = status.liveStateLag ?? 0
	const syncPct = status.initialSync?.inProgress ? status.initialSync.percent : null
	const profileIncomplete = role === 'follower' && settings && !deviceProfileComplete(settings)

	const parts = [
		`<span class="replication-status-banner__badge">${role.toUpperCase()}</span>`,
		`<span>Peer: ${peerOk ? 'online' : 'offline'}</span>`,
		`<span>Media: ${mediaPct}%</span>`,
		`<span>Live lag: ${lag}</span>`,
	]
	if (syncPct != null) parts.push(`<span>Sync: ${syncPct}%</span>`)
	if (profileIncomplete) {
		parts.push('<span class="replication-status-banner__warn">Device profile incomplete — configure screen wiring before relying on this backup</span>')
	}

	const profiles = loadConnectionProfiles()
	const peerOrigin = getPeerProfileOrigin()
	const canSwitchHost = hasDualProfiles()

	el.className = `replication-status-banner ${roleClass}${profileIncomplete ? ' replication-status-banner--warn' : ''}`
	el.innerHTML = `
		<div class="replication-status-banner__text">${parts.join(' · ')}</div>
		<div class="replication-status-banner__actions">
			${canSwitchHost ? `<button type="button" class="replication-status-banner__btn" data-action="switch-host">Connect to ${profiles.active === 'A' ? 'B' : 'A'}</button>` : ''}
			<button type="button" class="replication-status-banner__btn" data-action="promote">Promote / Failover</button>
			<button type="button" class="replication-status-banner__btn replication-status-banner__btn--ghost" data-action="configure">A/B hosts</button>
			<button type="button" class="replication-status-banner__dismiss" data-action="dismiss" aria-label="Dismiss">×</button>
		</div>
	`

	el.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => hideBanner())
	el.querySelector('[data-action="switch-host"]')?.addEventListener('click', () => {
		const origin = switchToPeerProfile()
		if (origin) {
			setApiOriginOverride(origin)
			window.location.reload()
		}
	})
	el.querySelector('[data-action="promote"]')?.addEventListener('click', async () => {
		if (!window.confirm('Promote this node to leader? Use when the primary playout box is down or for planned switchover.')) return
		try {
			await api.post('/api/replication/promote', {})
			if (peerOrigin && hasDualProfiles()) {
				setApiOriginOverride(getActiveProfileOrigin())
			}
			window.location.reload()
		} catch (e) {
			window.alert(`Promote failed: ${e?.message || e}`)
		}
	})
	el.querySelector('[data-action="configure"]')?.addEventListener('click', () => {
		const cur = loadConnectionProfiles()
		const hostA = window.prompt('Host A (primary playout API origin)', cur.hostA || 'http://192.168.0.10:4200')
		if (hostA == null) return
		const hostB = window.prompt('Host B (hot backup API origin)', cur.hostB || 'http://192.168.0.11:4200')
		if (hostB == null) return
		saveConnectionProfiles({
			hostA: normalizeHostOrigin(hostA),
			hostB: normalizeHostOrigin(hostB),
		})
		void pollOnce()
	})

	el.classList.remove('replication-status-banner--hidden')
}

async function pollOnce() {
	try {
		const [status, settings] = await Promise.all([
			api.get('/api/replication/status'),
			api.get('/api/settings').catch(() => null),
		])
		renderBanner(status, settings)
	} catch {
		hideBanner()
	}
}

/**
 * Start polling replication status for operator UI.
 */
export function initReplicationStatusBanner() {
	if (_pollTimer) clearInterval(_pollTimer)
	const active = getActiveProfileOrigin()
	if (active) setApiOriginOverride(active)
	void pollOnce()
	_pollTimer = setInterval(() => void pollOnce(), POLL_MS)
}

export function stopReplicationStatusBanner() {
	if (_pollTimer) {
		clearInterval(_pollTimer)
		_pollTimer = null
	}
}
