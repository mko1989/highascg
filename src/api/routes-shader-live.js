'use strict'

/**
 * WO-606 — Shader Live endpoints (the node owns the working copy; client/components/shader-live-editor.js
 * did all of this in the browser):
 *   GET  /api/shader-live                      → { instances }   every shader live on any channel, PGM first
 *   GET  /api/shader-live/shaders/:id          → view            key controls, params, advanced order, dirty
 *   POST /api/shader-live/shaders/:id/:op      → { ok, view, push }   op = set | macro | reset | preset |
 *        preset-save | preset-delete | pin | hide | unhide | label | randomize | wiggle | save
 *   POST /api/shader-live/mixer { channel, layer, cmd, value }   universal Caspar-mixer rides
 * Value changes land on EVERY live instance of the shader via `CG UPDATE` (player.js hot-recompiles).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const S = require('../shaderfx/shader-live-session')
const Ops = require('../shaderfx/shader-live-ops')
const { liveShaderInstances } = require('../shaderfx/shader-live-instances')
const playbackTracker = require('../state/playback-tracker')

/* Web MIXER_ROWS (shader-live-rows.js) — available for every shader, no GLSL literals needed. */
const MIXER_CMDS = { OPACITY: [0, 1], BRIGHTNESS: [0, 3], SATURATION: [0, 3], CONTRAST: [0, 3] }

const reply = (status, data) => ({ status, headers: JSON_HEADERS, body: jsonBody(data) })

/** @type {Map<string, Promise<any>>} one op at a time per shader — rewrites must not interleave */
const chains = new Map()
function serialized(id, fn) {
	const next = (chains.get(id) || Promise.resolve()).then(fn, fn)
	chains.set(id, next.catch(() => {}))
	return next
}

async function handleView(id) {
	const s = await S.open(id)
	if (!s) return reply(404, { ok: false, error: 'Shader not found' })
	return reply(200, await S.view(id, s))
}

async function handleOp(id, op, body, ctx) {
	return serialized(id, async () => {
		const s = await S.open(id)
		if (!s) return reply(404, { ok: false, error: 'Shader not found' })
		const b = parseBody(body) || {}
		try {
			const r = await Ops.run(op, b, s, { ctx, id })
			if (r.error) return reply(r.status || 400, { ok: false, error: r.error })
			if (r.manifest) s.cfg.controls = r.manifest
			if (r.manifest || r.curated) await S.persistCuration(s)
			let passes = r.passes || []
			if (r.items?.length) passes = await S.applyBatch(s, r.items)
			const push = passes.length ? await S.pushLive(ctx, id, s, passes) : null
			return reply(200, { ok: true, ...(r.extra || {}), push, view: await S.view(id, s) })
		} catch (e) {
			return reply(500, { ok: false, error: String(e?.message || e) })
		}
	})
}

async function handleMixer(body, ctx) {
	const b = parseBody(body) || {}
	const cmd = String(b.cmd || '').toUpperCase()
	const range = MIXER_CMDS[cmd]
	const ch = parseInt(b.channel, 10)
	const layer = parseInt(b.layer, 10)
	const v = Number(b.value)
	if (!range || !(ch > 0) || !(layer > 0) || !Number.isFinite(v)) return reply(400, { ok: false, error: 'channel, layer, cmd (OPACITY|BRIGHTNESS|SATURATION|CONTRAST), value' })
	const line = `MIXER ${ch}-${layer} ${cmd} ${Math.min(range[1], Math.max(range[0], v))}`
	try {
		await ctx.amcp.raw(line)
		playbackTracker.recordAmcpLines(ctx, [line])
		return reply(200, { ok: true })
	} catch (e) {
		return reply(500, { ok: false, error: String(e?.message || e) })
	}
}

/** @param {any} routes */
function register(routes) {
	routes.get('/api/shader-live', ({ ctx }) => reply(200, { instances: liveShaderInstances(ctx) }), { requireCaspar: false })
	routes.get('/api/shader-live/shaders/*', ({ path }) => {
		const m = String(path).match(/^\/api\/shader-live\/shaders\/([^/]+)$/)
		return m ? handleView(decodeURIComponent(m[1]).toLowerCase()) : reply(404, { ok: false, error: 'not found' })
	}, { requireCaspar: false })
	routes.post('/api/shader-live/mixer', ({ body, ctx }) => handleMixer(body, ctx), { requireCaspar: true })
	routes.post('/api/shader-live/shaders/*', ({ path, body, ctx }) => {
		const m = String(path).match(/^\/api\/shader-live\/shaders\/([^/]+)\/([a-z-]+)$/)
		return m ? handleOp(decodeURIComponent(m[1]).toLowerCase(), m[2], body, ctx) : reply(404, { ok: false, error: 'not found' })
	}, { requireCaspar: true })
}

module.exports = { register, MIXER_CMDS }
