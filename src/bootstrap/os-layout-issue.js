'use strict'

/**
 * WO-919 F26 — an OS display layout the watchdog could not fix, made visible to the GUI.
 *
 * os-layout-watchdog.js used to give up with a journal line only ("Layout still wrong … operator may need Apply OS").
 * The give-up is now kept on `ctx._osLayoutIssue` (GET /api/state `osLayout`, so a client that connects later sees it)
 * and broadcast as WS `change` path `osLayout`. The Godot Devices tab shows it in the toolbar status
 * (devices_follow.gd); a successful Apply (routes-caspar-config.js) clears it.
 */

/** Mismatches shown at most; the journal has the rest. */
const MAX_MISMATCHES = 6

/**
 * @param {object} ctx - app context (`_wsBroadcast` optional)
 * @param {{ mismatches?: Array<{ sysId?: string, field?: string, expected?: unknown, actual?: unknown }> }} check
 *   the last layout check (what is still wrong)
 * @param {number} attempts - xrandr re-apply attempts made
 */
function reportOsLayoutIssue(ctx, check, attempts) {
	const list = Array.isArray(check?.mismatches) ? check.mismatches : []
	const issue = {
		ok: false,
		attempts,
		at: Date.now(),
		mismatches: list.slice(0, MAX_MISMATCHES).map((m) => ({
			sysId: String(m?.sysId ?? ''),
			field: String(m?.field ?? ''),
			expected: m?.expected == null ? '' : String(m.expected),
			actual: m?.actual == null ? '' : String(m.actual),
		})),
	}
	ctx._osLayoutIssue = issue
	broadcast(ctx, issue)
	return issue
}

/** The layout is in place (or was re-applied): forget the issue and tell the clients. No-op when none was recorded. */
function clearOsLayoutIssue(ctx) {
	if (!ctx || !ctx._osLayoutIssue) return false
	ctx._osLayoutIssue = null
	broadcast(ctx, { ok: true, at: Date.now() })
	return true
}

function broadcast(ctx, value) {
	if (typeof ctx?._wsBroadcast !== 'function') return
	try {
		ctx._wsBroadcast('change', { path: 'osLayout', value })
	} catch {
		/* optional */
	}
}

module.exports = { reportOsLayoutIssue, clearOsLayoutIssue }
