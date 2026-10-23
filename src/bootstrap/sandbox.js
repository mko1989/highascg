'use strict'

/**
 * WO-719 — HIGHASCG_SANDBOX=1 marks a throwaway test instance (tools/e2e/sandbox-server.js) running NEXT TO the live
 * server on the same box. Everything that reaches outside the instance's own config / projects / state / media is
 * off: pointer confine (its pkill would kill the live operator's barrier daemon), hostname and hardware identity,
 * replication identity under the repo config/, exFAT / bridge project + config sync (the WO-718 leak into the live
 * projects/), xrandr / OS layout, Caspar window placement on :0, the media-library registry under the repo data/,
 * renaming the live media symlink, and real browser / x11grab capture processes.
 */
function isSandbox() {
	const v = String(process.env.HIGHASCG_SANDBOX || '').trim().toLowerCase()
	return v === '1' || v === 'true' || v === 'yes'
}

module.exports = { isSandbox }
