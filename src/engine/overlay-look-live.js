/**
 * WO-860 (owner 30.10, 2nd pass) — which overlay looks are on air on each PGM channel, and their take-out.
 * "it should be taken automatically out once its played out … make the play button change to stop when on screen,
 * hitting it plays out the cg."
 *
 * - A lower third animates itself out after its hold duration (`displayDurationSec`, the inspectors' "Hold duration");
 *   the server then CLEARs its CG hosts and drops the look from `scene.liveOverlay` (timer: intro + hold + outro).
 *   Hold 0, or any non-lower-third template in the look, = stays until stopped.
 * - Stop (`POST /api/scene/overlay/stop`): `CG STOP` (the template plays its outro), then the same clear.
 * - The hosts of live entries are what a normal PGM take leaves alone (scene-take-lbg.js); a normal look declaring
 *   one of them takes it over and the entry loses it.
 * In memory only: the WO-207 start/reconnect sweep clears the 700+ band, so nothing outlives a restart.
 */

'use strict'

const { isLowerThirdCgName } = require('./cg-routing')

/** The lower-third engine's default hold (lt-engine.js) when the look carries none. */
const LT_DEFAULT_HOLD_S = 10
/**
 * The engine starts its hold after the intro, then plays the outro. Measured 30.10 (lt-classic-box, hold 10 s, PRINT
 * every second): on screen from ~2 s, outro 13→15 s, clean at 16 s. So hold + 7 s clears ~1 s after it is gone.
 */
const LT_IN_OUT_MS = 7000
/** A stopped template's outro (measured ~2.3 s) before its host is cleared. */
const OUTRO_MS = 3000

/** channel → Map(sceneId → { hosts: Set<number>, timer, until }) */
const _live = new Map()

