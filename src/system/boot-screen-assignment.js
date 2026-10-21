'use strict'

/**
 * boot-screen-assignment.js — WO-638: on every boot with more than one screen, the operator picks
 * which screen is the operator's (owner 21.10: "a popup choose this monitor as operator for 120s on
 * each screen"); every other connected screen becomes a destination.
 *
 * The saved choice (`screen_N_operator_monitor` + the device-graph cables) is positional: a GPU jack.
 * Plug the monitors into other jacks and the cables point at dark ports — the layout planner then puts
 * PGM and the operator on the same first connected output, X leaves the rest mirrored at 0,0 and the
 * OS watchdog gives up after 12 tries (box, 21.10 19:04). So once per machine boot:
 *
 *   1. prepare  — outputs stacked on each other (X's default for unplanned heads) are laid out left to
 *                 right in slot order, so each screen can show its own prompt.
 *   2. resolve  — the clicked output, or on timeout the default (the saved operator jack if it is lit,
 *                 else the first lit jack no destination keeps), becomes the operator (WO-290's
 *                 applyOperatorMonitorChoice: flag + cable). Destination cables on dark jacks or on the
 *                 operator's jack move to the free lit jacks in slot order; cables on lit jacks stay.
 *   3. apply    — X is always laid out per the plan before the answer returns (the prepare spread need not match
 *                 it); casparcg.config is written while Caspar is held, a running Caspar gets the full apply only
 *                 when something moved.
 *
 * Caspar waits for the answer (owner 21.10: the prompts must not sit under the always-on-top screen
 * consumers): run.sh holds the FIRST launch of a boot until the marker below carries this boot's id
 * (CASPAR_SCREEN_GATE_SEC backstop). Node writes the marker as soon as nothing needs asking, or after
 * the choice is in casparcg.config + the xrandr layout — so Caspar's first start already uses the new
 * layout. If Caspar is already up (gate disabled or timed out), a change runs the normal full apply
 * (Caspar restart) instead. With no client answering, node settles on the default after
 * SERVER_FALLBACK_S.
 *
 * Done is recorded against the kernel boot id, so a node or client restart never asks again; a box
 * with one screen never asks. `operatorTools.bootScreenPicker: false` turns it off.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const persistence = require('../utils/persistence')

const STATE_KEY = 'bootScreenAssignment'
const TIMEOUT_S = 120
/** Why the default was taken (the client says; logged and stored with the choice). */
const HOW_DEFAULT = { now: 'default_now', timeout: 'timeout', server: 'server_fallback' }
/** No client answered (Godot not running): node takes the default itself. Below run.sh's 240 s gate. */
const SERVER_FALLBACK_S = 200
/** run.sh reads the same path (CASPAR_SCREEN_GATE_FILE); its content is the kernel boot id. */
const GATE_FILE =
	process.env.CASPAR_SCREEN_GATE_FILE || path.join(os.homedir(), '.highascg', 'run', 'caspar-screens-ready')

function bootId() {
	return require('../bootstrap/startup-led-test-pattern').getMachineBootIdentity()
}

/** The raw kernel boot id run.sh compares against (getMachineBootIdentity prefixes `linux:`). */
function rawBootId(id) {
	return String(id || '').replace(/^linux:/, '')
}

function gateOpen(id, file = GATE_FILE) {
	try {
		return fs.readFileSync(file, 'utf8').trim() === rawBootId(id)
	} catch (_) {
		return false
	}
}

/** Let run.sh start Caspar for this boot. */
function openGate(id, log, file = GATE_FILE) {
	if (!id || gateOpen(id, file)) return false
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, `${rawBootId(id)}\n`)
		log?.('info', `[Boot screens] Caspar start released (${file})`)
		return true
	} catch (e) {
		log?.(
			'warn',
			`[Boot screens] could not write ${file}: ${e?.message || e} — run.sh starts Caspar after its own timeout`
		)
		return false
	}
}

