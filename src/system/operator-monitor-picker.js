'use strict'

/**
 * operator-monitor-picker.js — WO-290: opt-in "click the screen you want" operator-monitor picker
 * for a fresh / factory-reset box.
 *
 * WHY THIS IS GATED SO HARD: the picker paints an unmissable full-screen prompt on EVERY connected
 * output and swallows the next left click. On a configured, playing-out box that would cover
 * program and steal an operator click — so it must be impossible to reach by accident. Two
 * independent conditions must BOTH hold before a single window is mapped:
 *
 *   1. OPT-IN. Nothing here runs on an ordinary boot. The caller must say so explicitly
 *      (`explicit: true` from the CLI), or `HIGHASCG_OPERATOR_MONITOR_PICKER=1` must be in the
 *      environment, or `operatorTools.monitorPicker === true` must be in the config. There is
 *      deliberately NO call site in the boot path (see tools/runtime/run-operator-monitor-picker.js).
 *   2. UNCONFIGURED. `resolveOperatorMonitorRect()` — the SAME source of truth the kiosk launcher
 *      (src/system/operator-gui-launcher.js resolveKioskMonitorRect) and the pointer confinement
 *      (src/system/pointer-confine.js) share since WO-279 — must resolve to NOTHING, and the raw
 *      `screen_N_operator_monitor` flag must be unset, and no operator_gui destination may pin an
 *      explicit physicalPort. Any one of those means "someone already chose a monitor" → refuse.
 *
 * Both verdicts are logged (`formatTriggerLog`), so a surprise picker — or a picker that refused
 * when the owner expected it — is diagnosable straight from the journal.
 *
 * The prompt itself is tools/runtime/operator-monitor-picker.py (python-xlib, override-redirect
 * windows — same dependency and conventions as tools/runtime/operator-shape-overlay.py; no GUI
 * toolkit). Everything in THIS file that decides anything is pure and injectable, so
 * tools/smoke/smoke-wo290-operator-monitor-picker.test.js exercises it with no X server at all.
 */

const path = require('path')
const { spawn } = require('child_process')
const { REPO_ROOT } = require('../repo-paths')
const { resolveOperatorMonitorRect, pointerInRect } = require('../utils/x-display-session-layout')
const { resolveFlagPort } = require('../utils/operator-monitor-resolve')
const { displaySessionEnv } = require('../utils/x-display-session-runtime')

const PICKER_SCRIPT = path.join(REPO_ROOT, 'tools/runtime/operator-monitor-picker.py')
/** WO-290 §4 — abandon after this long with nothing clicked. */
const DEFAULT_TIMEOUT_MS = 120_000
/** Highest `screen_N_operator_monitor` index the resolver looks at (operator-monitor-resolve.js). */
const MAX_OPERATOR_PORT = 4

/**
 * PURE. Is the picker opted into at all? Never true by default.
 * @param {object} config
 * @param {{ explicit?: boolean, env?: object }} [opts]
 * @returns {{ optIn: boolean, via: string }}
 */
function resolvePickerOptIn(config, opts = {}) {
	if (opts.explicit === true) return { optIn: true, via: 'explicit_invocation' }
	const env = opts.env || process.env
	if (String(env?.HIGHASCG_OPERATOR_MONITOR_PICKER || '') === '1') return { optIn: true, via: 'env' }
	if (config?.operatorTools?.monitorPicker === true) return { optIn: true, via: 'config' }
	/* Owner (todos21.07.26): "for the gui monitor choice on a fresh boot. can we have a button
	 * appear on each screen with press this to run operator gui on this screen." So the fresh-boot
	 * call site (operator-gui-launcher, reason no_monitor_resolved) is opted in BY DEFAULT — the
	 * original WO-290 posture of no-boot-call-site is superseded by that explicit request. Every
	 * hard gate below this one still applies unchanged: configured boxes, pinned ports, resolvable
	 * rects and active playout all still refuse, so the prompt can only ever appear on a box where
	 * nobody has chosen a monitor and nothing is on air. `operatorTools.monitorPicker: false`
	 * remains the opt-out. */
	if (opts.freshBoot === true && config?.operatorTools?.monitorPicker !== false) {
		return { optIn: true, via: 'fresh_boot_default' }
	}
	return { optIn: false, via: 'none' }
}

