'use strict'

/**
 * WO-606 — Shader Live endpoints (the node owns the working copy; client/components/shader-live-editor.js
 * did all of this in the browser):
 *   GET  /api/shader-live                      → { instances }   every shader live on any channel, PGM first
 *   GET  /api/shader-live/shaders/:id          → view            key controls, params, advanced order, dirty (?working=1: + working GLSL)
 *   POST /api/shader-live/shaders/:id/:op      → { ok, view, push }   op = set | macro | reset | preset |
 *        preset-save | preset-delete | pin | hide | unhide | label | randomize | wiggle | save
 *   POST /api/shader-live/mixer { channel, layer, cmd, value }   universal Caspar-mixer rides
 *   POST /api/shader-live/audition { value, label?, mainIndex? }  stage a library shader on PRV (Templates click)
 *   POST /api/shader-live/scan { common, passes }  → { params }   Shader FX editor: params of UNSAVED sources
 *   POST /api/shader-live/rewrite { common, passes, index, values } → { passKey, source }   one literal rewritten
 *   POST /api/shader-live/push { shaderId, payload, prvOnly? } → { targets, errors }   CG UPDATE an UNSAVED edit
 *        (web shader-live-editor.js working copy, wiggle preview) onto the live instances; 403 re-hosts once
 * GET also carries `stack` — the main's PGM look-band layers 10–20 and their occupants (web shader-live-stack.js);
 * landing / clearing rides the existing POST /api/shader-stack.
 * Value changes land on EVERY live instance of the shader via `CG UPDATE` (player.js hot-recompiles).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const S = require('../shaderfx/shader-live-session')
const Ops = require('../shaderfx/shader-live-ops')
const { liveShaderInstances } = require('../shaderfx/shader-live-instances')
const playbackTracker = require('../state/playback-tracker')
const liveSceneState = require('../state/live-scene-state')
const { getRouteMap } = require('./routes-scene-shared')
const { STACK_LAYER_MIN, STACK_LAYER_MAX } = require('./routes-shader-stack')

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

/**
 * WO-894: `?working=1` adds `working` — the session's rewritten GLSL ({ common, passes: { key: { source } } }) — so a client
 * that renders the shader itself (the Godot Visuals tab, shadertoy_rd.gd) can recompile what the controls edited. Opt-in:
 * the sources are tens of KB and the op replies (which carry `view`) never need them.
 */
async function handleView(id, withWorking) {
	const s = await S.open(id)
	if (!s) return reply(404, { ok: false, error: 'Shader not found' })
	const v = await S.view(id, s)
	if (withWorking) v.working = S.workingOf(s)
	return reply(200, v)
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
			let push = passes.length ? await S.pushLive(ctx, id, s, passes) : null
			if (r.timeScale != null) {
				s.timeScale = r.timeScale // WO-580: the speed ride, eased by the player — no recompile
				const t = await S.pushTimeScale(ctx, id, s)
				push = push ? { ...push, errors: [...push.errors, ...t.errors] } : t
			}
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

/** Occupant name of a stack row: the source's basename without extension (web occupantLabel). */
function occupantLabel(layer) {
	const v = String(layer?.source?.value || '')
	return (v.replace(/\\/g, '/').split('/').pop() || v).replace(/\.[a-z0-9]+$/i, '')
}

/** @param {object} ctx @param {number} main */
function stackOf(ctx, main) {
	const ch = getRouteMap(ctx).programChannels?.[main]
	const scene = ch != null ? liveSceneState.getChannel(ch)?.scene : null
	const byNum = new Map((scene?.layers || []).map((l) => [Number(l.layerNumber), l]))
	const rows = []
	for (let n = STACK_LAYER_MIN; n <= STACK_LAYER_MAX; n++) rows.push({ layerNumber: n, occupant: occupantLabel(byNum.get(n)) })
	return { main, channel: ch ?? null, rows }
}

/** Templates click while Shader Live is open: an ephemeral one-layer look on the main's PRV (web shader-live-audition.js). */
async function handleAudition(body, ctx) {
	const b = parseBody(body) || {}
	const value = String(b.value || '').trim()
	const sid = (value.toLowerCase().match(/sh-[a-z0-9-]+$/) || [])[0]
	if (!sid) return reply(400, { ok: false, error: 'value must be a shader template (…/sh-<id>)' })
	const main = Math.max(0, parseInt(b.mainIndex, 10) || 0)
	const rm = getRouteMap(ctx)
	const programCh = rm.programChannels?.[main]
	const prvCh = rm.previewChannels?.[main]
	if (!programCh || !prvCh) return reply(409, { ok: false, error: 'no preview bus for this main' })
	const label = String(b.label || sid)
	const incomingScene = {
		id: `shader-audition-${main}`,
		name: `Audition ${label}`,
		layers: [{ layerNumber: 10, source: { type: 'template', value }, opacity: 1, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } }],
	}
	const take = { channel: programCh, target: 'preview', forceCut: true, useServerLive: true, incomingScene }
	const r = await require('./routes-scene').handlePost('/api/scene/take', JSON.stringify(take), ctx)
	if (!r || r.status >= 400) return r || reply(503, { ok: false, error: 'Caspar not connected' })
	return reply(200, { ok: true, key: `${sid}@${prvCh}-10` })
}

