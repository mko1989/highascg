'use strict'

/**
 * WO-1029 plan 07 C4 — replay protection for signed node-to-node messages WITHOUT comparing the sender's timestamp with
 * the receiver's clock (show LANs have no NTP; a dead RTC puts boxes years apart). Used by cluster-call.js (call v2)
 * and cluster-media.js (ssh-key v2).
 *
 * Receiver, per sender fingerprint (and namespace: 'call', 'ssh'):
 *   refuse ts ≤ floor                         (restart floor / evicted nonces: everything at or below was or may be taken)
 *   refuse ts ≤ high − WINDOW_MS              (high = the highest ts taken from that sender: both are the SENDER's clock)
 *   refuse a nonce taken in the last NONCE_KEEP_MS of sender time
 * so parallel calls from one sender may arrive out of order inside the window. A refusal carries `last` (only to a
 * sender whose signature verified): a sender whose clock went back, or that restarted, counts on from there.
 * The floor survives a restart of the receiver: the store keeps, per sender, a value PERSIST_AHEAD_MS above the highest
 * ts taken, written only when a ts crosses it (≤ one small write per sender per minute of sender time, synchronous, so
 * a crash never loses it). After a restart that value is the floor: a captured call cannot be replayed, and the
 * legitimate sender gets one 409 with `last` and resends above it.
 *
 * Sender: `createStamper` — ts = own clock + an offset learned from refusals, strictly rising per receiver.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const WINDOW_MS = 10000
const NONCE_KEEP_MS = 20000
const MAX_NONCES = 1024 // per sender; evicting one raises the floor to its ts (never a gap a replay could use)
const PERSIST_AHEAD_MS = 60000
const MAX_SENDERS = 64 // entries in the store (oldest written dropped)

/** config/cluster-call-floor.json (machine-local: config/*.json is git- and Syncthing-ignored); a temp file under
 * `node --test` so a smoke never touches the box's floor; HIGHASCG_CLUSTER_CALL_FLOOR_PATH overrides both. */
let _testFile = null
function defaultFloorFile() {
	if (process.env.HIGHASCG_CLUSTER_CALL_FLOOR_PATH) return path.resolve(process.env.HIGHASCG_CLUSTER_CALL_FLOOR_PATH)
	if (process.env.NODE_TEST_CONTEXT) {
		if (!_testFile) _testFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-call-floor-')), 'cluster-call-floor.json')
		return _testFile
	}
	// a sandbox / e2e instance has its own config file (HIGHASCG_CONFIG_PATH): its floor lives beside it, never in the box's
	if (process.env.HIGHASCG_CONFIG_PATH) return path.join(path.dirname(path.resolve(process.env.HIGHASCG_CONFIG_PATH)), 'cluster-call-floor.json')
	return path.join(require('../repo-paths').REPO_ROOT, 'config', 'cluster-call-floor.json')
}

/**
 * The persisted floors: { get(key) → number, set(key, value) }. A missing / corrupt file reads as empty (the floor
 * then starts at the first valid message, as the hello does); a write error is logged once and does not refuse calls.
 * @param {{ file?: string, log?: Function }} [opts]
 */
function createFloorStore({ file = defaultFloorFile(), log } = {}) {
	let floors = null
	let warned = false
	function load() {
		if (floors) return floors
		floors = new Map()
		try {
			const j = JSON.parse(fs.readFileSync(file, 'utf8'))
			for (const [k, v] of Object.entries(j?.floors || {})) if (Number.isSafeInteger(v)) floors.set(k, v)
		} catch {
			/* none yet */
		}
		return floors
	}
	function set(key, value) {
		const f = load()
		f.delete(key) // re-insert: Map order = write order, the oldest written is dropped first
		f.set(key, value)
		while (f.size > MAX_SENDERS) f.delete(f.keys().next().value)
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true })
			fs.writeFileSync(`${file}.tmp`, JSON.stringify({ v: 1, floors: Object.fromEntries(f) }) + '\n')
			fs.renameSync(`${file}.tmp`, file)
		} catch (e) {
			if (!warned) log?.('warn', `[cluster] call floor not saved (${e.message}): a restart forgets it`)
			warned = true
		}
	}
	return { get: (key) => load().get(key) || 0, set, file }
}

let _shared = null
/** One store per process for the default file (cluster-call and the ssh-key exchange share it, by namespace). */
const sharedFloorStore = (log) => _shared || (_shared = createFloorStore({ log }))

/**
 * @param {{ store: { get: Function, set: Function }, ns: string }} opts
 */
function createReplayGuard({ store, ns }) {
	const senders = new Map() // fp → { high, floor, nonces: Map<nonce, ts>, saved }
	const key = (fp) => `${ns}:${fp}`
	function state(fp) {
		let s = senders.get(fp)
		if (!s) {
			const saved = store.get(key(fp))
			s = { high: saved, floor: saved, nonces: new Map(), saved }
			senders.set(fp, s)
		}
		return s
	}
	/** null = may be taken; else { code, error, last }. Call only after the signature verified. */
	function check(fp, ts, nonce) {
		const s = state(fp)
		const last = Math.max(s.high, s.floor)
		if (ts <= s.floor || ts <= s.high - WINDOW_MS) return { code: 'CALL_STALE', error: 'stale call', last }
		if (s.nonces.has(nonce)) return { code: 'CALL_REPLAY', error: 'replayed call', last }
		return null
	}
	function take(fp, ts, nonce) {
		const s = state(fp)
		if (ts > s.high) s.high = ts
		s.nonces.set(nonce, ts)
		for (const [n, t] of s.nonces) {
			if (t >= s.high - NONCE_KEEP_MS && s.nonces.size <= MAX_NONCES) break
			if (t >= s.high - NONCE_KEEP_MS) s.floor = Math.max(s.floor, t) // evicted by count: nothing at or below again
			s.nonces.delete(n)
		}
		if (ts > s.saved) {
			s.saved = ts + PERSIST_AHEAD_MS
			store.set(key(fp), s.saved)
		}
	}
	return { check, take }
}

/** Sender: strictly rising ts per receiver from the own clock; `adopt(last)` after a refusal counts on above it. */
function createStamper(now = Date.now) {
	const per = new Map() // receiver fp → { offset, last }
	const of = (fp) => per.get(fp) || (per.set(fp, { offset: 0, last: 0 }), per.get(fp))
	function next(fp) {
		const p = of(fp)
		p.last = Math.max(now() + p.offset, p.last + 1)
		return p.last
	}
	function adopt(fp, last) {
		const p = of(fp)
		p.offset = Math.max(p.offset, last + 1 - now())
		p.last = Math.max(p.last, last)
	}
	return { next, adopt }
}

module.exports = {
	createFloorStore,
	sharedFloorStore,
	createReplayGuard,
	createStamper,
	defaultFloorFile,
	WINDOW_MS,
}
