'use strict'

/**
 * WO-1074 §2.6 — LED wall pictures in the RC game world (work/notes/rc-game-contract.md "2.6").
 *
 *   screensFrom(objects, rasterOf) → the scene JSON's `screens`: the project's LED walls / TVs / projection screens
 *     (project.previs.stage.objects — MVR objects mapped as screens, WO-634, are stored there too) as
 *     { id, role, p (picture CENTRE, Godot frame), rot [deg, YXZ like Godot's rotation_degrees], size [w, h] m,
 *       curveDeg, cols, uv [u0, v0, u1, v1] (v down) }.
 *   createRcVideo(deps) → the JPEG fan-out to game sockets that sent `{ t: 'video', on: true }`.
 *
 * Geometry is the previs's (godot/client/features/previs/stage_builder.gd + stage_objects.gd): an object's `position`
 * is the BOTTOM-centre of its picture (the strip runs y = 0 … h in the object's frame, facing +Z; src/stage/mvr-export.js
 * "origin bottom-centre, picture facing +Z"), so the centre sent here is position + R·(0, h/2, 0). A curved wall's
 * column edges are stage_objects.gd column_edges (curve > 0 bends the ends towards +Z); its middle edge is the origin.
 * `uv` = source.rect / the role's raster (stage_objects.gd uv_rect); the raster is the role's Caspar channel resolution
 * (INFO CONFIG), else the bounding box of every rect that role feeds.
 *
 * Pictures: ONE extra client of the existing video feed (src/system/video-feed.js `addClient`) — a socket-shaped object,
 * so the feed's worker thread and its one ffmpeg per role are shared with every other feed client; its frames arrive
 * already in the game's framing `[u8 n][role][JPEG]` and go out unchanged (one Buffer for all sockets). Asked at 480 px,
 * 8 fps in the feed's `game` tier (worker key `<role>~game`): its own encode, so a remote GUI watching the same role at
 * 960 px does not make the game's frames bigger (this module sends ≤ 8 / s either way). The tier gets local roles only
 * (a role relayed from a linked server is not offered to it). While a game socket wants pictures the
 * roles are leased (src/system/video-surfaces.js: Caspar `ADD <ch> SHM` — a read-only consumer on that channel, removed
 * 15 s after the last lease), renewed every 5 s, released when the last subscriber leaves or the host switches walls off.
 */

const { EventEmitter } = require('events')

const ROLE_RE = /^[A-Za-z0-9_-]{1,32}$/
const PARAMS = { width: 480, fps: 8, quality: 7 }
const LEASE_ID = 'rc-game'
const LEASE_EVERY_MS = 5000
const MAX_VIDEO_BUFFERED = 64 * 1024 // well under the game's 256 KB JSON limit: pictures never starve race messages
const MAX_SCREENS = 32
const SCREEN_TYPES = new Set(['led_wall', 'tv', 'projection'])

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
const r4 = (v) => Math.round(v * 10000) / 10000
const vec = (v, n, d) => (Array.isArray(v) && v.length >= n ? v.slice(0, n).map((x, k) => num(x, d[k])) : d.slice())

/** stage_objects.gd size_m → [w, h] metres. */
function sizeOf(o) {
	if (o.type === 'tv') {
		const a = vec(o.aspect, 2, [16, 9])
		const asp = a[0] / (a[1] || 1)
		const d = num(o.diagonal_in, 55) * 0.0254
		const h = d / Math.sqrt(1 + asp * asp)
		return o.portrait === true ? [h, asp * h] : [asp * h, h]
	}
	if (o.type === 'projection') return vec(o.screen_m, 2, [4, 2.25])
	const mm = vec(o.panel_mm, 2, [500, 500])
	const pn = vec(o.panels, 2, [10, 6])
	return [(mm[0] * Math.max(1, Math.round(pn[0]))) / 1000, (mm[1] * Math.max(1, Math.round(pn[1]))) / 1000]
}

/** Godot rotation_degrees (YXZ: R = Ry · Rx · Rz) applied to (0, h, 0) → its world offset. */
function upOffset(rotDeg, h) {
	const [x, y, z] = rotDeg.map((d) => (d * Math.PI) / 180)
	// R · (0, 1, 0): Rz(0,1,0) = (−sin z, cos z, 0); Rx → (−sin z, cos x cos z, sin x cos z); Ry → …
	const vx = -Math.sin(z)
	const vy = Math.cos(x) * Math.cos(z)
	const vz = Math.sin(x) * Math.cos(z)
	return [h * (Math.cos(y) * vx + Math.sin(y) * vz), h * vy, h * (-Math.sin(y) * vx + Math.cos(y) * vz)]
}