/** PURE. The kernel boot this choice was made in, from the stored record. */
function isDoneForBoot(record, id) {
	return Boolean(id) && record?.bootId === id
}

/**
 * PURE. Lit GPU jacks in slot order: [{ id: 'gpu_p0', name: 'DP-0', port: 1 }].
 * @param {{ ports?: Array }} gpuMap buildGpuPhysicalMap() result
 */
function litPorts(gpuMap) {
	return (gpuMap?.ports || [])
		.filter((p) => p?.runtime?.connected && p?.runtime?.xrandrName)
		.map((p) => ({ id: String(p.physicalPortId), name: String(p.runtime.xrandrName), port: Number(p.slotOrder) + 1 }))
		.sort((a, b) => a.port - b.port)
}

function operatorSourceId(config) {
	const dests = config?.screenDestinations?.destinations
	const op = Array.isArray(dests) ? dests.find((d) => String(d?.mode || '').toLowerCase() === 'operator_gui') : null
	return op?.id ? `dst_in_${op.id}` : null
}

function gpuIds(config) {
	return new Set(
		(config?.deviceGraph?.connectors || [])
			.filter((c) => String(c?.kind || '') === 'gpu_out' || /^gpu_p\d+$/.test(String(c?.id || '')))
			.map((c) => String(c.id))
	)
}

/**
 * PURE. Where the destination cables go once `opId` is the operator's jack. Cables are grouped by the
 * jack they land on (PGM + PRV on one jack move together); a group on a lit jack that is not the
 * operator's stays, the rest take the free lit jacks in slot order. A group with no free jack left
 * stays where it is (reported as unplaced).
 * @returns {{ edges: Array, moves: Array<{ from: string, to: string }>, unplaced: string[] }}
 */
function planDestinationCables(config, lit, opId) {
	const edges = Array.isArray(config?.deviceGraph?.edges) ? config.deviceGraph.edges : []
	const gpus = gpuIds(config)
	const opSrc = operatorSourceId(config)
	const litIds = lit.map((p) => p.id)
	const groups = new Map()
	for (const e of edges) {
		const sink = String(e?.sinkId || '')
		if (!gpus.has(sink) || String(e?.sourceId || '') === opSrc) continue
		if (!groups.has(sink)) groups.set(sink, [])
		groups.get(sink).push(e)
	}
	const taken = new Set([opId])
	const keep = []
	const move = []
	for (const sink of groups.keys()) {
		if (litIds.includes(sink) && sink !== opId && !taken.has(sink)) {
			taken.add(sink)
			keep.push(sink)
		} else move.push(sink)
	}
	const target = new Map()
	const moves = []
	const unplaced = []
	for (const sink of move) {
		const free = litIds.find((id) => !taken.has(id))
		if (!free) {
			unplaced.push(sink)
			continue
		}
		taken.add(free)
		target.set(sink, free)
		moves.push({ from: sink, to: free })
	}
	const next = edges.map((e) => {
		const to = String(e?.sourceId || '') !== opSrc ? target.get(String(e?.sinkId || '')) : null
		return to ? { ...e, id: `e_${e.sourceId}_${to}`, sinkId: to } : e
	})
	return { edges: next, moves, unplaced }
}

/**
 * PURE. The output a timeout settles on: the saved operator jack when it is lit, else the first lit
 * jack that no destination cable keeps, else the first lit jack.
 */
function defaultOperator(config, lit, flagPort) {
	const saved = lit.find((p) => p.port === flagPort)
	if (saved) return saved
	const opSrc = operatorSourceId(config)
	const used = new Set(
		(config?.deviceGraph?.edges || [])
			.filter((e) => String(e?.sourceId || '') !== opSrc)
			.map((e) => String(e?.sinkId || ''))
	)
	return lit.find((p) => !used.has(p.id)) || lit[0] || null
}

