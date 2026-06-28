/**
 * Leader spread / follower pull controls — driven by cross-box project media manifest compare.
 */
import { api } from './api-client.js'
import { showAppToast } from './app-toast.js'
import { subscribeReplicationStatus, refreshReplicationStatusSoon } from './replication-ui-state.js'

/** @type {'leader'|'follower'|null} */
let _role = null
let _paired = false
let _syncing = false
/** @type {'push'|'pull'|null} */
let _syncDirection = null
let _syncPercent = 0
/** @type {string} */
let _syncLabel = ''
/** @type {object|null} */
let _parity = null
let _warnedPeerNeedsUpdate = false
/** @type {Set<() => void>} */
const _listeners = new Set()
/** @type {ReturnType<typeof setInterval>|null} */
let _progressPoll = null
let _inited = false

function notifyUi() {
	for (const fn of _listeners) {
		try {
			fn()
		} catch {
			/* ignore */
		}
	}
}

function stopProgressPoll() {
	if (_progressPoll) {
		clearInterval(_progressPoll)
		_progressPoll = null
	}
}

function startProgressPoll() {
	stopProgressPoll()
	_progressPoll = setInterval(() => {
		void api
			.get('/api/replication/media-status')
			.then((st) => {
				if (st?.state === 'syncing' && typeof st.percent === 'number') {
					_syncPercent = Math.min(100, Math.max(0, st.percent))
					notifyUi()
				}
			})
			.catch(() => {})
	}, 350)
}

/**
 * @param {() => void} fn
 * @returns {() => void}
 */
export function onReplicationMediaSyncUiChange(fn) {
	_listeners.add(fn)
	return () => _listeners.delete(fn)
}

export function getReplicationMediaSyncUiState() {
	const showSpread = _paired && _role === 'leader' && !_syncing && !!_parity?.leaderShouldPush
	const showPull = _paired && _role === 'follower' && !_syncing && !!_parity?.followerShouldPull
	return {
		showSpread,
		showPull,
		syncing: _syncing,
		syncDirection: _syncDirection,
		syncProgress: _syncing
			? {
					percent: _syncPercent,
					label: _syncLabel,
				}
			: null,
		role: _role,
		parity: _parity,
	}
}

function onReplicationStatus(st) {
	const wasPaired = _paired
	_paired = !!(st?.enabled && st?.peerHttpReachable && st?.peer?.host)
	_role =
		st?.enabled && st.role === 'follower'
			? 'follower'
			: st?.enabled && st.role === 'leader'
				? 'leader'
				: null
	if (!_paired) {
		_parity = null
		_warnedPeerNeedsUpdate = false
	} else if (!wasPaired || (_parity == null && _role === 'leader')) {
		void refreshProjectMediaParity()
	}
	notifyUi()
}

/**
 * Compare local vs peer project media manifests (server probes peer HTTP first).
 * @returns {Promise<object|null>}
 */
export async function refreshProjectMediaParity() {
	if (!_paired && !_role) {
		const st = await api.get('/api/replication/status').catch(() => null)
		if (st?.enabled && st?.peerHttpReachable) {
			_paired = true
			_role = st.role === 'follower' ? 'follower' : st.role === 'leader' ? 'leader' : null
		}
	}
	if (!_paired) {
		_parity = null
		notifyUi()
		return null
	}
	try {
		const out = await api.get('/api/replication/compare-project-media')
		if (!out?.ok) {
			_parity = null
			if (out?.peerNeedsUpdate) {
				if (!_warnedPeerNeedsUpdate) {
					_warnedPeerNeedsUpdate = true
					showAppToast(out.error, 'warn')
				}
			} else if (out?.error) {
				showAppToast(out.error, 'warn')
			}
			refreshReplicationStatusSoon()
			notifyUi()
			return null
		}
		_parity = out
		notifyUi()
		return out
	} catch (e) {
		_parity = null
		showAppToast(e?.message || String(e), 'error')
		notifyUi()
		return null
	}
}

/** @deprecated kept for ingest hooks — triggers parity refresh when paired */
export function noteMediaListForReplication() {
	if (_paired) void refreshProjectMediaParity()
}

export function initReplicationMediaSpread() {
	if (_inited) return
	_inited = true
	subscribeReplicationStatus(onReplicationStatus)
}

/**
 * @param {'push'|'pull'} direction
 * @returns {Promise<object>}
 */
async function runReplicationMediaSync(direction) {
	if (_syncing) throw new Error('Media sync already in progress')
	_syncing = true
	_syncDirection = direction
	_syncPercent = 0
	_syncLabel = direction === 'push' ? 'Spreading project media to backup…' : 'Downloading project media from leader…'
	notifyUi()
	startProgressPoll()
	try {
		const out = await api.post('/api/replication/sync-project-media', { direction })
		if (!out?.ok) {
			throw new Error(out?.error || (direction === 'push' ? 'Spread failed' : 'Download failed'))
		}
		_syncPercent = 100
		notifyUi()
		showAppToast(
			direction === 'push'
				? `Project media spread to backup (${out.files ?? 0} path(s))`
				: `Project media downloaded from leader (${out.files ?? 0} path(s))`,
			'success',
		)
		await refreshProjectMediaParity()
		refreshReplicationStatusSoon()
		return out
	} catch (e) {
		showAppToast(e?.message || String(e), 'error')
		throw e
	} finally {
		stopProgressPoll()
		_syncing = false
		_syncDirection = null
		_syncPercent = 0
		_syncLabel = ''
		notifyUi()
	}
}

/**
 * @returns {Promise<object>}
 */
export function runReplicationMediaPush() {
	return runReplicationMediaSync('push')
}

/**
 * @returns {Promise<object>}
 */
export function runReplicationMediaPull() {
	return runReplicationMediaSync('pull')
}
