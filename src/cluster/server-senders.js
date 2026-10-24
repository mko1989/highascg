'use strict'

/**
 * WO-723 — which linked server sends / receives, chosen where it matters (owner 24.10: "when devices are connected
 * there should be a choice for instance in tracking and artnet server which server should send, receive"):
 *
 *   lighting    the follow engine's DMX (Art-Net / sACN), PSN, and the console read-through   (Tracking → Follow)
 *   ptz         VISCA to the PTZ cameras                                                     (Tracking → PTZ)
 *   artnet_in   the lighting input (a desk's Art-Net / sACN → screen borders)                (Live → Lighting input)
 *
 * Each kind is `{ by, at }`: `by` = '' (Auto) or a server's device-key fingerprint (the same string on every server:
 * a peer's id is only its hostname as the linker saw it). Stored device-local under `clusterSenders`, and kept in
 * agreement over WO-712 R2's signed call: a change goes to every online linked server (`cluster.senders`, an info
 * action), a server that comes online is sent the set, and per kind the newer `at` wins.
 *
 * resolve(kind, entry, view) — every server computes the same answer from the same pings:
 *   by = this server → here · by = a linked server → there, even while it is offline (an explicit choice never
 *   silently doubles) · anything else → Auto: artnet_in on every server; lighting / ptz on the one server doing
 *   tracking, else the master, else the lowest fingerprint (this server + the online linked ones).
 */

const STORE_KEY = 'clusterSenders'
const KINDS = ['lighting', 'ptz', 'artnet_in']
const EVERY = '*'
const FP_RE = /^[0-9a-f]{16}$/
const REFUSED_RETRY_MS = 60_000

const blank = () => Object.fromEntries(KINDS.map((k) => [k, { by: '', at: 0 }]))

function normalizeEntry(raw) {
	const by = typeof raw?.by === 'string' && FP_RE.test(raw.by) ? raw.by : ''
	const at = Number(raw?.at)
	return { by, at: Number.isFinite(at) && at > 0 ? at : 0 }
}

/** Anything stored or received → a full { kind: { by, at } }. */
function normalize(raw) {
	const out = blank()
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const k of KINDS) if (raw[k]) out[k] = normalizeEntry(raw[k])
	return out
}

/**
 * @param {string} kind
 * @param {{ by: string }} entry
 * @param {{ self: { fp: string }, peers: { fp: string, online: boolean, tracking?: boolean }[], master?: string, tracking?: boolean }} view
 * @returns {{ who: string, auto: boolean, here: boolean }} who = a fingerprint, or '*' (every server)
 */
function resolve(kind, entry, view) {
	const self = view.self.fp
	const peers = view.peers.filter((p) => p.fp)
	const out = (who, auto) => ({ who, auto, here: who === EVERY || who === self })
	if (entry.by && (entry.by === self || peers.some((p) => p.fp === entry.by))) return out(entry.by, false)
	if (kind === 'artnet_in') return out(EVERY, true)
	const all = [{ fp: self, tracking: !!view.tracking }, ...peers.filter((p) => p.online)]
	if (all.length === 1) return out(self, true)
	const trackers = all.filter((s) => s.tracking === true)
	if (trackers.length === 1) return out(trackers[0].fp, true)
	if (view.master && all.some((s) => s.fp === view.master)) return out(view.master, true)
	return out(all.map((s) => s.fp).sort()[0], true)
}

/** @param {{ persistence: { get: Function, set: Function }, now?: () => number }} opts */
function createSenders({ persistence, now = Date.now }) {
	let state = normalize(persistence.get(STORE_KEY))
	const subs = new Set()
	const emit = () => {
		persistence.set(STORE_KEY, state)
		for (const fn of [...subs]) {
			try {
				fn(get())
			} catch {
				/* one bad subscriber must not stop the others */
			}
		}
	}
	const get = () => JSON.parse(JSON.stringify(state))
	return {
		get,
		/** @throws {Error} .status 400 for an unknown kind or a malformed fingerprint. → the saved set */
		set(kind, by) {
			if (!KINDS.includes(kind)) throw Object.assign(new Error(`unknown kind "${kind}" (known: ${KINDS.join(', ')})`), { status: 400 })
			const b = String(by ?? '')
			if (b && !FP_RE.test(b)) throw Object.assign(new Error('by must be "" (Auto) or a server fingerprint'), { status: 400 })
			state = { ...state, [kind]: { by: b, at: Math.max(now(), state[kind].at + 1) } }
			emit()
			return get()
		},
		/** A linked server's set: per kind, the newer `at` wins. → true when anything changed here. */
		merge(raw) {
			const inc = normalize(raw)
			let changed = false
			const next = { ...state }
			for (const k of KINDS) {
				if (inc[k].at > next[k].at) {
					next[k] = inc[k]
					changed = true
				}
			}
			if (changed) {
				state = next
				emit()
			}
			return changed
		},
		onChange(fn) {
			subs.add(fn)
			return () => subs.delete(fn)
		},
	}
}

/**
 * Keeps the linked servers' sets in agreement. tick() runs after every cluster poll: an online server that has not
 * accepted the current set (it just came online, the set changed, or the last send failed) is sent it. A refusal (a
 * 4xx: not linked back yet, an older server's unknown action) is asked again every REFUSED_RETRY_MS, not every poll;
 * no answer, at the next poll. A set change or the server coming back online asks at once.
 * @param {{ peers: () => { id: string, name: string, online: boolean }[], get: () => object,
 *   call: (id: string, action: string, args: object, o?: object) => Promise<{ ok: boolean, status?: number, json?: any, error?: string }>,
 *   log?: (lvl: string, msg: string) => void, now?: () => number }} deps
 */
function createSendersSync(deps) {
	const now = deps.now || Date.now
	const sent = new Map() // peer id → the set it last accepted (JSON)
	const wait = new Map() // peer id → { sig, until }: refused this set, ask again after `until`
	const busy = new Set()
	const refused = new Map() // peer id → why (logged once per reason)
	async function tick() {
		const sig = JSON.stringify(deps.get())
		for (const p of deps.peers()) {
			if (!p.online) {
				sent.delete(p.id)
				wait.delete(p.id)
				continue
			}
			const w = wait.get(p.id)
			if (sent.get(p.id) === sig || busy.has(p.id) || (w && w.sig === sig && now() < w.until)) continue
			busy.add(p.id)
			try {
				const r = await deps.call(p.id, 'cluster.senders', { senders: JSON.parse(sig) }, { quiet: true })
				if (r.ok) {
					sent.set(p.id, sig)
					wait.delete(p.id)
					refused.delete(p.id)
				} else {
					if (r.status >= 400 && r.status < 500) wait.set(p.id, { sig, until: now() + REFUSED_RETRY_MS })
					const why = r.json?.error || r.error || `HTTP ${r.status}`
					if (refused.get(p.id) !== why) deps.log?.('warn', `[cluster] senders → ${p.name}: ${why}`)
					refused.set(p.id, why)
				}
			} finally {
				busy.delete(p.id)
			}
		}
	}
	return { tick, refused: (id) => refused.get(id) || '' }
}

module.exports = { STORE_KEY, KINDS, EVERY, REFUSED_RETRY_MS, normalize, resolve, createSenders, createSendersSync }