/**
 * PURE (given injectable resolvers). THE trigger predicate — the whole risk surface of WO-290.
 *
 * Refusal reasons, in evaluation order:
 *   not_opted_in                  nobody asked for the picker (the ordinary-boot case)
 *   playout_active                caller says this box is on air
 *   operator_monitor_flag_set     screen_N_operator_monitor is already set
 *   operator_gui_destination_port an operator_gui destination pins an explicit physicalPort
 *   operator_monitor_configured   resolveOperatorMonitorRect() resolves a rect (the WO-279 SSOT)
 *
 * @param {object} config
 * @param {{ explicit?: boolean, env?: object, playoutActive?: boolean, layout?: object,
 *   resolveOperatorMonitorRect?: Function, resolveFlagPort?: Function }} [opts]
 * @returns {{ run: boolean, reason: string, optInVia: string, port?: number|null, rect?: object|null }}
 */
function evaluateMonitorPickerTrigger(config, opts = {}) {
	const { optIn, via } = resolvePickerOptIn(config, opts)
	if (!optIn) return { run: false, reason: 'not_opted_in', optInVia: via }
	if (opts.playoutActive === true) return { run: false, reason: 'playout_active', optInVia: via }

	const flagPort = (opts.resolveFlagPort || resolveFlagPort)(config)
	if (flagPort != null) return { run: false, reason: 'operator_monitor_flag_set', optInVia: via, port: flagPort }

	const pinned = findPinnedOperatorGuiPort(config)
	if (pinned != null) {
		return { run: false, reason: 'operator_gui_destination_port', optInVia: via, port: pinned }
	}

	let rect
	try {
		rect = (opts.resolveOperatorMonitorRect || resolveOperatorMonitorRect)(config, opts.layout) || null
	} catch (_) {
		// Hardware detection unavailable (headless/tests). An UNRESOLVABLE monitor is exactly the
		// "fresh box" case; the flag check above already covered "configured but unresolvable".
		rect = null
	}
	if (rect) return { run: false, reason: 'operator_monitor_configured', optInVia: via, rect }

	return { run: true, reason: 'operator_monitor_unconfigured', optInVia: via, rect: null }
}

/**
 * PURE. Explicit `physicalPort` on an operator_gui screen destination — the launcher honors it
 * before the resolver (operator-gui-launcher.js shouldAutoLaunchOperatorGui), so it counts as
 * "already configured" here too.
 * @param {object} config
 * @returns {number|null}
 */
function findPinnedOperatorGuiPort(config) {
	const dests = config?.screenDestinations?.destinations
	if (!Array.isArray(dests)) return null
	for (const d of dests) {
		if (!d || String(d.mode || '').toLowerCase() !== 'operator_gui') continue
		if (Number.isFinite(d.physicalPort)) return Number(d.physicalPort)
	}
	return null
}

/**
 * PURE. The one log line for the trigger decision — emitted in BOTH directions (WO-290 constraint).
 * @param {ReturnType<typeof evaluateMonitorPickerTrigger>} verdict
 * @returns {string}
 */
function formatTriggerLog(verdict) {
	const tail = verdict?.port != null ? ` (port ${verdict.port})` : ''
	if (verdict?.run) {
		return `[Operator monitor picker] RUN — ${verdict.reason} (opt-in: ${verdict.optInVia})`
	}
	return `[Operator monitor picker] SKIP — ${verdict?.reason || 'unknown'}${tail} (opt-in: ${verdict?.optInVia || 'none'})`
}

/**
 * PURE. `WxH` from an xrandr resolution string.
 * @param {string} res
 * @returns {{ width: number, height: number }|null}
 */
function parseResolution(res) {
	const m = String(res || '').match(/^(\d+)x(\d+)$/)
	if (!m) return null
	const width = parseInt(m[1], 10)
	const height = parseInt(m[2], 10)
	if (!(width > 0 && height > 0)) return null
	return { width, height }
}

/**
 * Connected outputs to prompt on, each already carrying the 1-based GPU port index the
 * `screen_N_operator_monitor` flag uses.
 *
 * WO-290 constraint "do not derive outputs a second, independent way": the port index comes from
 * `buildGpuPhysicalMap()` slotOrder+1 and `runtime.connected` — byte for byte the derivation
 * `resolveOperatorMonitorPort()` (src/utils/operator-monitor-resolve.js:104-112) uses to decide
 * which port IS the operator monitor. Only the on-screen geometry is read from the xrandr display
 * rows, and only via the same `getDisplayDetails()` those rows already come from.
 *
 * @param {object} config
 * @param {{ displays?: Array, connectors?: Array, gpuMap?: object }} [opts] injected offline
 * @returns {Array<{ name: string, port: number|null, x: number, y: number, width: number, height: number }>}
 */