/**
 * @param {any[]} objects project.previs.stage.objects
 * @param {(role: string) => ({ w: number, h: number } | null)} [rasterOf]
 */
function screensFrom(objects, rasterOf = () => null) {
	const list = (Array.isArray(objects) ? objects : []).filter(
		(o) => o && typeof o === 'object' && SCREEN_TYPES.has(o.type || 'led_wall') && o.visible !== false
	)
	const roleOf = (o) => (ROLE_RE.test(String(o.source?.role || '')) ? String(o.source.role) : 'pgm1')
	const bbox = new Map() // role → [w, h] covering every rect it feeds (the raster when Caspar's is unknown)
	for (const o of list) {
		const r = o.source?.rect
		if (!r) continue
		const b = bbox.get(roleOf(o)) || [0, 0]
		bbox.set(roleOf(o), [Math.max(b[0], num(r.x, 0) + num(r.w, 0)), Math.max(b[1], num(r.y, 0) + num(r.h, 0))])
	}
	const out = []
	for (const o of list) {
		if (out.length >= MAX_SCREENS) break
		const type = o.type || 'led_wall'
		const role = roleOf(o)
		const size = sizeOf({ ...o, type })
		const rot = vec(o.rotation, 3, [0, 0, 0])
		const pos = vec(o.position, 3, [0, 0, 0])
		const up = upOffset(rot, size[1] / 2)
		let raster
		try {
			raster = rasterOf(role)
		} catch {
			raster = null
		}
		const bb = bbox.get(role)
		const W = raster?.w > 0 ? raster.w : bb?.[0] > 0 ? bb[0] : 0
		const H = raster?.h > 0 ? raster.h : bb?.[1] > 0 ? bb[1] : 0
		const r = o.source?.rect
		let uv = [0, 0, 1, 1]
		if (r && W > 0 && H > 0) {
			const x = Math.max(0, num(r.x, 0))
			const y = Math.max(0, num(r.y, 0))
			const c = (v) => Math.max(0, Math.min(1, v))
			uv = [c(x / W), c(y / H), c(x / W + Math.max(1, num(r.w, W)) / W), c(y / H + Math.max(1, num(r.h, H)) / H)]
		}
		out.push({
			id: String(o.id || `${type}_${out.length + 1}`).slice(0, 64),
			role,
			p: [pos[0] + up[0], pos[1] + up[1], pos[2] + up[2]].map(r4),
			rot: rot.map(r4),
			size: size.map(r4),
			curveDeg: type === 'led_wall' ? Math.max(-30, Math.min(30, num(o.curve_deg, 0))) : 0,
			cols: type === 'led_wall' ? Math.max(1, Math.min(200, Math.round(vec(o.panels, 2, [10, 6])[0]))) : 1,
			uv: uv.map(r4),
		})
	}
	return out
}

/**
 * @param {{ feed: () => ({ addClient: Function } | null), lease: (id: string, roles: string[]) => any,
 *   roles: () => string[], now?: () => number, setInterval?: Function, clearInterval?: Function, log?: Function,
 *   params?: object }} deps
 */
