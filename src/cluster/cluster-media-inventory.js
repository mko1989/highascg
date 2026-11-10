'use strict'

/**
 * WO-1029 plan 07 C10 — what media each linked server HAS (the "shared media library").
 *
 * Per file `{ p, id, s, m }`: path under the media folder (with extension), the Caspar id looks store (upper case, no
 * extension: `TESTOWE/BIG_BUCK_BUNNY_1080P24`), size, mtime (whole seconds). No hashing: multi-GB clips; size decides
 * "same", mtime only says which copy is newer.
 *
 * Wire (signed call `media.have`, cluster-media-link.js): a box can hold tens of thousands of files, so the asker sends
 * the digest it knows; an unchanged inventory answers `{ same: true }` (a few bytes). Otherwise pages of PAGE_MAX rows
 * `[p, s, m]` (about 60 bytes each: 10 000 files ≈ 600 KB in two pages); a digest change between pages restarts once.
 * A server that does not answer (older build: 404 / unknown action, offline, scan not finished) is `known: false` —
 * never "missing".
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { MEDIA_FILE_EXT } = require('../utils/media-browser-dedupe')
const { toCasparClsMediaId } = require('../media/caspar-cls-id')

const MAX_FILES = 50000
const PAGE_MAX = 5000
const LOCAL_TTL_MS = 10000
const REMOTE_TTL_MS = 10000
const HIDDEN_DIRS = new Set(['tb', '.tb'])

/** Files Caspar's ffmpeg producer plays that the browser list does not name (owner 10.11: BIG_BUCK_BUNNY_1080P24 is a .Y4M). */
const EXTRA_EXT = /\.(y4m|nut|flv|wmv|dv|h264|h265|hevc|264|265|dpx|exr|mka|opus|aiff?|wma|3gp)$/i
const isMediaName = (n) => MEDIA_FILE_EXT.test(n) || EXTRA_EXT.test(n)
/** Path → the Caspar id looks store (upper case, no extension). */
const idOf = (p) => toCasparClsMediaId(String(p || '').replace(EXTRA_EXT, ''))

/** Match key of a media value or path: Caspar id, lower case, NFC (Caspar ids are case-insensitive). */
const keyOf = (v) => idOf(v).normalize('NFC').toLowerCase()

/**
 * Walk the media folder → { files: [{ p, id, s, m }], truncated }. Async and bounded (MAX_FILES); dot files, the
 * thumbnail bucket and non-media extensions are skipped (same rules as the browser scan).
 * @param {string} base
 * @param {{ maxFiles?: number, fsp?: object }} [opts]
 */
async function scanMediaInventory(base, opts = {}) {
	const fsp = opts.fsp || fs.promises
	const max = opts.maxFiles || MAX_FILES
	const files = []
	let truncated = false
	async function walk(rel, depth) {
		if (depth > 16) return
		let entries
		try {
			entries = await fsp.readdir(path.join(base, rel), { withFileTypes: true })
		} catch {
			return
		}
		for (const e of entries) {
			if (files.length >= max) {
				truncated = true
				return
			}
			if (e.name.startsWith('.')) continue
			const r = rel ? `${rel}/${e.name}` : e.name
			if (e.isDirectory()) {
				if (!HIDDEN_DIRS.has(e.name.toLowerCase())) await walk(r, depth + 1)
				continue
			}
			if (!e.isFile() || !isMediaName(e.name)) continue
			try {
				const st = await fsp.stat(path.join(base, r))
				const p = r.normalize('NFC')
				files.push({ p, id: idOf(p), s: st.size, m: Math.floor(st.mtimeMs / 1000) })
			} catch {
				/* gone meanwhile */
			}
		}
	}
	await walk('', 0)
	files.sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0))
	return { files, truncated }
}

/** Short digest of an inventory (order-independent input is sorted by the scan). */
function digestOf(files) {
	const h = crypto.createHash('sha1')
	for (const f of files) h.update(`${f.p}\0${f.s}\0${f.m}\n`)
	return h.digest('hex').slice(0, 16)
}

/**
 * This server's inventory, cached LOCAL_TTL_MS; concurrent askers share one scan.
 * @param {{ scan: () => Promise<{ files: object[], truncated?: boolean }>, info?: () => Promise<object>|object,
 *   now?: () => number, ttlMs?: number }} deps  info: extra header fields (free_bytes, on_air, can_throttle, media_root)
 */
function createLocalInventory(deps) {
	const now = deps.now || Date.now
	const ttl = deps.ttlMs ?? LOCAL_TTL_MS
	let cur = null
	let pending = null
	async function get({ fresh = false } = {}) {
		if (cur && !fresh && now() - cur.at < ttl) return cur
		if (pending) return pending
		pending = (async () => {
			try {
				const r = await deps.scan()
				const files = r.files || []
				cur = { at: now(), digest: digestOf(files), files, truncated: !!r.truncated }
				return cur
			} finally {
				pending = null
			}
		})()
		return pending
	}
	/** The `media.have` answer: { same } when the asker's digest is current, else one page. */
	async function answer(args = {}) {
		const inv = await get()
		let extra = {}
		try {
			extra = (await deps.info?.()) || {}
		} catch {
			/* header extras are optional */
		}
		const head = { v: 1, digest: inv.digest, count: inv.files.length, truncated: inv.truncated, at: inv.at, ...extra }
		if (args.digest && args.digest === inv.digest) return { ...head, same: true }
		const offset = Math.max(0, parseInt(args.offset, 10) || 0)
		const limit = Math.max(0, Math.min(PAGE_MAX, args.limit == null ? PAGE_MAX : parseInt(args.limit, 10) || 0))
		return { ...head, offset, files: inv.files.slice(offset, offset + limit).map((f) => [f.p, f.s, f.m]) }
	}
	return { get, answer, invalidate: () => (cur = null) }
}