/** PURE. The cables as source→sink pairs (a re-drawn cable gets a new edge id but is the same cable). */
function cableSet(config) {
	return (config?.deviceGraph?.edges || [])
		.map((e) => `${e?.sourceId}>${e?.sinkId}`)
		.sort()
		.join('|')
}

/** PURE. Do any two outputs cover the same pixels? (X puts heads nobody planned at 0,0.) */
function outputsOverlap(outputs) {
	const r = outputs.filter((o) => o?.width > 0 && o?.height > 0)
	for (let i = 0; i < r.length; i++) {
		for (let j = i + 1; j < r.length; j++) {
			const a = r[i]
			const b = r[j]
			if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) return true
		}
	}
	return false
}

/** PURE. xrandr args laying the outputs out left to right, in the given order, at their preferred modes. */
function spreadArgs(names) {
	const args = []
	names.forEach((n, i) => {
		args.push('--output', n, '--auto')
		if (i === 0) args.push('--pos', '0x0', '--primary')
		else args.push('--right-of', names[i - 1])
	})
	return args
}

function liveDeps(deps) {
	const picker = require('./operator-monitor-picker')
	return {
		bootId: deps.bootId || bootId,
		store: deps.store || persistence,
		listOutputs: deps.listOutputs || picker.listPickerOutputs,
		gpuMap:
			deps.gpuMap ||
			((config) => {
				const { getDisplayDetails, getGpuConnectorInventory } = require('../utils/hardware-info')
				const { buildGpuPhysicalMap } = require('../utils/gpu-physical-map')
				return buildGpuPhysicalMap({
					config,
					displays: getDisplayDetails() || [],
					connectors: getGpuConnectorInventory() || [],
				})
			}),
		flagPort: deps.flagPort || require('../utils/operator-monitor-resolve').resolveFlagPort,
		xrandr: deps.xrandr || runXrandr,
		gateOpen: deps.gateOpen || gateOpen,
		/** xrandr / DRM reads are cached (TTL): after the spread, the canvas check and the jack map must see the new layout. */
		invalidate: deps.invalidate || (() => require('../utils/hardware-info').invalidateXrandrCache()),
		openGate: deps.openGate || openGate,
		/** Caspar is up: the normal full apply (write, layout, restart). */
		apply:
			deps.apply ||
			((ctx) => require('../api/routes-caspar-config').applyCasparConfigToDiskAndRestart(ctx, { force: true })),
		/** Caspar is held at the gate: write its config and lay out X, nothing to restart. */
		prestart:
			deps.prestart ||
			(async (ctx) => {
				const w = await require('../api/routes-caspar-config').writeCasparConfigToDisk(ctx)
				if (!w.ok) throw new Error(w.error || 'casparcg.config write failed')
				await require('../utils/os-config-xrandr-apply').applyX11Layout(ctx.config, { live: true, persist: true })
				return { status: 200 }
			}),
		/** Caspar is up: lay X out per the (new) plan; its consumers move with the full apply when cables changed. */
		relayout:
			deps.relayout ||
			((ctx) => require('../utils/os-config-xrandr-apply').applyX11Layout(ctx.config, { live: true, persist: true })),
	}
}

function runXrandr(args) {
	const { displaySessionEnv } = require('../utils/x-display-session-runtime')
	return new Promise((resolve) => {
		execFile('xrandr', args, { env: displaySessionEnv(), timeout: 15_000 }, (err, _out, stderr) =>
			resolve(err ? { ok: false, error: String(stderr || err.message).trim() } : { ok: true })
		)
	})
}

/**
 * `boot` block of GET /api/system/operator-screen.
 * @returns {{ pending: boolean, reason: string, timeoutS: number, defaultName?: string }}
 */
