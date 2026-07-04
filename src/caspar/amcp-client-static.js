'use strict'

/** AMCP send timeouts and quiet-command set (shared by transport). */
module.exports = {
	QUIET_CMDS: new Set([
		'CLS',
		'TLS',
		'THUMBNAIL',
		'VERSION',
		'DIAG',
		'MIXER',
		'CG',
		'PLAY',
		'LOADBG',
		'LOAD',
		'STOP',
		'CLEAR',
		'PAUSE',
		'RESUME',
		'SWAP',
		'ADD',
		'REMOVE',
	]),

	SEND_TIMEOUT_MS: 15_000,

	LONG_RESPONSE_TIMEOUT_MS: 120_000,

	/**
	 * @param {string} trimmed
	 * @returns {number}
	 */
	resolveSendTimeoutMs(trimmed) {
		const rawDef = process.env.HIGHASCG_AMCP_SEND_TIMEOUT_MS
		const rawLong = process.env.HIGHASCG_AMCP_LONG_RESPONSE_MS
		const def =
			rawDef === undefined || rawDef === ''
				? module.exports.SEND_TIMEOUT_MS
				: parseInt(String(rawDef), 10)
		const longT =
			rawLong === undefined || rawLong === ''
				? module.exports.LONG_RESPONSE_TIMEOUT_MS
				: parseInt(String(rawLong), 10)
		const n = Number.isFinite(def) && def > 0 ? def : module.exports.SEND_TIMEOUT_MS
		const longN = Number.isFinite(longT) && longT > 0 ? longT : module.exports.LONG_RESPONSE_TIMEOUT_MS
		const u = trimmed.toUpperCase()
		if (
			u.startsWith('INFO ') ||
			u.startsWith('CLS') ||
			u.startsWith('TLS') ||
			u.startsWith('THUMBNAIL') ||
			u.startsWith('PRINT ') ||
			u.startsWith('CINF') ||
			u.startsWith('FLS')
		) {
			return longN
		}
		return n
	},
}
