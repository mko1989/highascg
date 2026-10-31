'use strict'

/**
 * `project.pixelMapSettings` (server-owned, POST /api/fixtures/pixelmap/settings) — everything about the pixel map that
 * is not a mapping:
 *   smooth  { attack_ms, release_ms, snap }   WO-893 (pixel-map-smooth.js)
 *   rate_hz                                    WO-916: sampled + sent at most this often (default 25; 0 = every Caspar
 *                                              frame). 50 fps → every 2nd frame, steady.
 *   console { enabled, protocol, dest, layout, universe }   WO-916 (pixel-map-console.js)
 * A write names any of them; the others keep their value. All-default settings drop the key. Pure.
 */

const smoothing = require('./pixel-map-smooth')
const { normalizeConsole, validateConsole, isDefaultConsole } = require('./pixel-map-console')

const DEFAULT_RATE_HZ = 25
const MAX_RATE_HZ = 60

const rateOk = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_RATE_HZ

/** Stored / loaded → complete settings (junk → defaults). */
function normalizeSettings(raw) {
	const r = Number(raw?.rate_hz)
	return { ...smoothing.normalizeSettings(raw), rate_hz: raw?.rate_hz != null && rateOk(r) ? r : DEFAULT_RATE_HZ, console: normalizeConsole(raw?.console) }
}

/** Strict check of a POST body against `current`. → { ok: true, settings } | { ok: false, error } */
function validateSettings(raw, current = normalizeSettings(null)) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw.smooth === undefined && raw.rate_hz === undefined && raw.console === undefined)) {
		return { ok: false, error: 'body must be { smooth?, rate_hz?, console? } with at least one of them' }
	}
	const next = { ...current }
	if (raw.smooth !== undefined) {
		const c = smoothing.validateSettings({ smooth: raw.smooth }, current)
		if (!c.ok) return c
		next.smooth = c.settings.smooth
	}
	if (raw.rate_hz !== undefined) {
		const n = typeof raw.rate_hz === 'number' || (typeof raw.rate_hz === 'string' && raw.rate_hz.trim() !== '') ? Number(raw.rate_hz) : NaN
		if (!rateOk(n)) return { ok: false, error: `rate_hz must be a whole number 0…${MAX_RATE_HZ} (0 = every frame)` }
		next.rate_hz = n
	}
	if (raw.console !== undefined) {
		const c = validateConsole(raw.console, current.console)
		if (!c.ok) return c
		next.console = c.console
	}
	return { ok: true, settings: next }
}

const isDefault = (s) => smoothing.isDefault(s) && s.rate_hz === DEFAULT_RATE_HZ && isDefaultConsole(s.console)

module.exports = { normalizeSettings, validateSettings, isDefault }
