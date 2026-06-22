'use strict'

const { applyX11Layout, restartDisplayManager } = require('./os-config')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { waitForDisplayStable } = require('./display-stable-wait')
const { applyOperatorDisplaySession } = require('./x-display-session')
const {
	finishCasparAfterApply,
	killStuckCasparMainProcess,
	waitForAmcpDisconnect,
} = require('./caspar-restart')
const { needsNodmRestartForLayout } = require('./xrandr-layout-verify')

/**
 * Full server apply (normal path — no Caspar kill):
 *   1. Write casparcg.config
 *   2. Persist apply-layout.sh
 *   3. Apply live xrandr when canvas fits (no nodm)
 *   4. AMCP RESTART — run.sh relaunches Caspar with the new config
 *
 * Canvas expansion path adds nodm restart, live xrandr after X settles,
 * then stop autostart Caspar (wrong layout window) before relaunch.
 *
 * @param {object} ctx
 * @param {{
 *   log?: (level: string, msg: string) => void,
 *   writeCasparConfig?: (ctx: object) => Promise<{ ok: boolean, status?: number, path?: string, error?: string, detail?: string, hint?: string }>,
 *   skipCasparRestart?: boolean,
 *   forceNodmRestart?: boolean,
 * }} [opts]
 */
async function applyFullServerConfig(ctx, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const writeCasparConfig = opts.writeCasparConfig
	if (typeof writeCasparConfig !== 'function') {
		throw new Error('writeCasparConfig hook required')
	}

	const out = {
		ok: true,
		step: 'done',
		caspar: null,
		layout: {
			persisted: false,
			preApplied: false,
			preXrandrCommand: null,
			postApplied: false,
			postXrandrCommand: null,
			needsNodmRestart: false,
			plannedCanvas: null,
			currentCanvas: null,
			canvasReason: null,
		},
		displayRestart: {
			nodmRestarted: false,
			displayStable: false,
			postLayoutApplied: false,
		},
		casparRestart: {
			attempted: false,
			restartSent: false,
			disconnected: false,
			reconnected: false,
		},
		message: '',
	}

	log('info', '[Full apply] Step 1 — writing casparcg.config')
	const writeResult = await writeCasparConfig(ctx)
	out.caspar = writeResult.ok ? { ok: true, path: writeResult.path } : writeResult
	if (!writeResult.ok) {
		return {
			...out,
			ok: false,
			step: 'caspar_write',
			caspar: writeResult,
			message: writeResult.error || 'Failed to write Caspar config',
		}
	}

	log('info', '[Full apply] Step 2 — persisting apply-layout.sh')
	const canvasCheck = needsNodmRestartForLayout(ctx.config)
	const needsNodm = opts.forceNodmRestart === true || canvasCheck.needed
	out.layout.needsNodmRestart = needsNodm
	out.layout.plannedCanvas = canvasCheck.plannedCanvas || null
	out.layout.currentCanvas = canvasCheck.currentCanvas || null
	out.layout.canvasReason = canvasCheck.reason || null

	if (needsNodm) {
		log(
			'info',
			`[Full apply] Desktop canvas expansion required (planned ${canvasCheck.plannedCanvas?.width}x${canvasCheck.plannedCanvas?.height} > current ${canvasCheck.currentCanvas?.width}x${canvasCheck.currentCanvas?.height}) — nodm restart will run`,
		)
	} else {
		log('info', '[Full apply] Planned layout fits current desktop canvas — skipping nodm restart')
	}

	const layoutRes = applyX11Layout(ctx.config, { live: false, persist: true })
	out.layout.persisted = !!layoutRes.persisted
	out.layout.preXrandrCommand = layoutRes.xrandrCommand || null

	if (!layoutRes.persisted && !layoutRes.xrandrCommand) {
		return {
			...out,
			ok: false,
			step: 'layout_persist',
			message: 'Config written but apply-layout.sh was not persisted.',
		}
	}

	if (needsNodm) {
		log('info', '[Full apply] Step 3 — restarting nodm for canvas expansion')
		out.displayRestart.nodmRestarted = restartDisplayManager()
		if (!out.displayRestart.nodmRestarted) {
			log('warn', '[Full apply] nodm restart failed (passwordless sudo required)')
		}

		log('info', '[Full apply] Step 4 — waiting for X, then applying live xrandr')
		const stable = await waitForDisplayStable({ log })
		out.displayRestart.displayStable = stable.ok
		if (!stable.ok) {
			log('warn', `[Full apply] Display did not stabilize (${stable.reason || 'unknown'}) — applying xrandr anyway`)
		}

		const postLayout = applyX11Layout(ctx.config, { live: true, persist: false })
		out.layout.postApplied = !!postLayout.applied
		out.layout.postXrandrCommand = postLayout.xrandrCommand || null
		out.displayRestart.postLayoutApplied = !!postLayout.applied

		await applyOperatorDisplaySession(ctx.config, {
			layout: calculateLayoutPositions(ctx.config),
			log,
		}).catch((e) => log('warn', `[Full apply] Operator display session: ${e?.message || e}`))

		log('info', '[Full apply] Step 5 — stopping autostart Caspar (wrong layout window)')
		await killStuckCasparMainProcess(ctx)
		await waitForAmcpDisconnect(ctx, 5_000)
	} else {
		log('info', '[Full apply] Step 3 — applying live xrandr layout')
		const liveLayout = applyX11Layout(ctx.config, { live: true, persist: false })
		out.layout.preApplied = !!liveLayout.applied
		out.layout.postApplied = !!liveLayout.applied
		out.layout.postXrandrCommand = liveLayout.xrandrCommand || null
		await applyOperatorDisplaySession(ctx.config, {
			layout: calculateLayoutPositions(ctx.config),
			log,
		}).catch((e) => log('warn', `[Full apply] Operator display session: ${e?.message || e}`))
	}

	if (opts.skipCasparRestart) {
		log('info', '[Full apply] skipCasparRestart=true — config and layout script saved only')
		out.message = needsNodm
			? out.layout.postApplied
				? 'Config written; nodm restarted; layout applied; Caspar restart skipped.'
				: 'Config written; nodm restarted; Caspar restart skipped.'
			: out.layout.postApplied
				? 'Config written; layout applied; Caspar restart skipped.'
				: layoutRes.persisted
					? 'Config written; apply-layout.sh saved; Caspar restart skipped.'
					: 'Config written; Caspar restart skipped.'
		return out
	}

	const casparStep = needsNodm ? 6 : 4
	log('info', `[Full apply] Step ${casparStep} — AMCP RESTART (reload Caspar config)`)
	if (ctx.amcp) {
		out.casparRestart.attempted = true
		try {
			const restartResult = await finishCasparAfterApply(ctx, {
				log,
				disconnectMs: 10_000,
				reconnectMs: 45_000,
			})
			Object.assign(out.casparRestart, restartResult)
		} catch (e) {
			return {
				...out,
				ok: false,
				step: 'caspar_restart',
				message: e instanceof Error ? e.message : String(e),
			}
		}
	} else {
		log('warn', '[Full apply] Caspar not connected — config and layout saved; restart Caspar manually')
	}

	if (needsNodm) {
		out.message = out.casparRestart.reconnected
			? 'Config written; nodm restarted; layout applied; Caspar restarted.'
			: out.layout.postApplied
				? 'Config written; nodm restarted; layout applied; Caspar restart pending.'
				: 'Config written; nodm restarted; post-layout xrandr failed — check apply-layout.sh.'
	} else {
		out.message = out.casparRestart.reconnected
			? 'Config written; layout applied; Caspar restarted.'
			: out.layout.postApplied
				? 'Config written; layout applied; Caspar restart pending.'
				: layoutRes.persisted
					? 'Config written; apply-layout.sh saved.'
					: 'Config written.'
	}
	return out
}

module.exports = { applyFullServerConfig }
