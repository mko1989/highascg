'use strict'

/**
 * WO-1084 (3) — screens plugged in or pulled while Caspar runs. The run.sh gate (tools/runtime/gate-screen-consumers.js)
 * decides once per launch; this keeps that decision true afterwards, without a Caspar restart:
 *   - a screen comes up   → its destination's windows open (`ADD ch-idx XML <base64>` of the very block the file holds,
 *                            WO-1020) and are placed (WO-483); a head that came up without a mode is laid out first;
 *   - a screen goes away  → the windows that now land on nothing (or on the operator's screen) close (`REMOVE ch-idx`);
 *   - the file's marks follow, so the next launch and the Devices view say the same thing.
 * The rule is the same pure decision (src/config/screen-connector-gate.js) against the same seam
 * (src/utils/connector-state.js), so the harness drives it with injected connector states and a fake AMCP.
 *
 * Change detection is the cheap DRM sysfs status (no X round trip), debounced: a NovaStar P80 re-handshakes for about
 * a second on every modeset and during Caspar restarts (memory: novastar-edid-drives-dp0) — a status must hold
 * SETTLE_MS before it counts, and only a settled state that differs from the last reconciled one does anything. Our
 * own X layout apply is rate-limited (LAYOUT_COOLDOWN_MS) so a re-handshake it causes can never loop into another.
 *
 * Off: `HIGHASCG_SCREEN_HOTPLUG=0`, headless, offline mode, sandbox. `operatorTools.screenHotplug === false` = only
 * offer (log + Devices badge; the windows change at the next Apply).
 */

const fs = require('fs')
const path = require('path')
const { gateScreenConsumers, restoreOfflineScreens, walkScreens } = require('../config/screen-connector-gate')
const { enforceScreenConsumerPolicy } = require('../config/screen-consumer-policy')

const POLL_MS = Math.max(500, parseInt(process.env.HIGHASCG_SCREEN_HOTPLUG_POLL_MS || '2000', 10) || 2000)
const SETTLE_MS = Math.max(0, parseInt(process.env.HIGHASCG_SCREEN_HOTPLUG_SETTLE_MS || '6000', 10) || 6000)
const LAYOUT_COOLDOWN_MS = 30_000

/**
 * PURE. Debounce DRM status snapshots: step(statuses, now) → true when a settled state differs from the last one
 * acted on. The first snapshot is the baseline (what the launch gate already decided on).
 */
function createHotplugTracker({ settleMs = SETTLE_MS } = {}) {
	let baseline = null
	let seen = null
	let since = 0
	const key = (m) => JSON.stringify([...(m instanceof Map ? m : new Map(Object.entries(m || {})))].sort())
	return {
		step(statuses, now) {
			const k = key(statuses)
			if (baseline == null) {
				baseline = seen = k
				return false
			}
			if (k !== seen) {
				seen = k
				since = now
				return false
			}
			if (k === baseline || now - since < settleMs) return false
			baseline = k
			return true
		},
		rebase(statuses) {
			baseline = seen = key(statuses)
		},
	}
}

/** PURE. INFO <ch> XML → the indices of its running `<screen>` consumers. */
function runningScreenPorts(infoXml) {
	const out = new Set()
	for (const m of String(infoXml || '').matchAll(/<port_(\d+)>([\s\S]*?)<\/port_\1>/g)) {
		if (/<consumer>\s*screen\s*<\/consumer>/.test(m[2]) || /<type>\s*screen/.test(m[2])) out.add(Number(m[1]))
	}
	return out
}

/**
 * PURE. What to send so the running windows match the decision. Only `<screen>` consumers the file holds are touched
 * (runtime consumers — stream, record, shm, meter-null — are never in `running` for a screen index).
 * @param {{ started: Array, offline: Array }} gated gateScreenConsumers() result
 * @param {Map<number, Set<number>>} running channel → running screen ports
 */
