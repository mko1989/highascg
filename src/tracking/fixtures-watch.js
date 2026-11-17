'use strict'

/**
 * WO-797 — the previs fixtures (WS `tracking:fixtures`, WO-615 T5) are decoded only while a client looks.
 *
 * A client sends `tracking:fixtures_watch {on}` while a view that draws the rig is rendered (Godot
 * fixtures_watch.gd: the rig's SubViewport is not UPDATE_DISABLED — the Previs tab in 3D, the Live tab's 3D view, the
 * headset). The 33 ms tick decodes only with at least one watcher and sends to the watchers alone, each the snapshot
 * it has not had yet: a view that opens gets the current state at once, a socket that is backed up skips a frame and
 * gets the next one. A closed socket stops watching. GET /api/tracking/fixtures still decodes on request.
 *
 * Why: decoding the MHP rig (199 heads, 5949 beams) and serialising it every tick took 34 % of a core of the server's
 * event loop with nobody looking and the DMX static (CPU profile, 27.10), and every client parsed each change (287 KB)
 * whether its previs was shown or not.
 */

const MAX_BUFFERED = 4 * 1024 * 1024 // a backed-up socket skips a frame rather than queue more of them

function createFixturesWatch() {
	/** @type {Map<object, Map<string, string>|null>} watching socket → the fixtures it has (id → JSON), null = nothing yet */
	const last = new Map()
	const hooked = new WeakSet()

	/** Inbound `tracking:fixtures_watch {on}` → true when handled. */
	function handle(msg, ws) {
		if (msg.type !== 'tracking:fixtures_watch' || !ws) return false
		if (!msg.data?.on) {
			last.delete(ws)
			return true
		}
		if (!last.has(ws)) last.set(ws, null)
		if (!hooked.has(ws) && typeof ws.once === 'function') {
			hooked.add(ws)
			ws.once('close', () => last.delete(ws))
		}
		return true
	}

	/**
	 * One tick: `visual()` runs only with watchers. → the number of sockets sent to.
	 * WO-1115: a watcher gets the whole rig once, then only the fixtures that changed (`delta: true`) — a desk running
	 * an effect changed 50 of 252 heads per tick and every client parsed and applied all 5946 beams (305 KB) 30×/s.
	 */
	function tick(visual) {
		if (last.size === 0 || typeof visual !== 'function') return 0
		const data = visual()
		const list = Array.isArray(data?.fixtures) ? data.fixtures : []
		const now = new Map()
		list.forEach((f, i) => now.set(String(f?.id ?? i), JSON.stringify(f)))
		let sent = 0
		for (const [ws, had] of last) {
			if (ws.readyState !== 1) {
				if (ws.readyState > 1) last.delete(ws) // CLOSING / CLOSED
				continue
			}
			const same = had && had.size === now.size && [...now.keys()].every((k) => had.has(k))
			const changed = same ? [...now].filter(([k, v]) => had.get(k) !== v).map(([, v]) => v) : [...now.values()]
			if (same && changed.length === 0) continue
			if ((ws.bufferedAmount || 0) > MAX_BUFFERED) continue
			const { fixtures: _all, ...rest } = data || {}
			const head = JSON.stringify({ ...rest, ...(same ? { delta: true } : {}) })
			ws.send(`{"type":"tracking:fixtures","data":{"fixtures":[${changed.join(',')}]${head === '{}' ? '' : ',' + head.slice(1, -1)}}}`)
			last.set(ws, now)
			sent++
		}
		return sent
	}

	/** A new follow service (server boot): every watcher gets a fresh snapshot. */
	function reset() {
		for (const ws of last.keys()) last.set(ws, null)
	}

	return { handle, tick, reset, count: () => last.size }
}

module.exports = { createFixturesWatch, MAX_BUFFERED }