function listPickerOutputs(config, opts = {}) {
	const { getDisplayDetails, getGpuConnectorInventory } = require('../utils/hardware-info')
	const { buildGpuPhysicalMap } = require('../utils/gpu-physical-map')

	const displays = Array.isArray(opts.displays) ? opts.displays : getDisplayDetails() || []
	const connectors = Array.isArray(opts.connectors) ? opts.connectors : getGpuConnectorInventory() || []
	const map = opts.gpuMap || buildGpuPhysicalMap({ config: config || {}, displays, connectors })

	/** xrandr name (as the map spells it) → 1-based flag port */
	const portByName = new Map()
	for (const entry of map?.ports || []) {
		if (!entry?.runtime?.connected) continue
		const slot = Number(entry.slotOrder)
		if (!Number.isFinite(slot) || slot < 0 || slot > MAX_OPERATOR_PORT - 1) continue
		const name = String(entry.runtime.xrandrName || '').trim()
		if (name) portByName.set(name, slot + 1)
	}

	const out = []
	for (const d of displays) {
		if (!d || d.connected === false) continue
		const name = String(d.xrandrName || d.name || '').trim()
		const dims = parseResolution(d.resolution)
		if (!name || !dims) continue
		out.push({
			name,
			port: portByName.has(name) ? portByName.get(name) : null,
			x: Number.isFinite(Number(d.x)) ? Number(d.x) : 0,
			y: Number.isFinite(Number(d.y)) ? Number(d.y) : 0,
			width: dims.width,
			height: dims.height,
		})
	}
	return out
}

/**
 * PURE. Which output holds the pointer? Uses the SAME half-open rect test the pointer confinement
 * uses (`pointerInRect`, src/utils/x-display-session-layout.js), so a click on the seam between two
 * outputs lands where confine would put it.
 * @param {Array<{name: string, x: number, y: number, width: number, height: number}>} outputs
 * @param {number} x root-relative pointer X
 * @param {number} y root-relative pointer Y
 * @returns {object|null}
 */
function outputAtPointer(outputs, x, y) {
	if (!Array.isArray(outputs)) return null
	if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null
	for (const o of outputs) {
		if (!o || !(o.width > 0) || !(o.height > 0)) continue
		if (pointerInRect(Number(x), Number(y), o)) return o
	}
	return null
}

/**
 * PURE. Single-output box → no prompt at all (WO-290 §4): there is nothing to choose between.
 * @param {Array} outputs
 * @returns {object|null}
 */
function singleOutputShortcut(outputs) {
	return Array.isArray(outputs) && outputs.length === 1 ? outputs[0] : null
}

/**
 * PURE. Turn whatever the prompt helper reported into a decision. Anything that is not an
 * unambiguous left click inside a known output abandons — never guess a monitor.
 * @param {object|null} result one parsed JSON line from operator-monitor-picker.py
 * @param {Array} outputs
 * @returns {{ action: 'select'|'timeout'|'abandon', reason: string, output?: object }}
 */
function interpretPickerResult(result, outputs) {
	if (!result || typeof result !== 'object') return { action: 'abandon', reason: 'no_result' }
	const action = String(result.action || '')
	if (action === 'timeout') return { action: 'timeout', reason: 'timeout' }
	if (action === 'abandon' || action === 'escape') return { action: 'abandon', reason: 'escape' }
	if (action !== 'select') return { action: 'abandon', reason: `unknown_action:${action || 'none'}` }

	const hit =
		outputAtPointer(outputs, result.rootX, result.rootY) ||
		(Array.isArray(outputs) ? outputs.find((o) => o && o.name === String(result.name || '')) : null)
	if (!hit) return { action: 'abandon', reason: 'pointer_outside_outputs' }
	return { action: 'select', reason: 'clicked', output: hit }
}

/**
 * PURE. The config patch the launcher reads back: `casparServer.screen_<port>_operator_monitor`.
 * Every other port's flag is cleared, at BOTH lookup levels — `readCasparSetting()` prefers
 * `casparServer.*` but falls back to the top level, and `resolveFlagPort()` returns the FIRST set
 * flag, so a stale top-level `screen_1_operator_monitor` would otherwise outrank the pick.
 * @param {object} config
 * @param {number} port 1-based GPU port index
 * @returns {object} a new config object (input untouched)
 */
