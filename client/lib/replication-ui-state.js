/**
 * Poll replication status for header badge + connection toasts.
 */
import { api } from './api-client.js'
import { showAppToast } from './app-toast.js'

const POLL_MS = 2500

/** @type {ReturnType<typeof setInterval>|null} */
let _pollTimer = null
/** @type {Set<(status: object|null) => void>} */
const _subs = new Set()
/** @type {object|null} */
let _last = null
/** @type {string} */
let _lastPhase = 'standalone'
let _skipTransitionToast = true

/**
 * @param {(status: object|null) => void} fn
 * @returns {() => void}
 */
export function subscribeReplicationStatus(fn) {
	_subs.add(fn)
	fn(_last)
	return () => _subs.delete(fn)
}

export function getReplicationStatus() {
	return _last
}

function emit(status) {
	_last = status
	for (const fn of _subs) {
		try {
			fn(status)
		} catch {
			/* ignore */
		}
	}
}

/**
 * @param {object|null} status
 * @returns {'standalone'|'leader-available'|'connecting'|'paired-leader'|'paired-follower'}
 */
function phaseFromStatus(status) {
	if (!status) return 'standalone'
	if (status.enabled && status.role === 'follower') {
		return status.peerReachable ? 'paired-follower' : 'connecting'
	}
	if (status.enabled && status.role === 'leader') {
		return status.peerReachable ? 'paired-leader' : 'connecting'
	}
	if (status.leaderAvailable) return 'leader-available'
	return 'standalone'
}

function toastOnPhaseChange(next, status) {
	if (_skipTransitionToast) {
		_lastPhase = next
		_skipTransitionToast = false
		return
	}
	if (next === _lastPhase) return
	const prev = _lastPhase
	_lastPhase = next

	if (next === 'connecting' && (prev === 'standalone' || prev === 'leader-available')) {
		showAppToast('Establishing hot backup link…', 'info')
		return
	}
	if (next === 'paired-leader') {
		const peer = status?.peer?.host || 'follower'
		showAppToast(`Leader paired with ${peer}`, 'success')
		return
	}
	if (next === 'paired-follower') {
		const peer = status?.peer?.host || 'leader'
		showAppToast(`Following ${peer}`, 'success')
		return
	}
	if (prev !== 'standalone' && next === 'standalone') {
		showAppToast('Hot backup disconnected — standalone playout', 'warn')
	}
	if (next === 'leader-available' && prev === 'standalone') {
		showAppToast('Leader available for followers', 'success')
	}
}

async function pollOnce() {
	try {
		const status = await api.get('/api/replication/status')
		const next = phaseFromStatus(status)
		toastOnPhaseChange(next, status)
		emit(status)
	} catch {
		if (_last) toastOnPhaseChange('standalone', null)
		_lastPhase = 'standalone'
		emit(null)
	}
}

/** Notify UI immediately after a local connect/disconnect action. */
export function refreshReplicationStatusSoon() {
	_skipTransitionToast = false
	void pollOnce()
}

export function initReplicationUiState() {
	if (_pollTimer) clearInterval(_pollTimer)
	_skipTransitionToast = true
	void pollOnce()
	_pollTimer = setInterval(() => void pollOnce(), POLL_MS)
}

export function stopReplicationUiState() {
	if (_pollTimer) {
		clearInterval(_pollTimer)
		_pollTimer = null
	}
}