function createRcVideo(deps) {
	const now = deps.now || Date.now
	const every = deps.setInterval || setInterval
	const stopEvery = deps.clearInterval || clearInterval
	const log = deps.log || (() => {})
	const params = { ...PARAMS, ...(deps.params || {}) }
	const minGap = Math.floor(1000 / params.fps) - 10 // ≤ fps per role whatever the shared encoder runs at
	const subs = new Set()
	let on = true
	let client = null // the socket-shaped feed client
	let roles = [] // what the feed is asked for now
	let leaseTimer = null
	let warned = false
	const lastAt = new Map()
	const stats = { frames: 0, sent: 0, skipped: 0 }

	const lease = (list) => {
		try {
			Promise.resolve(deps.lease(LEASE_ID, list)).catch((e) => log('warn', `[rc-video] lease: ${e?.message || e}`))
		} catch (e) {
			log('warn', `[rc-video] lease: ${e?.message || e}`)
		}
	}

	/** A feed frame `[u8 n][role][jpeg]` → every subscribed game socket that is not behind. */
	function onFrame(data) {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
		if (buf.length < 2 || buf.length < 1 + buf[0]) return
		const role = buf.subarray(1, 1 + buf[0]).toString('latin1')
		if (!roles.includes(role)) return
		const t = now()
		if (t - (lastAt.get(role) ?? -Infinity) < minGap) return
		lastAt.set(role, t)
		stats.frames++
		for (const ws of subs) {
			if (ws.readyState !== 1 || ws.bufferedAmount > MAX_VIDEO_BUFFERED) {
				stats.skipped++
				continue
			}
			try {
				ws.send(buf, { binary: true })
				stats.sent++
			} catch {
				/* socket going away */
			}
		}
	}

	function makeClient() {
		const c = new EventEmitter()
		c.readyState = 1
		c.bufferedAmount = 0
		c.send = (data) => onFrame(data)
		c.close = () => closeClient()
		c.terminate = () => closeClient()
		return c
	}

	function closeClient() {
		const c = client
		client = null
		if (!c) return
		c.readyState = 3
		c.emit('close')
	}

	function wanted() {
		if (!on || !subs.size) return []
		let list
		try {
			list = deps.roles() || []
		} catch {
			list = []
		}
		return [...new Set(list.map(String).filter((r) => ROLE_RE.test(r)))].sort()
	}

	/** Bring the feed subscription and the lease in line with the subscribers / switch / screens. */
	function sync() {
		const next = wanted()
		if (next.join() === roles.join() && (next.length === 0) === !client) return
		roles = next
		if (!next.length) {
			closeClient()
			if (leaseTimer) stopEvery(leaseTimer)
			leaseTimer = null
			lease([])
			return
		}
		const feed = deps.feed ? deps.feed() : null
		if (!feed || typeof feed.addClient !== 'function') {
			if (!warned) log('warn', '[rc-video] the video feed is not attached — no LED wall pictures')
			warned = true
			roles = []
			return
		}
		if (!client) {
			client = makeClient()
			feed.addClient(client, { ...params }, { tier: 'game' }) // its own 480 px encode (`<role>~game`)
		}
		client.emit('message', Buffer.from(JSON.stringify({ roles: next, ...params })), false)
		lease(next)
		if (!leaseTimer) {
			leaseTimer = every(() => lease(roles), LEASE_EVERY_MS)
			if (leaseTimer && typeof leaseTimer.unref === 'function') leaseTimer.unref()
		}
	}

	return {
		/** `{ t: 'video', on }` from a game socket. */
		subscribe(ws, want) {
			if (want === true) subs.add(ws)
			else subs.delete(ws)
			sync()
		},
		detach(ws) {
			if (subs.delete(ws)) sync()
		},
		setOn(v) {
			on = v !== false
			sync()
		},
		isOn: () => on,
		/** The screens (scene) changed: re-ask the feed for the roles they name now. */
		refresh: () => sync(),
		stop() {
			subs.clear()
			sync()
		},
		roles: () => roles.slice(),
		subscribers: () => subs.size,
		stats: () => ({ ...stats, roles: roles.slice(), subscribers: subs.size }),
		/** Smokes: feed a frame as the feed would. */
		_onFrame: onFrame,
	}
}

/**
 * The production deps (ctx = the app context): the feed attached by index.js (`ctx._videoFeed.feed`), the lease manager,
 * the screens of the active project (read at most every 2 s) and the role rasters from Caspar's INFO CONFIG.
 * → { screens: () => list, video deps }
 */
function rcVideoDeps(ctx, { log } = {}) {
	const rasterOf = (role) => {
		const map = require('../fixtures/pixel-map-service').liveChannelMap(ctx)
		const ch = require('../system/video-surfaces').resolveRoleChannel(role, map)
		const r = ch ? map?.channelResolutionsByChannel?.[String(ch)] : null
		return r && r.w > 0 && r.h > 0 ? { w: r.w, h: r.h } : null
	}
	let memo = { at: 0, list: [] }
	const screens = () => {
		if (Date.now() - memo.at < 2000) return memo.list
		let list
		try {
			const project = require('../engine/project-scenes').loadFullProject()
			list = screensFrom(project?.previs?.stage?.objects, rasterOf)
		} catch {
			list = []
		}
		memo = { at: Date.now(), list }
		return list
	}
	return {
		screens,
		feed: () => ctx?._videoFeed?.feed || null,
		lease: (id, roles) => require('../system/video-surfaces').getVideoSurfaceManager(ctx).lease(id, roles),
		roles: () => screens().map((s) => s.role),
		log: log || ((level, msg) => (typeof ctx?.log === 'function' ? ctx.log(level, msg) : undefined)),
	}
}

module.exports = { createRcVideo, rcVideoDeps, screensFrom, PARAMS, LEASE_ID, MAX_VIDEO_BUFFERED }
