'use strict'

/**
 * Atomic file write helper (WO-161 T161.1).
 *
 * Writes to a temp file in the same directory, then rename()s over the target,
 * so a crash or kill mid-write can never leave a truncated/partial target file
 * (same pattern as ConfigManager._atomicWrite, async variant). Used for the
 * generated casparcg.config XML — a torn XML file means Caspar fails to parse
 * on next start.
 */

const fsp = require('fs').promises

/**
 * @param {string} filePath - absolute target path
 * @param {string} data
 * @param {BufferEncoding} [encoding]
 * @returns {Promise<void>} rejects with the underlying fs error (EACCES/EPERM
 *   from tmp create or rename surface unchanged so callers keep their hints).
 */
async function atomicWriteFile(filePath, data, encoding = 'utf8') {
	if (typeof filePath !== 'string' || !filePath.trim()) {
		throw new TypeError(`atomicWriteFile filePath must be a non-empty string, got ${typeof filePath}`)
	}
	const tmp = `${filePath}.tmp`
	try {
		await fsp.writeFile(tmp, data, encoding)
		await fsp.rename(tmp, filePath)
	} catch (e) {
		// Best-effort cleanup; never mask the original error.
		try {
			await fsp.unlink(tmp)
		} catch {
			/* tmp may not exist */
		}
		throw e
	}
}

module.exports = { atomicWriteFile }