function planScreenActions(gated, running) {
	const add = []
	const remove = []
	for (const w of gated.started) {
		if (!running.has(w.channel) || running.get(w.channel).has(w.port)) continue
		add.push({ channel: w.channel, port: w.port, line: `ADD ${w.channel}-${w.port} XML ${Buffer.from(w.block, 'utf8').toString('base64')}` })
	}
	for (const w of gated.offline) {
		if (running.get(w.channel)?.has(w.port)) remove.push({ channel: w.channel, port: w.port, reason: w.reason, line: `REMOVE ${w.channel}-${w.port}` })
	}
	return { add, remove }
}

function defaultDeps(ctx) {
	const cs = require('../utils/connector-state')
	return {
		readHeads: cs.readHeads,
		readOperatorNames: () => cs.readOperatorNames(),
		syncOperator: () => require('./operator-output-file').syncOperatorOutputFile(ctx),
		configPath: () => require('../api/routes-caspar-config').resolveCasparConfigWritePath(ctx),
		readFile: (p) => fs.readFileSync(p, 'utf8'),
		writeFile: (p, s) => {
			const tmp = path.join(path.dirname(p), `.${path.basename(p)}.hotplug-${process.pid}.tmp`)
			fs.writeFileSync(tmp, s, 'utf8')
			fs.renameSync(tmp, p)
		},
		info: async (ch) => require('../caspar/channel-info-xml').infoResponseToXml(await ctx.amcp.raw(`INFO ${ch}`)),
		send: (line) => ctx.amcp.raw(line),
		applyLayout: () => require('../utils/os-config-xrandr-apply').applyX11Layout(ctx.config, { live: true, persist: true }),
		place: () => require('./screen-consumer-placement').placeScreenConsumers({ config: ctx.config, log: (l, m) => ctx.log?.(l, m) }),
		status: (xml, heads) => require('./screen-output-status').liveScreenOutputStatus(ctx, { xml, heads }),
		now: () => Date.now(),
	}
}

/**
 * One reconcile: heads → (layout a connected head that has no mode) → operator file → gate the file → ADD / REMOVE.
 * @returns {Promise<{ skipped?: string, laidOut?: boolean, added: number[][], removed: number[][], offline: number, lines: string[] }>}
 */
async function reconcileScreens(ctx, injected = {}) {
	const deps = { ...defaultDeps(ctx), ...injected }
	const log = (lvl, msg) => ctx?.log?.(lvl, msg)
	const res = { added: [], removed: [], offline: 0, lines: [], laidOut: false }
	let heads = deps.readHeads()
	if (!Array.isArray(heads)) return { ...res, skipped: 'display state unknown' }
	const auto = ctx?.config?.operatorTools?.screenHotplug !== false
	const modeless = heads.filter((h) => h.connected && !h.active).map((h) => h.name)
	if (auto && modeless.length && deps.now() - (ctx._screenHotplugLayoutAt || 0) > LAYOUT_COOLDOWN_MS) {
		ctx._screenHotplugLayoutAt = deps.now()
		log('info', `[Screen hot-plug] ${modeless.join(', ')} connected without a picture — laying out the screens`)
		try {
			await deps.applyLayout()
			res.laidOut = true
			heads = deps.readHeads() || heads
		} catch (e) {
			log('warn', `[Screen hot-plug] layout: ${e?.message || e}`)
		}
	}
	deps.syncOperator()
	const file = deps.configPath()
	const disk = deps.readFile(file)
	const base = enforceScreenConsumerPolicy(restoreOfflineScreens(disk)).xml
	const gated = gateScreenConsumers(base, { heads, operatorNames: deps.readOperatorNames() })
	res.offline = gated.offline.length
	const channels = new Set()
	walkScreens(base, { includeMarked: false }, (s) => channels.add(s.channel))
	const running = new Map()
	for (const ch of channels) {
		try {
			running.set(ch, runningScreenPorts(await deps.info(ch)))
		} catch {
			/* channel not there (a hole) — leave it alone */
		}
	}
	const plan = planScreenActions(gated, running)
	if (gated.xml !== disk) deps.writeFile(file, gated.xml)
	const status = deps.status(gated.xml, heads)
	const label = (ch) => Object.values(status?.destinations || {}).find((d) => (d.offline || []).includes(ch) || d.channels?.includes(ch))?.label
	if (!auto) {
		if (plan.add.length || plan.remove.length) log('info', `[Screen hot-plug] screens changed — ${plan.add.length} window(s) to open, ${plan.remove.length} to close at the next Apply (automatic hot-plug is off)`)
		return res
	}
	for (const a of plan.remove) {
		await deps.send(a.line).then(() => res.removed.push([a.channel, a.port]), (e) => log('warn', `[Screen hot-plug] ${a.line}: ${e?.message || e}`))
		res.lines.push(`ch${a.channel}${label(a.channel) ? ` (${label(a.channel)})` : ''}: ${a.reason.replace(/^ch\d+ /, '')} — stopped`)
	}
	for (const a of plan.add) {
		await deps.send(a.line).then(() => res.added.push([a.channel, a.port]), (e) => log('warn', `[Screen hot-plug] ADD ${a.channel}-${a.port}: ${e?.message || e}`))
	}
	if (res.added.length) {
		ctx._screenHotplugStarted = [...new Set([...(ctx._screenHotplugStarted || []), ...res.added.map(([c]) => c)])]
		res.lines.push(`started ${res.added.map(([c, p]) => `ch${c}-${p}`).join(', ')} — its screen came up`)
		try {
			await deps.place()
		} catch (e) {
			log('debug', `[Screen hot-plug] placement: ${e?.message || e}`)
		}
	}
	for (const l of res.lines) log('info', `[Screen hot-plug] ${l}`)
	for (const l of require('./screen-output-status').offlineLogLines(status)) log('info', `[Screen gate] ${l}`)
	return res
}

