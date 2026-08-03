'use strict'

const { applyX11Layout, restartDisplayManager } = require('./os-config')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { waitForDisplayStable } = require('./display-stable-wait')
const { applyOperatorDisplaySession, displaySessionEnv } = require('./x-display-session')
const { applyNvidiaDisplayPolicy } = require('./nvidia-display-policy')
const {
	reloadCasparAfterConfigWrite,
	killStuckCasparMainProcess,
	waitForAmcpDisconnect,
} = require('./caspar-restart')
const { needsNodmRestartForLayout, verifyXrandrMatchesLayout } = require('./xrandr-layout-verify')

/**
 * Full server apply:
 *   1. Write casparcg.config
 *   2. Persist apply-layout.sh
 *   3. Apply live xrandr when canvas fits (no nodm)
 *   4. Brief AMCP RESTART, then fast-kill if still up — run.sh relaunches with new config
 *   5. NVIDIA Force Composition Pipeline on all outputs (after restart — xrandr/Caspar clear MetaMode)
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

	// WO-412: cabling the operator GUI to a port IS the "Operator monitor" choice — persist
	// the implied flags into the APP config so the runtime display session (primary head,
	// kiosk placement, pointer confine) and the Device-View tick agree with the cable, not
	// just the generated XML (applyPhysicalPortConsumerFlagsToScreens covers that side).
	try {
		const { deriveOperatorGuiAppConfigPortFlags } = require('../config/screen-consumer-port-resolve')
		const { patch, guiPort } = deriveOperatorGuiAppConfigPortFlags(ctx.config)
		if (guiPort) {
			const cs = ctx.config.casparServer || (ctx.config.casparServer = {})
			let changed = false
			for (const [k, v] of Object.entries(patch)) {
				if (cs[k] !== v) {
					cs[k] = v
					changed = true
				}
			}
			if (changed) {
				log('info', `[Full apply] operator-GUI cable → port ${guiPort}: operator_monitor + stacking flags persisted (WO-412)`)
				if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), casparServer: cs })
			}
		}
	} catch (e) {
		log('warn', `[Full apply] operator-GUI implied port flags: ${e?.message || e}`)
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
		nvidiaDisplay: {
			applied: false,
			ok: false,
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

	// A degenerate canvas check returns needed:false, so the apply proceeds with NO nodm restart.
	// That silent skip is how the 2026-07-21 regression stayed invisible — say so out loud.
	// `no_live_canvas` is always an anomaly (X is up, yet its Screen line is unreadable).
	// `no_planned_heads` is only an anomaly when the config actually defines GPU heads; a
	// genuinely headless config hits it every apply and must not warn (there is already an info
	// line for that case below).
	if (canvasCheck.warn && canvasCheck.reason === 'no_live_canvas') {
		log(
			'warn',
			`[Full apply] Live desktop canvas unreadable — cannot tell whether the planned ${canvasCheck.plannedCanvas?.width}x${canvasCheck.plannedCanvas?.height} layout needs a nodm restart; continuing WITHOUT one`,
		)
	}

	if (needsNodm) {
		log(
			'info',
			`[Full apply] Desktop canvas expansion required (planned ${canvasCheck.plannedCanvas?.width}x${canvasCheck.plannedCanvas?.height} > current ${canvasCheck.currentCanvas?.width}x${canvasCheck.currentCanvas?.height}) — nodm restart will run`,
		)
	} else {
		log(
			'info',
			`[Full apply] Planned layout fits current desktop canvas (planned ${canvasCheck.plannedCanvas?.width}x${canvasCheck.plannedCanvas?.height}, current ${canvasCheck.currentCanvas?.width}x${canvasCheck.currentCanvas?.height}) — skipping nodm restart`,
		)
	}

	/* WO-337 #5: nothing to do — the on-disk XML already matches the generated config, no canvas
	 * change is needed, and the live xrandr layout verifies. Skip the restart entirely (~18s →
	 * <1s for the "did I already apply?" click). The config-editor one-shot XML path and an
	 * explicit body {force:true} bypass this gate. */
	if (writeResult.changed === false && !needsNodm && opts.force !== true) {
		const verify = (() => {
			try {
				return verifyXrandrMatchesLayout(calculateLayoutPositions(ctx.config))
			} catch (e) {
				log('warn', `[Full apply] unchanged-gate xrandr verify failed (${e?.message || e}) — proceeding with full apply`)
				return null
			}
		})()
		if (verify?.ok) {
			out.step = 'no_changes'
			out.message = 'No config changes — Caspar left running (config and display layout already match).'
			log('info', '[Full apply] Config unchanged + layout verified — skipping Caspar restart (WO-337 gate)')
			return out
		}
	}

	const layoutRes = await applyX11Layout(ctx.config, { live: false, persist: true })
	out.layout.persisted = !!layoutRes.persisted
	out.layout.preXrandrCommand = layoutRes.xrandrCommand || null

	const layoutScriptRequired =
		canvasCheck.reason !== 'no_planned_heads' && !!layoutRes.xrandrCommand
	if (layoutScriptRequired && !layoutRes.persisted) {
		log('warn', '[Full apply] Planned GPU layout exists but apply-layout.sh was not persisted')
		return {
			...out,
			ok: false,
			step: 'layout_persist',
			message: 'Config written but apply-layout.sh was not persisted.',
		}
	}
	if (canvasCheck.reason === 'no_planned_heads') {
		log(
			'info',
			'[Full apply] No GPU screen heads in plan — skipping apply-layout.sh; continuing with Caspar restart',
		)
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

		const postLayout = await applyX11Layout(ctx.config, { live: true, persist: false, skipOperatorSession: true })
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
		const liveLayout = await applyX11Layout(ctx.config, { live: true, persist: false, skipOperatorSession: true })
		out.layout.preApplied = !!liveLayout.applied
		out.layout.postApplied = !!liveLayout.applied
		out.layout.postXrandrCommand = liveLayout.xrandrCommand || null
		await applyOperatorDisplaySession(ctx.config, {
			layout: calculateLayoutPositions(ctx.config),
			log,
		}).catch((e) => log('warn', `[Full apply] Operator display session: ${e?.message || e}`))
	}

	// WO-407: refresh the machine-owned caspar-env (GL swaps gate on the PGM display's
	// vblank) so the value tracks layout changes — run.sh sources it at every launch.
	try {
		const { writeCasparGlSyncEnvFile } = require('./caspar-gl-sync-env')
		writeCasparGlSyncEnvFile({ config: ctx.config, log })
	} catch (e) {
		log('warn', `[Full apply] caspar-env GL sync write failed: ${e?.message || e}`)
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
	log('info', `[Full apply] Step ${casparStep} — reload Caspar (RESTART + fast kill if hung)`)
	if (ctx.amcp) {
		out.casparRestart.attempted = true
		try {
			const restartResult = await reloadCasparAfterConfigWrite(ctx, {
				log,
				skipRestartCommand: needsNodm,
				acceptPortListening: true,
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

	if (out.layout.preApplied || out.layout.postApplied) {
		const nvidiaStep = needsNodm ? 7 : 5
		log('info', `[Full apply] Step ${nvidiaStep} — NVIDIA Force Composition Pipeline (deferred)`)
		out.nvidiaDisplay = { applied: true, ok: null, deferred: true }

		// Fire-and-forget: run the NVIDIA policy update without blocking HTTP response
		void (async () => {
			try {
				const env = displaySessionEnv()
				let nvidiaRes = await applyNvidiaDisplayPolicy(env, { log, timeoutMs: 30_000 })
				if (!nvidiaRes.ok) {
					log('info', '[Full apply] NVIDIA display policy retry in 6s (MetaMode may lag Caspar restart)')
					await new Promise((r) => setTimeout(r, 6000))
					nvidiaRes = await applyNvidiaDisplayPolicy(env, { log, timeoutMs: 30_000 })
				}
				if (nvidiaRes.ok) {
					log('info', '[Full apply] NVIDIA display policy applied (deferred)')
				} else {
					log('warn', `[Full apply] NVIDIA display policy failed: ${nvidiaRes.reason || 'unknown'}`)
				}
			} catch (e) {
				log('warn', `[Full apply] NVIDIA display policy (deferred): ${e?.message || e}`)
			}
		})().catch((e) => {
			log('error', `[Full apply] NVIDIA display policy promise rejected: ${e?.message || e}`)
		})
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