function bootStatus(config, deps = {}) {
	const d = liveDeps(deps)
	const base = { pending: false, timeoutS: TIMEOUT_S }
	if (config?.operatorTools?.bootScreenPicker === false) return { ...base, reason: 'off' }
	const id = d.bootId()
	if (!id) return { ...base, reason: 'no_boot_id' }
	if (isDoneForBoot(d.store.get(STATE_KEY), id)) return { ...base, reason: 'done_this_boot' }
	const lit = litPorts(d.gpuMap(config))
	if (lit.length < 2) return { ...base, reason: lit.length ? 'single_screen' : 'no_screens' }
	const def = defaultOperator(config, lit, d.flagPort(config))
	return { ...base, pending: true, reason: 'ask', defaultName: def?.name || null }
}

/** Step 1: unstack the outputs so every screen can carry a prompt. */
async function prepare(ctx, deps = {}) {
	const d = liveDeps(deps)
	const config = ctx?.config || {}
	const outputs = d.listOutputs(config) || []
	if (!outputsOverlap(outputs)) return { ok: true, spread: false }
	const names = [...outputs]
		.sort((a, b) => (a.port ?? 99) - (b.port ?? 99) || a.name.localeCompare(b.name))
		.map((o) => o.name)
	const r = await d.xrandr(spreadArgs(names))
	if (r.ok) d.invalidate()
	ctx?.log?.(
		r.ok ? 'info' : 'warn',
		`[Boot screens] stacked outputs ${r.ok ? 'laid out' : 'could not be laid out'} left to right: ${names.join(', ')}${r.ok ? '' : ` — ${r.error}`}`
	)
	return { ok: r.ok, spread: r.ok, order: names, ...(r.ok ? {} : { error: r.error }) }
}

/**
 * Step 2 + 3. `name` = the clicked output; none = timeout → the default.
 * @returns {Promise<{ ok: boolean, status: number, name?: string, port?: number, how?: string, moves?: Array, unplaced?: string[], applying?: boolean, error?: string }>}
 */
