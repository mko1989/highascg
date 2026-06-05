'use strict'

const { pushProjectConfigToExfat, runExfatSync } = require('./exfat-sync')

let debounceTimer = null
let inFlight = false

function exfatSyncOnSaveEnabled() {
	if (process.platform !== 'linux') return false
	const v = String(process.env.HIGHASCG_EXFAT_SYNC_ON_SAVE ?? '1').trim().toLowerCase()
	return v !== '0' && v !== 'false' && v !== 'no'
}

/**
 * Debounced push after ConfigManager.save: bridge (HIGHASCGDAT) + USB (HIGHASCGEXF) only when
 * that volume is mounted (pushOnSave). USB is not overwritten from server at boot.
 */
function scheduleExfatSyncAfterConfigSave(logger) {
	if (!exfatSyncOnSaveEnabled()) return
	const ms = Math.max(500, parseInt(process.env.HIGHASCG_EXFAT_SYNC_ON_SAVE_MS || '2000', 10) || 2000)
	const logFn = (lvl, msg) => {
		const log = logger || console
		if ((lvl === 'warn' || lvl === 'error') && typeof log.warn === 'function') log.warn(msg)
		else if (typeof log.info === 'function') log.info(msg)
	}
	void pushProjectConfigToExfat({ log: logFn }).catch(() => {})

	if (debounceTimer) clearTimeout(debounceTimer)
	debounceTimer = setTimeout(() => {
		debounceTimer = null
		if (inFlight) return
		inFlight = true
		runExfatSync({
			log: (lvl, msg) => {
				const log = logger || console
				if ((lvl === 'warn' || lvl === 'error') && typeof log.warn === 'function') log.warn(msg)
				else if (typeof log.info === 'function') log.info(msg)
				else console.log(msg)
			},
		})
			.catch((e) => {
				const log = logger || console
				const m = e instanceof Error ? e.message : String(e)
				if (log.warn) log.warn(`[exfat-sync] post-save sync failed: ${m}`)
				else console.warn(`[exfat-sync] post-save sync failed: ${m}`)
			})
			.finally(() => {
				inFlight = false
			})
	}, ms)
}

module.exports = { scheduleExfatSyncAfterConfigSave, exfatSyncOnSaveEnabled }