/** Web editor's own working copy → every live instance (or only PRV for a wiggle). payload = { common } | { passes: { k: { source } } }. */
async function handlePush(body, ctx) {
	const b = parseBody(body) || {}
	const id = String(b.shaderId || '').trim().toLowerCase()
	const pl = b.payload && typeof b.payload === 'object' ? b.payload : null
	const passesOk = (ps) => ps && typeof ps === 'object' && Object.values(ps).every((v) => v && typeof v.source === 'string')
	const keys = pl ? Object.keys(pl) : []
	const ok = keys.length > 0 && keys.every((k) => (k === 'common' ? typeof pl.common === 'string' : k === 'passes' && passesOk(pl.passes)))
	if (!id || !ok) return reply(400, { ok: false, error: 'shaderId and payload { common } | { passes: { key: { source } } } required' })
	const targets = liveShaderInstances(ctx).filter((i) => i.shaderId === id && (!b.prvOnly || i.isPrv))
	const errors = await serialized(id, () => S.pushPayload(ctx, targets, pl))
	return reply(200, { ok: true, targets: targets.length, errors })
}

/** @param {any} routes */
function register(routes) {
	routes.get('/api/shader-live', ({ ctx, query }) => reply(200, { instances: liveShaderInstances(ctx), stack: stackOf(ctx, Math.max(0, parseInt(query?.main, 10) || 0)) }), { requireCaspar: false })
	const FX = require('../shaderfx/shader-fx-params')
	routes.post('/api/shader-live/scan', async ({ body }) => reply(200, { params: await FX.scan(parseBody(body) || {}) }), { requireCaspar: false })
	routes.post('/api/shader-live/rewrite', async ({ body }) => {
		const r = await FX.rewrite(parseBody(body) || {})
		return 'error' in r ? reply(400, { ok: false, error: r.error }) : reply(200, { ok: true, ...r })
	}, { requireCaspar: false })
	routes.post('/api/shader-live/audition', ({ body, ctx }) => handleAudition(body, ctx), { requireCaspar: true })
	routes.get('/api/shader-live/shaders/*', ({ path, query }) => {
		const m = String(path).match(/^\/api\/shader-live\/shaders\/([^/]+)$/)
		return m ? handleView(decodeURIComponent(m[1]).toLowerCase(), query?.working === '1') : reply(404, { ok: false, error: 'not found' })
	}, { requireCaspar: false })
	routes.post('/api/shader-live/push', ({ body, ctx }) => handlePush(body, ctx), { requireCaspar: true })
	routes.post('/api/shader-live/mixer', ({ body, ctx }) => handleMixer(body, ctx), { requireCaspar: true })
	routes.post('/api/shader-live/shaders/*', ({ path, body, ctx }) => {
		const m = String(path).match(/^\/api\/shader-live\/shaders\/([^/]+)\/([a-z-]+)$/)
		return m ? handleOp(decodeURIComponent(m[1]).toLowerCase(), m[2], body, ctx) : reply(404, { ok: false, error: 'not found' })
	}, { requireCaspar: true })
}

module.exports = { register, handlePush, MIXER_CMDS }