async function resolve(ctx, pick, deps = {}) {
	const d = liveDeps(deps)
	const name = pick && typeof pick === 'object' ? pick.name || null : pick
	d.invalidate()
	const cm = ctx?.configManager
	const config = cm?.get ? cm.get() : ctx?.config || {}
	const id = d.bootId()
	const rec = d.store.get(STATE_KEY)
	if (isDoneForBoot(rec, id))
		return { ok: true, status: 200, name: rec.name, port: rec.port, how: rec.how, already: true }
	const lit = litPorts(d.gpuMap(config))
	const flagPort = d.flagPort(config)
	const how = name ? 'clicked' : HOW_DEFAULT[pick?.how] || 'timeout'
	const op = name ? lit.find((p) => p.name === name) : defaultOperator(config, lit, flagPort)
	if (!op)
		return { ok: false, status: name ? 404 : 409, error: name ? `${name} is not a lit GPU jack` : 'no lit GPU jack' }

	const picker = require('./operator-monitor-picker')
	let next = picker.applyOperatorMonitorChoice(config, op.port)
	// Planned on the ORIGINAL cables: applyOperatorMonitorChoice drops any cable on the picked jack ("one monitor, one
	// jack"), which would delete the PGM cable sitting there instead of moving it (box 21.10 19:32).
	const plan = planDestinationCables(config, lit, op.id)
	const opSrc = operatorSourceId(config)
	if (next.deviceGraph) {
		const opEdges = (next.deviceGraph.edges || []).filter((e) => String(e?.sourceId || '') === opSrc)
		const rest = plan.edges.filter((e) => String(e?.sourceId || '') !== opSrc)
		next = { ...next, deviceGraph: { ...next.deviceGraph, edges: [...rest, ...opEdges] } }
	}
	const changed = flagPort !== op.port || cableSet(config) !== cableSet(next)

	if (changed) {
		if (cm?.save) cm.save(next)
		if (ctx?.config) {
			ctx.config.casparServer = next.casparServer
			if (next.deviceGraph) ctx.config.deviceGraph = next.deviceGraph
			for (let i = 1; i <= picker.MAX_OPERATOR_PORT; i++) delete ctx.config[`screen_${i}_operator_monitor`]
		}
	}
	d.store.set(STATE_KEY, { bootId: id, name: op.name, port: op.port, how, at: new Date().toISOString() })
	const moved = plan.moves.map((m) => `${m.from}→${m.to}`).join(', ') || 'none'
	ctx?.log?.(
		'info',
		`[Boot screens] operator = ${op.name} (port ${op.port}, ${how}); destination cables moved: ${moved}${plan.unplaced.length ? `; no free screen for ${plan.unplaced.join(', ')}` : ''}${changed ? ' — applying' : ' — nothing changed'}`
	)
	// Held = run.sh is still waiting: no gate for this boot AND no Caspar on AMCP (it may have started on its own backstop).
	const held = !d.gateOpen(id) && ctx?._casparStatus?.connected !== true
	const log = (level, msg) => ctx?.log?.(level, msg)
	// X is laid out per the plan BEFORE the answer goes back (the client then moves onto the operator screen by name)
	// and before Caspar is released — even when nothing moved, the spread in prepare() may not match the plan.
	try {
		await (held ? d.prestart(ctx) : d.relayout(ctx))
		log('info', `[Boot screens] ${held ? 'config + layout written before Caspar starts' : 'layout applied'}`)
	} catch (e) {
		log('warn', `[Boot screens] ${held ? 'pre-start write' : 'layout'} failed: ${e?.message || e}`)
	}
	d.openGate(id, log)
	if (changed && !held) {
		// Caspar is already up with the old cables: the full apply moves its screen consumers (restart).
		Promise.resolve()
			.then(() => d.apply(ctx))
			.then((r) => log(r?.status === 200 ? 'info' : 'warn', `[Boot screens] apply finished (HTTP ${r?.status})`))
			.catch((e) => log('warn', `[Boot screens] apply failed: ${e?.message || e}`))
	}
	return {
		ok: true,
		status: 200,
		name: op.name,
		port: op.port,
		how,
		moves: plan.moves,
		unplaced: plan.unplaced,
		applying: changed && !held,
		casparHeld: held,
	}
}

/**
 * Node start-up: release Caspar at once when nothing needs asking; otherwise wait for the client and
 * settle on the default after SERVER_FALLBACK_S if none answers.
 * @returns {{ pending: boolean, reason: string }}
 */
function startBootScreenGate(ctx, deps = {}) {
	const d = liveDeps(deps)
	const log = (level, msg) => ctx?.log?.(level, msg)
	let st
	try {
		st = bootStatus(ctx?.config || {}, deps)
	} catch (e) {
		st = { pending: false, reason: `error: ${e?.message || e}` }
	}
	log(
		'info',
		`[Boot screens] ${st.pending ? `asking on every screen (default ${st.defaultName}, ${TIMEOUT_S} s); Caspar held until then` : `no question (${st.reason})`}`
	)
	if (!st.pending) {
		d.openGate(d.bootId(), log)
		return st
	}
	const t = setTimeout(
		() => {
			if (!bootStatus(ctx?.config || {}, deps).pending) return
			log('warn', `[Boot screens] no client answered in ${SERVER_FALLBACK_S} s — taking the default`)
			resolve(ctx, { how: 'server' }, deps).catch((e) => log('warn', `[Boot screens] fallback failed: ${e?.message || e}`))
		},
		(deps.fallbackS ?? SERVER_FALLBACK_S) * 1000
	)
	t.unref?.()
	return st
}

module.exports = {
	STATE_KEY,
	TIMEOUT_S,
	SERVER_FALLBACK_S,
	GATE_FILE,
	gateOpen,
	openGate,
	startBootScreenGate,
	litPorts,
	planDestinationCables,
	defaultOperator,
	outputsOverlap,
	spreadArgs,
	bootStatus,
	prepare,
	resolve,
}
