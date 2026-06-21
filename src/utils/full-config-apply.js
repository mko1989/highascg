'use strict'

const { applyX11Layout, restartDisplayManager } = require('./os-config')
const { waitForDisplayStable } = require('./display-stable-wait')
const { sendRestartAndWaitForCaspar } = require('./caspar-restart')
const { needsNodmRestartForLayout } = require('./xrandr-layout-verify')

/**
 * Full server apply:
 *   1. Write casparcg.config
 *   2. Persist ~/.config/highascg/apply-layout.sh
 *   3a. When planned canvas fits the live desktop: AMCP RESTART CasparCG (no nodm)
 *   3b. When planned canvas is larger than the live desktop: restart nodm, wait for X,
 *       apply live xrandr, then AMCP RESTART CasparCG
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

	log('info', '[Full apply] Step 1 — writing casparcg.config')
	const writeResult = await writeCasparConfig(ctx)
	if (!writeResult.ok) {
		return {
			ok: false,
			step: 'caspar_write',
			caspar: writeResult,
			message: writeResult.error || 'Failed to write Caspar config',
		}
	}

	const canvasCheck = needsNodmRestartForLayout(ctx.config)
	const needsNodm = opts.forceNodmRestart === true || canvasCheck.needed
	if (needsNodm) {
		log(
			'info',
			`[Full apply] Desktop canvas expansion required (planned ${canvasCheck.plannedCanvas?.width}x${canvasCheck.plannedCanvas?.height} > current ${canvasCheck.currentCanvas?.width}x${canvasCheck.currentCanvas?.height}) — nodm restart will run`,
		)
	} else {
		log('info', '[Full apply] Planned layout fits current desktop canvas — skipping nodm restart')
	}

	log('info', '[Full apply] Step 2 — persisting apply-layout.sh')
	const layoutRes = applyX11Layout(ctx.config, { live: false, persist: true })

	const out = {
		ok: true,
		step: 'done',
		caspar: { ok: true, path: writeResult.path },
		layout: {
			persisted: !!layoutRes.persisted,
			preApplied: false,
			preXrandrCommand: layoutRes.xrandrCommand || null,
			postApplied: false,
			postXrandrCommand: null,
			needsNodmRestart: needsNodm,
			plannedCanvas: canvasCheck.plannedCanvas || null,
			currentCanvas: canvasCheck.currentCanvas || null,
			canvasReason: canvasCheck.reason || null,
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

	if (!layoutRes.persisted && !layoutRes.xrandrCommand) {
		out.ok = false
		out.step = 'layout_persist'
		out.message = 'Config written but apply-layout.sh was not persisted.'
		return out
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
	}

	if (opts.skipCasparRestart) {
		log('info', '[Full apply] skipCasparRestart=true — config and layout script saved only')
		out.message = needsNodm
			? out.layout.postApplied
				? 'Config written; nodm restarted; layout applied; Caspar restart skipped.'
				: 'Config written; nodm restarted; Caspar restart skipped.'
			: layoutRes.persisted
				? 'Config written; apply-layout.sh saved; Caspar restart skipped.'
				: 'Config written; Caspar restart skipped.'
		return out
	}

	const casparStep = needsNodm ? 5 : 3
	log('info', `[Full apply] Step ${casparStep} — AMCP RESTART CasparCG`)
	if (ctx.amcp) {
		out.casparRestart.attempted = true
		try {
			const restartResult = await sendRestartAndWaitForCaspar(ctx, { log })
			Object.assign(out.casparRestart, restartResult)
		} catch (e) {
			out.ok = false
			out.step = 'caspar_restart'
			out.message = e instanceof Error ? e.message : String(e)
			return out
		}
	} else {
		log('warn', '[Full apply] Caspar not connected — config and layout script saved; restart Caspar manually')
	}

	if (needsNodm) {
		out.message = out.casparRestart.reconnected
			? 'Config written; nodm restarted; layout applied; Caspar restarted.'
			: out.layout.postApplied
				? 'Config written; nodm restarted; layout applied; Caspar restart pending.'
				: 'Config written; nodm restarted; post-layout xrandr failed — check apply-layout.sh.'
	} else {
		out.message = out.casparRestart.reconnected
			? 'Config written; apply-layout.sh saved; Caspar restarted.'
			: layoutRes.persisted
				? 'Config written; apply-layout.sh saved.'
				: 'Config written.'
	}
	return out
}

module.exports = { applyFullServerConfig }