/** Always-on watcher (cheap: one sysfs read per poll). Returns a stop function. */
function startScreenHotplugWatch(ctx, injected = {}) {
	const off = String(process.env.HIGHASCG_SCREEN_HOTPLUG || '').trim() === '0'
	if (process.env.NODE_TEST_CONTEXT && !injected.readDrm) return () => {} // a smoke never drives the box's Caspar
	if (off || ctx?.config?.offline_mode || /^(1|true|yes)$/i.test(String(process.env.HIGHASCG_HEADLESS || ''))) return () => {}
	try {
		if (require('../bootstrap/sandbox').isSandbox()) return () => {}
	} catch {
		/* optional */
	}
	const readDrm = injected.readDrm || require('../utils/connector-state').readDrmStatuses
	const tracker = createHotplugTracker()
	let busy = false
	const ready = () => {
		if (ctx._fullApplyInProgress || !ctx.amcp || ctx._casparStatus?.connected === false) return false
		try {
			const b = require('./boot-screen-assignment')
			return b.gateOpen(b.bootId())
		} catch {
			return true
		}
	}
	const tick = async () => {
		if (busy) return
		const statuses = readDrm()
		if (!tracker.step(statuses, Date.now())) return
		if (!ready()) {
			tracker.rebase(new Map()) // try again once Caspar / the boot answer is there
			return
		}
		busy = true
		try {
			try {
				require('../utils/hardware-info').invalidateXrandrCache()
			} catch {
				/* optional */
			}
			await reconcileScreens(ctx, injected)
			tracker.rebase(readDrm())
			// the Devices "running differs" check reads the gate's decisions (config-compare.js screenGateChannels)
			await require('../config/config-compare').refreshConfigComparison(ctx).catch(() => {})
			if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('gpu_topology_changed', { at: Date.now(), reason: 'screen_hotplug' })
		} catch (e) {
			ctx.log?.('warn', `[Screen hot-plug] ${e?.message || e}`)
		} finally {
			busy = false
		}
	}
	ctx.log?.('info', `[Screen hot-plug] watching ${readDrm().size} connector(s) (settle ${SETTLE_MS} ms)`)
	const timer = setInterval(() => void tick(), POLL_MS)
	if (typeof timer.unref === 'function') timer.unref()
	return () => clearInterval(timer)
}

module.exports = { createHotplugTracker, runningScreenPorts, planScreenActions, reconcileScreens, startScreenHotplugWatch }
