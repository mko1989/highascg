'use strict'

/**
 * WO-906 — keep the installed X screen layout (`/etc/X11/xorg.conf.d/98-highascg-screens.conf`) in step with the
 * config: `casparServer.playout_x_screen` on + an operator head + a playout head → the generated two-screen conf;
 * otherwise no conf (one X screen). Runs at the start of every full Apply (full-config-apply.js); a change needs a nodm
 * restart, which the Apply then does (+ the Caspar restart it does anyway). The root helper validates and installs
 * (sudoers: scripts/runtime/install-xorg-screens-apply.sh); the previous file is kept as `.prev` by the helper.
 */

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const xs = require('./x-screens')

const execFileAsync = promisify(execFile)

/**
 * The conf the config asks for, or null (one X screen).
 * @param {object} config app config
 * @returns {{ conf: string | null, warning?: string, error?: string }}
 */
function wantedConf(config) {
	if (!xs.isPlayoutXScreen(config)) return { conf: null }
	const { calculateLayoutPositions } = require('./os-layout-calculator')
	const { resolveSysIdToXrandrOutput } = require('./xrandr-output-resolve')
	const { getGpuConnectorInventory } = require('./hardware-info')
	const inventory = getGpuConnectorInventory()
	const split = xs.splitScreens(calculateLayoutPositions(config), (id) => resolveSysIdToXrandrOutput(id, { inventory, config }) || id)
	if (!split.operator.heads.length || !split.playout.heads.length) {
		return { conf: null, warning: 'playout X screen on, but the layout has no operator GUI head or no playout head — one X screen' }
	}
	const busId = xs.nvidiaBusId()
	if (!busId) return { conf: null, error: 'playout X screen: no NVIDIA GPU found (nvidia driver BusID)' }
	return { conf: xs.buildXorgScreensConf(split, { busId }) }
}

/**
 * @param {object} ctx { config }
 * @param {{ log?: (level: string, msg: string) => void, run?: typeof execFileAsync }} [opts] run: tests
 * @returns {Promise<{ ok: boolean, changed: boolean, on?: boolean, error?: string }>}
 */
async function syncPlayoutXScreens(ctx, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const run = opts.run || execFileAsync
	if (require('../bootstrap/sandbox').isSandbox()) return { ok: true, changed: false }
	if (process.env.NODE_TEST_CONTEXT && !opts.run) return { ok: true, changed: false } // never the box's X from a test
	if (bootQuestion.open && !opts.bootAnswered) {
		log('info', '[X screens] boot question open — one X screen until it is answered')
		return { ok: true, changed: false }
	}
	const want = wantedConf(ctx.config)
	if (want.warning) log('warn', `[X screens] ${want.warning}`)
	if (want.error) return { ok: false, changed: false, error: want.error }
	let installed = null
	try {
		installed = fs.readFileSync(xs.confPath(), 'utf8')
	} catch {
		/* none = one X screen */
	}
	if (want.conf === installed || (!want.conf && installed == null)) return { ok: true, changed: false, on: !!want.conf }
	try {
		if (want.conf) {
			const staged = xs.stagedConfPath()
			fs.mkdirSync(path.dirname(staged), { recursive: true })
			fs.writeFileSync(staged, want.conf)
			await run('sudo', ['-n', xs.HELPER, 'install', staged], { timeout: 15_000 })
			log('info', `[X screens] two-screen layout installed (operator :0.0, playout ${xs.PLAYOUT_DISPLAY}) — nodm restart follows`)
		} else {
			await run('sudo', ['-n', xs.HELPER, 'off'], { timeout: 15_000 })
			log('info', '[X screens] two-screen layout removed (kept as .prev) — nodm restart follows')
		}
	} catch (e) {
		const msg = String(e?.stderr || e?.message || e).trim()
		return {
			ok: false,
			changed: false,
			error: `playout X screen: helper failed (${msg}) — once on the box: sudo bash ~/highascg/scripts/runtime/install-xorg-screens-apply.sh`,
		}
	}
	return { ok: true, changed: true, on: !!want.conf }
}

/**
 * The boot question (WO-638 / WO-645) must offer EVERY screen — a new show may put the operator anywhere — and the GUI
 * and the pointer cannot reach :0.1. So while it is open the box runs one X screen: `dropForBootQuestion` takes the
 * two-screen layout off (helper off + nodm restart) and `settleAfterBootAnswer` installs the split the answer implies.
 * `open` also keeps a full Apply during the question from installing it early.
 */
const bootQuestion = { open: false, dropping: null }

/** Restart nodm and wait for X (the full apply's Step 3/4). */
async function restartX(log) {
	if (!require('./os-config').restartDisplayManager()) {
		log('warn', '[X screens] nodm restart failed (passwordless sudo required)')
		return false
	}
	const stable = await require('./display-stable-wait').waitForDisplayStable({ log })
	if (!stable.ok) log('warn', `[X screens] display did not stabilize (${stable.reason || 'unknown'})`)
	// the 60 s xrandr cache still holds the old screens: the boot prompts were labelled from it (DP-0's said DP-6) and
	// the stacked-output spread never saw X's fresh overlap
	require('./hardware-info').invalidateXrandrCache()
	return true
}

/**
 * Boot question pending: two screens installed → one, before the prompts go up.
 * @param {{ log?: Function, run?: Function, restart?: (log: Function) => Promise<boolean> }} [opts] run / restart: tests
 * @returns {Promise<{ dropped: boolean, error?: string }>}
 */
function dropForBootQuestion(opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	if (require('../bootstrap/sandbox').isSandbox()) return Promise.resolve({ dropped: false })
	if (process.env.NODE_TEST_CONTEXT && !opts.run) return Promise.resolve({ dropped: false })
	if (xs.installedScreens().length < 2) return Promise.resolve({ dropped: false })
	const run = opts.run || execFileAsync
	bootQuestion.open = true
	bootQuestion.dropping = (async () => {
		try {
			await run('sudo', ['-n', xs.HELPER, 'off'], { timeout: 15_000 })
		} catch (e) {
			const error = String(e?.stderr || e?.message || e).trim()
			log('warn', `[X screens] boot question on two X screens — could not drop to one (${error}); :0.1 gets no prompt`)
			return { dropped: false, error }
		}
		log('info', '[X screens] boot question: playout X screen off until it is answered (every screen gets a prompt)')
		await (opts.restart || restartX)(log)
		return { dropped: true }
	})()
	return bootQuestion.dropping
}

/** The question is over (answered, or Caspar already runs): true when this boot dropped the two-screen layout. */
async function closeBootQuestion() {
	const r = bootQuestion.dropping ? await bootQuestion.dropping.catch(() => ({ dropped: false })) : { dropped: false }
	bootQuestion.open = false
	bootQuestion.dropping = null
	return r.dropped === true
}

/**
 * Boot question answered (the new cables are saved): install the split they imply, nodm restart when it changed.
 * @returns {Promise<{ ok: boolean, changed: boolean, on?: boolean, error?: string }>}
 */
async function settleAfterBootAnswer(ctx, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	await closeBootQuestion()
	const r = await syncPlayoutXScreens(ctx, { ...opts, bootAnswered: true })
	if (r.error) log('warn', `[X screens] ${r.error}`)
	if (r.changed) await (opts.restart || restartX)(log)
	return r
}

module.exports = { wantedConf, syncPlayoutXScreens, dropForBootQuestion, closeBootQuestion, settleAfterBootAnswer, bootQuestion }
