'use strict'

/**
 * WO-616 T7 — wires the trigger-zone engine into the running server (started by the tracking module): marker hub
 * in at 10 Hz (OpenFollow's default eval rate), `project.previs.tracking.zones` from the active project (at boot,
 * then on every project write via project-events), each transition's action (zone-actions.js) out.
 * The engine runs whether or not a client is open, like the follow engine.
 * WO-712 R1: with this server's `zones` duty off (src/cluster/server-duties.js, `deps.duties`) occupancy is still evaluated
 * and shown, and each transition is still logged in `recent`, but no action runs (detail says so).
 */

const { ZoneEngine } = require('./zone-engine')
const { parseAction, runAction } = require('./zone-actions')
const { onProjectChanged } = require('../engine/project-events')

const EVAL_MS = 100
const LOG_MAX = 20

function createZoneService(ctx, hub, deps = {}) {
	const log = typeof ctx?.log === 'function' ? ctx.log.bind(ctx) : () => {}
	const duties = deps.duties || require('../cluster/server-duties')
	const actionsOn = () => duties.has('zones')
	const recent = [] // newest first: { at, zone, kind, marker, count, action, ok, detail }
	let parsed = new Map() // zone id → { kind → parsed action }
	const engine = new ZoneEngine(({ zone, kind, marker, count, at }) => {
		const action = parsed.get(zone.id)?.[kind] || null
		const entry = { at, zone: zone.id, name: zone.name, kind, marker, count, action: zone.actions[kind] || '', ok: null, detail: '' }
		recent.unshift(entry)
		recent.length = Math.min(recent.length, LOG_MAX)
		if (!actionsOn()) {
			entry.detail = 'not run: zone actions are off for this server (its Devices settings)'
			return
		}
		const run = action?.type === 'presenter' ? runPresenter(marker, kind) : runAction(action, ctx, deps)
		Promise.resolve(run).then((r) => {
			entry.ok = r.ok
			entry.detail = r.detail
			log(r.ok ? 'info' : 'warn', `[zones] ${zone.name} ${kind} (marker ${marker}, ${count} inside) → ${r.detail}`)
		})
	})
	/** WO-675: zone action `presenter` → the crossing marker's presenter's own enter / exit actions, in order. */
	async function runPresenter(marker, kind) {
		const r = ctx?.presenters?.actionsFor(marker, kind)
		if (!r?.presenter) return { ok: true, detail: `no presenter on marker ${marker}` }
		const out = []
		let ok = true
		for (const a of r.actions) {
			const x = await runAction(a, ctx, deps)
			ok = ok && x.ok
			out.push(x.detail)
		}
		return { ok, detail: `${r.name}: ${out.join('; ') || 'no actions'}` }
	}
	let lastJson = ''
	const apply = (project) => {
		const slice = project?.previs?.tracking?.zones ?? null
		const json = JSON.stringify(slice)
		if (json === lastJson) return
		lastJson = json
		engine.reload(slice)
		parsed = new Map(engine.config.list.map((z) => [z.id, Object.fromEntries(Object.entries(z.actions).map(([k, v]) => [k, parseAction(v)]))]))
		log('info', `[zones] ${engine.config.list.length} zone(s), engine ${engine.config.enabled ? 'ON' : 'off'}`)
		for (const z of engine.config.list) {
			for (const [k, a] of Object.entries(parsed.get(z.id))) if (a?.type === 'invalid') log('warn', `[zones] ${z.name} ${k}: ${a.error}`)
		}
	}
	if (deps.project !== undefined) apply(deps.project)
	else {
		try {
			apply(require('../engine/project-scenes').loadFullProject())
		} catch (e) {
			log('warn', '[zones] initial project load: ' + (e?.message || e))
		}
	}
	const off = onProjectChanged(apply)
	const tick = () => engine.update(hub.list(hub.now()), hub.now())
	let timer = null
	if (deps.autostart !== false) {
		timer = setInterval(tick, EVAL_MS)
		if (typeof timer.unref === 'function') timer.unref()
	}
	return {
		engine,
		tick,
		/** WS `tracking:zones` / GET: occupancy only, so it changes only on a transition. */
		snapshot: () => ({ enabled: engine.config.enabled, ...(actionsOn() ? {} : { actions_off: true }), zones: engine.states() }),
		status: () => ({ enabled: engine.config.enabled, actions_off: !actionsOn(), eval_hz: Math.round(1000 / EVAL_MS), debounce_ms: engine.config.debounce_ms,
			hysteresis: engine.config.hysteresis, zones: engine.states(), recent }),
		stop() {
			off()
			if (timer) clearInterval(timer)
			timer = null
		},
	}
}

module.exports = { createZoneService, EVAL_MS }
