'use strict'

/**
 * routes-operator-screen.js — WO-599 T4: server half of the native Godot "Make this the operator
 * screen" picker (the WO-290 python picker re-done in the client). The client shows one prompt per
 * screen and posts the clicked output's name here. The choice itself is WO-290's
 * applyOperatorMonitorChoice — the `screen_N_operator_monitor` flag plus the operator_gui cable in
 * the device graph — so the kiosk launcher, pointer confine, Godot window placement and the
 * Devices-tab cable all read one answer.
 *
 *   GET  /api/system/operator-screen            { outputs: [{ name, port, x, y, width, height, current, caspar }], port }
 *                                               caspar (WO-891): a Caspar screen consumer is planned on that output
 *   POST /api/system/operator-screen { name }   { ok, name, port } | 400 no name | 404 unknown output | 422 unmapped
 *   POST /api/system/operator-screen { prompt } true: the prompt is up — let the pointer leave the operator monitor;
 *                                               false: it closed with no pick — confine again
 *   GET  …  also carries `boot`: { pending, defaultName, timeoutS } — WO-638, ask once per machine boot
 *   POST …  { boot: 'prepare' }                 unstack mirrored outputs so every screen gets a prompt
 *   POST …  { boot: 'resolve', name?, how? }    the boot answer (no name → the default; how: now | timeout): operator flag +
 *                                               cable, destination cables onto the other lit jacks, then Caspar starts
 *
 * The pointer confine (WO-279) keeps the mouse on the operator monitor, so the prompts on the other screens could
 * never be clicked: it is released while the prompt is up (PROMPT_MAX_MS backstop if the client vanishes) and
 * re-synced afterwards — after a pick, to the NEW operator monitor.
 *
 * Unlike the boot picker this is an operator's explicit choice from the GUI, so the fresh-box gate
 * (evaluateMonitorPickerTrigger) does not apply — it is the same act as drawing the cable.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/** The client gives up after 60 s; this re-confines if it vanished with the prompt up. */
const PROMPT_MAX_MS = 75_000
let releasedTimer = null

function confineApi(deps) {
	if (deps.confine) return deps.confine
	const pc = require('../system/pointer-confine')
	return { isActive: pc.isPointerConfineActive, stop: pc.stopPointerConfine, sync: pc.syncOperatorPointerConfine }
}

/** Let the pointer out while the prompt is up; true when it was confined. */
function releaseConfine(ctx, deps) {
	const c = confineApi(deps)
	if (releasedTimer || !c.isActive()) return Boolean(releasedTimer)
	c.stop()
	releasedTimer = setTimeout(() => restoreConfine(ctx, deps), deps.promptMaxMs ?? PROMPT_MAX_MS)
	releasedTimer.unref?.()
	return true
}

/** Confine again (to whatever the config now says) — only if this route released it. */
function restoreConfine(ctx, deps) {
	if (!releasedTimer) return false
	clearTimeout(releasedTimer)
	releasedTimer = null
	confineApi(deps).sync(ctx?.config || {}, { log: ctx?.log })
	return true
}

/**
 * WO-891: outputs the layout plan puts a Caspar screen consumer on (PGM / PRV / multiview / pixel-mapping head). The
 * Godot client's second operator window never opens on one by default.
 * @param {object} config
 * @returns {Set<string>}
 */
function casparOutputNames(config) {
	const names = new Set()
	try {
		const plan = require('../utils/os-layout-calculator').calculateLayoutPositions(config)
		const rows = [plan?.screens, plan?.prv, plan?.multiview].flatMap((g) => Object.values(g || {}))
		for (const r of rows.concat(plan?.mappingGpuOutputs || [])) if (r?.sysId) names.add(String(r.sysId))
	} catch (_) {
		/* no plan → nothing is marked; the client still never picks its own screen */
	}
	return names
}

function reply(status, body) {
	return { status, headers: JSON_HEADERS, body: jsonBody(body) }
}

