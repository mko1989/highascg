/**
 * A/B playout host profiles for hot-backup failover (WO-54 T5.1).
 */

const STORAGE_KEY = 'highascg_connection_profiles'

/**
 * @typedef {{ hostA: string, hostB: string, active: 'A'|'B' }} ConnectionProfiles
 */

/**
 * @returns {ConnectionProfiles}
 */
export function loadConnectionProfiles() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return { hostA: '', hostB: '', active: 'A' }
		const parsed = JSON.parse(raw)
		return {
			hostA: String(parsed.hostA || '').trim(),
			hostB: String(parsed.hostB || '').trim(),
			active: parsed.active === 'B' ? 'B' : 'A',
		}
	} catch {
		return { hostA: '', hostB: '', active: 'A' }
	}
}

/**
 * @param {Partial<ConnectionProfiles>} patch
 */
export function saveConnectionProfiles(patch) {
	const cur = loadConnectionProfiles()
	const next = { ...cur, ...patch }
	localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
	return next
}

/**
 * Normalize host to origin (http://host:4200).
 * @param {string} host
 */
export function normalizeHostOrigin(host) {
	const raw = String(host || '').trim()
	if (!raw) return ''
	if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, '')
	return `http://${raw.replace(/\/$/, '')}${raw.includes(':') ? '' : ':4200'}`
}

/**
 * @returns {string} peer origin (the non-active profile host)
 */
export function getPeerProfileOrigin() {
	const p = loadConnectionProfiles()
	const peerHost = p.active === 'A' ? p.hostB : p.hostA
	return normalizeHostOrigin(peerHost)
}

/**
 * @returns {string} active origin override, or '' if not configured
 */
export function getActiveProfileOrigin() {
	const p = loadConnectionProfiles()
	const host = p.active === 'B' ? p.hostB : p.hostA
	return normalizeHostOrigin(host)
}

/**
 * Flip A/B and return the new active origin.
 * @returns {string}
 */
export function switchToPeerProfile() {
	const p = loadConnectionProfiles()
	const nextActive = p.active === 'A' ? 'B' : 'A'
	saveConnectionProfiles({ active: nextActive })
	return getActiveProfileOrigin()
}

/**
 * @returns {boolean}
 */
export function hasDualProfiles() {
	const p = loadConnectionProfiles()
	return !!(normalizeHostOrigin(p.hostA) && normalizeHostOrigin(p.hostB))
}