/** Rows of a wire page → [{ p, id, s, m }] (malformed rows dropped). */
function decodeRows(rows) {
	const out = []
	for (const r of Array.isArray(rows) ? rows : []) {
		if (!Array.isArray(r) || typeof r[0] !== 'string' || !r[0] || r[0].includes('..')) continue
		const s = Number(r[1])
		const m = Number(r[2])
		if (!Number.isFinite(s) || s < 0) continue
		out.push({ p: r[0].normalize('NFC'), id: idOf(r[0]), s, m: Number.isFinite(m) ? m : 0 })
	}
	return out
}

/** Why a `media.have` call did not give an inventory → a short reason. */
function unknownReason(r) {
	const err = String(r?.json?.error || r?.error || '')
	if (r?.status === 404 || /unknown action/i.test(err)) return 'old build'
	if (r?.status === 503 && /scan/i.test(err)) return 'scanning'
	if (!r?.status) return 'offline'
	return `error: ${err || 'HTTP ' + r.status}`.slice(0, 120)
}

/**
 * The linked servers' inventories as this server last fetched them.
 * @param {{ have: (peerId: string, args: object) => Promise<{ ok: boolean, status: number, json: object }>,
 *   now?: () => number, ttlMs?: number }} deps  have: the signed `media.have` call to that server
 */
function createRemoteInventories(deps) {
	const now = deps.now || Date.now
	const ttl = deps.ttlMs ?? REMOTE_TTL_MS
	const map = new Map() // peer id → { known, reason, digest, files: [], head, at }
	const inflight = new Map()

	async function fetchAll(id, prev) {
		let r = await deps.have(id, { digest: prev?.known ? prev.digest : '', offset: 0, limit: PAGE_MAX })
		if (!r?.ok || !r.json) return { known: false, reason: unknownReason(r), at: now() }
		if (r.json.same && prev?.known) return { ...prev, head: headOf(r.json), at: now() }
		for (let attempt = 0; attempt < 2; attempt++) {
			if (attempt) r = await deps.have(id, { offset: 0, limit: PAGE_MAX }) // it changed between pages: start over once
			if (!r?.ok || !r.json || !Array.isArray(r.json.files)) return { known: false, reason: unknownReason(r), at: now() }
			const digest = r.json.digest
			const count = Number(r.json.count || 0)
			const files = decodeRows(r.json.files)
			let got = r.json.files.length
			let broken = false
			while (got < count) {
				const n = await deps.have(id, { offset: got, limit: PAGE_MAX })
				if (!n?.ok || !n.json) return { known: false, reason: unknownReason(n), at: now() }
				if (n.json.digest !== digest || !Array.isArray(n.json.files) || !n.json.files.length) {
					broken = true
					break
				}
				got += n.json.files.length
				files.push(...decodeRows(n.json.files))
			}
			if (!broken) return { known: true, reason: '', digest, files, head: headOf(r.json), at: now() }
		}
		return { known: false, reason: 'error: inventory kept changing', at: now() }
	}

	const headOf = (j) => ({ free_bytes: num(j.free_bytes), on_air: typeof j.on_air === 'boolean' ? j.on_air : null,
		can_throttle: j.can_throttle === true, can_resume: j.can_resume === true, media_root: typeof j.media_root === 'string' ? j.media_root : '', truncated: !!j.truncated })

	/** Refresh one server (shared while in flight) → its entry. */
	function refresh(id, { force = false } = {}) {
		const prev = map.get(id)
		if (!force && prev && now() - prev.at < ttl) return Promise.resolve(prev)
		if (inflight.has(id)) return inflight.get(id)
		const p = fetchAll(id, prev)
			.catch((e) => ({ known: false, reason: `error: ${e.message}`, at: now() }))
			.then((e) => {
				map.set(id, e)
				inflight.delete(id)
				return e
			})
		inflight.set(id, p)
		return p
	}

	/** Online peers refreshed (all in parallel); offline / unlinked ones → unknown. */
	async function refreshAll(peers, opts = {}) {
		const ids = new Set(peers.map((p) => p.id))
		for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id)
		await Promise.all(peers.map((p) => (p.online ? refresh(p.id, opts) : (map.set(p.id, { known: false, reason: 'offline', at: now() }), null))))
	}

	return { refresh, refreshAll, get: (id) => map.get(id) || { known: false, reason: 'not asked yet' }, forget: (id) => map.delete(id) }
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null)

module.exports = { scanMediaInventory, digestOf, keyOf, idOf, createLocalInventory, createRemoteInventories, PAGE_MAX, MAX_FILES }