/**
 * @param {object} ctx
 * @param {{ listOutputs?: Function, resolveFlagPort?: Function }} [deps] injected offline
 */
function handleGet(ctx, deps = {}) {
	const picker = require('../system/operator-monitor-picker')
	const config = ctx?.config || {}
	const outputs = (deps.listOutputs || picker.listPickerOutputs)(config) || []
	const port = (deps.resolveFlagPort || require('../utils/operator-monitor-resolve').resolveFlagPort)(config)
	let boot
	try {
		boot = (deps.bootStatus || require('../system/boot-screen-assignment').bootStatus)(config)
	} catch (e) {
		boot = { pending: false, reason: `error: ${e?.message || e}` }
	}
	const caspar = (deps.casparOutputNames || casparOutputNames)(config)
	return reply(200, {
		outputs: outputs.map((o) => ({ ...o, current: port != null && o.port === port, caspar: caspar.has(o.name) })),
		port: port ?? null,
		boot,
	})
}

/** WO-638 boot steps. */
async function handleBoot(body, ctx, deps = {}) {
	const boot = deps.boot || require('../system/boot-screen-assignment')
	if (body.boot === 'prepare') {
		releaseConfine(ctx, deps)
		return reply(200, await boot.prepare(ctx))
	}
	if (body.boot === 'resolve') {
		const name = String(body?.name || '').trim() || null
		const r = await boot.resolve(ctx, { name, how: String(body?.how || '') })
		restoreConfine(ctx, deps)
		return reply(r.status || 200, r)
	}
	return reply(400, { error: "boot must be 'prepare' or 'resolve'" })
}

/**
 * @param {object} body { name }
 * @param {object} ctx
 * @param {{ listOutputs?: Function }} [deps]
 */
function handlePost(raw, ctx, deps = {}) {
	const body = parseBody(raw) || {}
	if (typeof body?.boot === 'string') return handleBoot(body, ctx, deps)
	const picker = require('../system/operator-monitor-picker')
	if (typeof body?.prompt === 'boolean' && !body?.name) {
		const confined = body.prompt ? releaseConfine(ctx, deps) : restoreConfine(ctx, deps)
		return reply(200, { ok: true, prompt: body.prompt, confineReleased: body.prompt ? confined : false })
	}
	const name = String(body?.name || '').trim()
	if (!name) return reply(400, { error: 'name (an output, e.g. DP-2) is required' })
	const config = ctx?.config || {}
	const outputs = (deps.listOutputs || picker.listPickerOutputs)(config) || []
	const hit = outputs.find((o) => o && o.name === name)
	if (!hit) return reply(404, { error: `no connected output ${name}`, outputs: outputs.map((o) => o.name) })
	if (hit.port == null) {
		return reply(422, { error: `${name} maps to no GPU port slot (1..${picker.MAX_OPERATOR_PORT})` })
	}
	const cm = ctx?.configManager
	const next = picker.applyOperatorMonitorChoice(cm?.get ? cm.get() : config, hit.port)
	if (cm?.save) cm.save(next)
	if (ctx?.config) {
		ctx.config.casparServer = next.casparServer
		if (next.deviceGraph) ctx.config.deviceGraph = next.deviceGraph
		for (let i = 1; i <= picker.MAX_OPERATOR_PORT; i++) delete ctx.config[`screen_${i}_operator_monitor`]
	}
	ctx?.log?.('info', `[Operator screen] ${name} → casparServer.screen_${hit.port}_operator_monitor (Godot picker)`)
	restoreConfine(ctx, deps)
	return reply(200, { ok: true, name, port: hit.port })
}

function register(routes) {
	routes.get('/api/system/operator-screen', ({ ctx }) => handleGet(ctx), { requireCaspar: false })
	routes.post('/api/system/operator-screen', ({ body, ctx }) => handlePost(body, ctx), { requireCaspar: false })
}

module.exports = { register, handleGet, handlePost, handleBoot, PROMPT_MAX_MS }