function applyOperatorMonitorChoice(config, port) {
	const n = Number(port)
	if (!Number.isInteger(n) || n < 1 || n > MAX_OPERATOR_PORT) {
		throw new Error(`operator monitor port out of range: ${port}`)
	}
	const next = { ...(config || {}) }
	next.casparServer = { ...(next.casparServer || {}) }
	for (let i = 1; i <= MAX_OPERATOR_PORT; i++) {
		delete next[`screen_${i}_operator_monitor`]
		delete next.casparServer[`screen_${i}_operator_monitor`]
	}
	next.casparServer[`screen_${n}_operator_monitor`] = true
	return wireOperatorGuiGraphEdge(next, n)
}

/**
 * PURE. Owner (todos27.07.26): a picker choice must ALSO show as a cable in the devices tab.
 * Wires the operator_gui destination's input connector (`dst_in_<destId>`) to the picked GPU
 * jack (`gpu_p<port-1>` — flag port is 1-based, jack ids are slotOrder) in config.deviceGraph.
 * Any prior cable on either endpoint is replaced (one monitor, one jack — mirrors the physical
 * reality of the click). Never invents connectors: if either endpoint is missing from the graph
 * (fresh box before the boot hardware sync), the flag alone still drives the launcher and this
 * returns the config unchanged.
 * @param {object} config
 * @param {number} port 1-based GPU port index
 * @returns {object}
 */
function wireOperatorGuiGraphEdge(config, port) {
	const dests = config?.screenDestinations?.destinations
	const dest = Array.isArray(dests)
		? dests.find((d) => String(d?.mode || '').toLowerCase() === 'operator_gui')
		: null
	const graph = config?.deviceGraph
	if (!dest?.id || !graph || typeof graph !== 'object') return config
	const srcId = `dst_in_${dest.id}`
	const gpuId = `gpu_p${port - 1}`
	const connectors = Array.isArray(graph.connectors) ? graph.connectors : []
	const hasSrc = connectors.some((c) => String(c?.id || '') === srcId)
	const hasGpu = connectors.some((c) => String(c?.id || '') === gpuId)
	if (!hasSrc || !hasGpu) return config
	const edges = Array.isArray(graph.edges) ? graph.edges : []
	const nextEdges = edges.filter(
		(e) => String(e?.sourceId || '') !== srcId && String(e?.sinkId || '') !== gpuId,
	)
	nextEdges.push({ id: `e_${srcId}_${gpuId}`, sourceId: srcId, sinkId: gpuId })
	return { ...config, deviceGraph: { ...graph, edges: nextEdges } }
}

/**
 * Spawn the python prompt and resolve with its single JSON result line. Default implementation of
 * the `promptForOutput` dependency — replaced wholesale by the offline test.
 * @param {Array} outputs
 * @param {{ timeoutMs?: number, log?: Function }} [opts]
 * @returns {Promise<object|null>}
 */
function promptForOutputViaX(outputs, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
	return new Promise((resolve) => {
		let child
		try {
			child = spawn('python3', [PICKER_SCRIPT], {
				env: displaySessionEnv(),
				stdio: ['pipe', 'pipe', 'pipe'],
			})
		} catch (e) {
			log('warn', `[Operator monitor picker] spawn failed: ${e?.message || e}`)
			resolve(null)
			return
		}
		let stdout = ''
		let settled = false
		const finish = (value) => {
			if (settled) return
			settled = true
			clearTimeout(guard)
			try {
				child.kill('SIGTERM')
			} catch (_) {
				/* already gone */
			}
			resolve(value)
		}
		// Belt-and-braces: the helper enforces its own deadline, this covers a helper that wedges.
		const guard = setTimeout(() => finish({ action: 'timeout' }), timeoutMs + 15_000)
		child.stdout.on('data', (c) => {
			stdout += String(c)
			const nl = stdout.indexOf('\n')
			if (nl < 0) return
			const line = stdout.slice(0, nl).trim()
			try {
				finish(JSON.parse(line))
			} catch (_e) {
				log('warn', `[Operator monitor picker] unparsable result line: ${line.slice(0, 200)}`)
				finish(null)
			}
		})
		child.stderr.on('data', (c) => {
			const t = String(c).trim()
			if (t) log('info', `[Operator monitor picker helper] ${t}`)
		})
		child.on('error', (e) => {
			log('warn', `[Operator monitor picker] helper error: ${e?.message || e}`)
			finish(null)
		})
		child.on('exit', () => finish(null))
		try {
			child.stdin.write(`${JSON.stringify({ outputs, timeoutMs })}\n`)
			child.stdin.end()
		} catch (e) {
			log('warn', `[Operator monitor picker] could not feed helper: ${e?.message || e}`)
			finish(null)
		}
	})
}

