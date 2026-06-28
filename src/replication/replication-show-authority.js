'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { normalizeReplicationConfig, replicationPairConfigured } = require('../config/replication-config')

/** exFAT sync pairs that carry active show slug + project JSON (not modular operator config). */
const SHOW_DATA_PAIR_IDS = new Set([
	'usb-projects',
	'bridge-projects',
	'usb-state-highascg',
	'bridge-state-highascg',
])

/**
 * @param {string} pairId
 * @returns {boolean}
 */
function isShowDataExfatPair(pairId) {
	return SHOW_DATA_PAIR_IDS.has(String(pairId || '').trim())
}

/**
 * Read persisted replication role (exFAT sync and project-store run before app ctx exists).
 * @returns {import('../config/replication-config').ReplicationConfig}
 */
function loadReplicationConfigFromDisk() {
	const candidates = [
		path.join(REPO_ROOT, 'config', 'replication.json'),
		process.env.HIGHASCG_CONFIG_PATH
			? path.join(path.resolve(process.env.HIGHASCG_CONFIG_PATH), 'replication.json')
			: '',
	].filter(Boolean)
	for (const p of candidates) {
		if (!fs.existsSync(p)) continue
		try {
			return normalizeReplicationConfig(JSON.parse(fs.readFileSync(p, 'utf8')))
		} catch {
			/* try next */
		}
	}
	return normalizeReplicationConfig(null)
}

/**
 * Leader station owns the active show; field USB/bridge must not overwrite it.
 * @param {import('../config/replication-config').ReplicationConfig} [repl]
 * @returns {boolean}
 */
function leaderOwnsActiveShow(repl = loadReplicationConfigFromDisk()) {
	if (!repl?.enabled) {
		if (repl?.leaderAvailable) return true
		return false
	}
	if (repl.role === 'leader') return true
	if (repl.role === 'follower') return false
	if (repl.leaderAvailable) return true
	return false
}

/**
 * @param {import('../config/replication-config').ReplicationConfig} [repl]
 * @returns {boolean}
 */
function shouldAllowExfatPullShowData(repl = loadReplicationConfigFromDisk()) {
	return !leaderOwnsActiveShow(repl)
}

/**
 * @param {string} pairId
 * @param {import('../config/replication-config').ReplicationConfig} [repl]
 * @returns {boolean}
 */
function shouldSyncShowDataPairFromExfat(pairId, repl = loadReplicationConfigFromDisk()) {
	if (!isShowDataExfatPair(pairId)) return true
	return shouldAllowExfatPullShowData(repl)
}

module.exports = {
	SHOW_DATA_PAIR_IDS,
	isShowDataExfatPair,
	loadReplicationConfigFromDisk,
	leaderOwnsActiveShow,
	shouldAllowExfatPullShowData,
	shouldSyncShowDataPairFromExfat,
}