function _num(v) {
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

/**
 * Seconds a template stays up before it plays itself out; 0 = until stopped. Lower-third engine precedence: the active
 * data step over `style` over the top level, else its default.
 * @param {string} cgName
 * @param {string} data — CG JSON
 * @returns {number}
 */
function templateHoldSec(cgName, data) {
	if (!isLowerThirdCgName(cgName)) return 0
	let o = {}
	try {
		o = JSON.parse(data || '{}') || {}
	} catch {
		return LT_DEFAULT_HOLD_S
	}
	const step = Array.isArray(o.data) ? o.data[0] : o.data
	const v = _num(step?.displayDurationSec) ?? _num(o.style?.displayDurationSec) ?? _num(o.displayDurationSec)
	return v == null ? LT_DEFAULT_HOLD_S : Math.max(0, v)
}

/** The look's take-out time: 0 when any template holds. */
function lookHoldSec(holds) {
	return holds.length === 0 || holds.some((h) => !(h > 0)) ? 0 : Math.max(...holds)
}

function broadcast(self) {
	self?._wsBroadcast?.('change', { path: 'scene.liveOverlay', value: getAll() })
}

/** @returns {Record<string, Array<{ sceneId: string, hosts: number[], until: number|null }>>} */
function getAll() {
	const out = {}
	for (const [ch, m] of _live) {
		if (m.size === 0) continue
		out[String(ch)] = [...m].map(([sceneId, e]) => ({ sceneId, hosts: [...e.hosts], until: e.until }))
	}
	return out
}

function _drop(channel, sceneId) {
	const m = _live.get(Number(channel))
	const e = m?.get(sceneId)
	if (!e) return null
	clearTimeout(e.timer)
	m.delete(sceneId)
	return e
}

async function _clearHosts(amcp, self, channel, hosts) {
	const { sendPipOverlayLinesSerial } = require('./pip-overlay')
	const { untrackTemplateHosts } = require('./scene-template-cg')
	const lines = []
	for (const h of hosts) lines.push(`CG ${channel}-${h} CLEAR`, `MIXER ${channel}-${h} OPACITY 1 0`)
	await sendPipOverlayLinesSerial(amcp, lines)
	untrackTemplateHosts(channel, new Set(hosts))
	self?.log?.('info', `[overlay-look] ch=${channel} cleared hosts=${[...hosts].join(',')}`)
}

/**
 * An overlay look went on air on a PGM channel. Another live overlay on one of its hosts was replaced by it.
 * @param {{ amcp: object, self: object, channel: number, sceneId: string, hosts: number[], holdSec: number }} a
 */
function markOverlayLive({ amcp, self, channel, sceneId, hosts, holdSec }) {
	const ch = Number(channel)
	const id = String(sceneId)
	_drop(ch, id)
	releasePgmOverlayHosts(ch, hosts, self, false)
	if (!_live.has(ch)) _live.set(ch, new Map())
	const e = { hosts: new Set(hosts.map(Number)), timer: null, until: null }
	if (holdSec > 0) {
		const ms = holdSec * 1000 + LT_IN_OUT_MS
		e.until = Date.now() + ms
		e.timer = setTimeout(() => {
			if (_live.get(ch)?.get(id) !== e) return
			_drop(ch, id)
			_clearHosts(amcp, self, ch, e.hosts)
				.catch((err) => self?.log?.('warn', `[overlay-look] auto take-out failed: ${err?.message || err}`))
				.finally(() => broadcast(self))
		}, ms)
		e.timer.unref?.()
	}
	_live.get(ch).set(id, e)
	broadcast(self)
}

/**
 * Play the overlay out (`CG STOP` → the template's outro), then clear its hosts. Without `sceneId` every overlay on
 * the channel goes.
 * @param {{ amcp: object, self: object, channel: number, sceneId?: string, outroMs?: number }} a
 * @returns {Promise<string[]>} the looks taken off
 */
async function stopOverlayLook({ amcp, self, channel, sceneId, outroMs = OUTRO_MS }) {
	const ch = Number(channel)
	const ids = sceneId != null ? [String(sceneId)] : [...(_live.get(ch)?.keys() || [])]
	const gone = ids.map((id) => [id, _drop(ch, id)]).filter(([, e]) => e)
	if (gone.length === 0) return []
	const hosts = new Set(gone.flatMap(([, e]) => [...e.hosts]))
	const { sendPipOverlayLinesSerial } = require('./pip-overlay')
	await sendPipOverlayLinesSerial(amcp, [...hosts].map((h) => `CG ${ch}-${h} STOP 0`))
	broadcast(self) // the deck button turns back to play as the outro starts
	if (outroMs > 0) await new Promise((r) => setTimeout(r, outroMs))
	// a host retaken during the outro belongs to the new take
	for (const h of pgmOverlayHosts(ch)) hosts.delete(h)
	if (hosts.size > 0) await _clearHosts(amcp, self, ch, hosts)
	return gone.map(([id]) => id)
}

/**
 * @param {number} channel
 * @returns {Set<number>} the PGM overlay hosts a normal take must leave alone
 */
function pgmOverlayHosts(channel) {
	const s = new Set()
	for (const e of _live.get(Number(channel))?.values() || []) for (const h of e.hosts) s.add(h)
	return s
}

/**
 * A normal look (or another overlay) that declares one of these hosts replaced the overlay there.
 * @param {number} channel
 * @param {Iterable<number>} hosts
 * @param {object} [self] for the broadcast
 * @param {boolean} [notify]
 */
function releasePgmOverlayHosts(channel, hosts, self, notify = true) {
	const m = _live.get(Number(channel))
	if (!m) return
	let changed = false
	for (const h of hosts) {
		for (const [id, e] of m) {
			if (!e.hosts.delete(Number(h))) continue
			changed = true
			if (e.hosts.size === 0) _drop(channel, id)
		}
	}
	if (changed && notify) broadcast(self)
}

module.exports = {
	templateHoldSec,
	lookHoldSec,
	markOverlayLive,
	stopOverlayLook,
	pgmOverlayHosts,
	releasePgmOverlayHosts,
	getAll,
	LT_IN_OUT_MS,
}