/**
 * Full picker run: gate, enumerate, prompt (or shortcut), persist, tear down.
 *
 * Every abandon path (`not opted in`, refused by the gate, no outputs, Esc, timeout, unmapped
 * port) returns without ever calling `persist`, so the system is left exactly as it was.
 *
 * @param {{ config: object, log?: Function, persist?: (cfg: object) => boolean,
 *   explicit?: boolean, env?: object, playoutActive?: boolean, timeoutMs?: number,
 *   listOutputs?: Function, promptForOutput?: Function }} ctx
 * @returns {Promise<{ ok: boolean, action: string, reason: string, output?: string, port?: number }>}
 */
async function runOperatorMonitorPicker(ctx = {}) {
	const log = typeof ctx.log === 'function' ? ctx.log : () => {}
	const config = ctx.config || {}

	const verdict = evaluateMonitorPickerTrigger(config, ctx)
	log(verdict.run ? 'info' : 'info', formatTriggerLog(verdict))
	if (!verdict.run) return { ok: false, action: 'skipped', reason: verdict.reason }

	const outputs = (ctx.listOutputs || listPickerOutputs)(config, ctx)
	if (!Array.isArray(outputs) || outputs.length === 0) {
		log('warn', '[Operator monitor picker] no connected outputs — nothing to pick, exiting')
		return { ok: false, action: 'skipped', reason: 'no_connected_outputs' }
	}

	let chosen = singleOutputShortcut(outputs)
	let how = 'single_output'
	if (chosen) {
		log('info', `[Operator monitor picker] single output ${chosen.name} — selected without prompting`)
	} else {
		const timeoutMs = Number.isFinite(ctx.timeoutMs) ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS
		log('info', `[Operator monitor picker] prompting on ${outputs.length} outputs (${outputs.map((o) => o.name).join(', ')}), timeout ${Math.round(timeoutMs / 1000)}s`)
		const raw = await (ctx.promptForOutput || promptForOutputViaX)(outputs, { timeoutMs, log })
		const outcome = interpretPickerResult(raw, outputs)
		if (outcome.action !== 'select') {
			log('info', `[Operator monitor picker] abandoned — ${outcome.reason}; nothing changed`)
			return { ok: false, action: outcome.action, reason: outcome.reason }
		}
		chosen = outcome.output
		how = 'clicked'
	}

	if (chosen.port == null) {
		log('warn', `[Operator monitor picker] ${chosen.name} maps to no GPU port slot (1..${MAX_OPERATOR_PORT}) — nothing changed`)
		return { ok: false, action: 'failed', reason: 'unmapped_port' }
	}

	const next = applyOperatorMonitorChoice(config, chosen.port)
	const persist = typeof ctx.persist === 'function' ? ctx.persist : null
	if (!persist) {
		log('warn', '[Operator monitor picker] no persist hook — choice NOT saved')
		return { ok: false, action: 'failed', reason: 'no_persist_hook' }
	}
	if (!persist(next)) {
		log('error', '[Operator monitor picker] saving the choice failed — nothing changed')
		return { ok: false, action: 'failed', reason: 'persist_failed' }
	}
	log('info', `[Operator monitor picker] operator monitor = ${chosen.name} → casparServer.screen_${chosen.port}_operator_monitor = true (${how})`)
	return { ok: true, action: 'selected', reason: how, output: chosen.name, port: chosen.port }
}

module.exports = {
	DEFAULT_TIMEOUT_MS,
	MAX_OPERATOR_PORT,
	PICKER_SCRIPT,
	resolvePickerOptIn,
	evaluateMonitorPickerTrigger,
	findPinnedOperatorGuiPort,
	formatTriggerLog,
	parseResolution,
	listPickerOutputs,
	outputAtPointer,
	singleOutputShortcut,
	interpretPickerResult,
	applyOperatorMonitorChoice,
	promptForOutputViaX,
	runOperatorMonitorPicker,
}
