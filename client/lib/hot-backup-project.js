'use strict'

/**
 * @param {object|null|undefined} hotBackup
 * @param {'leader'|'follower'|'standalone'|string} viewerRole
 * @returns {object|null}
 */
export function hotBackupPeerBoxForViewer(hotBackup, viewerRole) {
	if (!hotBackup || typeof hotBackup !== 'object') return null
	const role = String(hotBackup.role || '')
	const viewer = String(viewerRole || '')
	if (role && viewer && role === viewer) return hotBackup.peer || null
	return hotBackup.self || hotBackup.peer || null
}

/**
 * @param {object|null|undefined} hotBackup
 * @param {string} [viewerRole]
 * @returns {string|null}
 */
export function hotBackupPeerLabel(hotBackup, viewerRole) {
	const peer = hotBackupPeerBoxForViewer(hotBackup, viewerRole || hotBackup?.role || '')
	if (!peer) return null
	return (
		String(peer.hostname || '').trim() ||
		(peer.hardwareId ? `highascg${String(peer.hardwareId).padStart(4, '0')}` : '') ||
		String(peer.host || '').trim() ||
		null
	)
}

/**
 * @param {object|null|undefined} hotBackup
 * @param {string} [viewerRole]
 * @returns {string|null}
 */
export function hotBackupPairedTitle(hotBackup, viewerRole) {
	const label = hotBackupPeerLabel(hotBackup, viewerRole)
	return label ? `Paired with ${label}` : null
}
