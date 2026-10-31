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

module.exports = { wantedConf, syncPlayoutXScreens }
