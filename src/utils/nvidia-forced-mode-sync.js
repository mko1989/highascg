'use strict'

/**
 * WO-1129 — Full Apply step: bring /etc/X11/highascg-edid (NVIDIA CustomEDID per connector) in line with the
 * operator's explicit custom OS modes. Installs/removes go through the root helper
 * (tools/runtime/highascg-apply-display-edid.sh → /usr/local/lib/highascg/, sudoers: 12-passwordless-sudo.sh); the
 * caller (full-config-apply.js) folds `restartNeeded` into its ONE nodm restart, since the driver reads CustomEDID only
 * when X starts. Non-NVIDIA boxes skip this entirely — the RandR newmode/addmode path in os-config-xrandr-apply.js
 * keeps working there.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFile } = require('child_process')
const { promisify } = require('util')
const {
	CONNECTOR_RE,
	isNvidiaProprietaryDriver,
	collectForcedModeHeads,
	planCustomEdidSync,
} = require('./nvidia-forced-mode-plan')

const execFileAsync = promisify(execFile)

const EDID_HELPER = '/usr/local/lib/highascg/highascg-apply-display-edid.sh'
const EDID_INSTALL_DIR = '/etc/X11/highascg-edid'

/** output|sha1 of EDIDs that already got an X restart in this node process (planCustomEdidSync `attempted`). */
const attempted = new Set()

/** @param {string} dir @returns {Map<string, Buffer>} */
function readInstalledEdids(dir) {
	const out = new Map()
	let names
	try {
		names = fs.readdirSync(dir)
	} catch {
		return out
	}
	for (const n of names) {
		const m = n.match(/^(.+)\.bin$/)
		if (!m || !CONNECTOR_RE.test(m[1])) continue
		try {
			out.set(m[1], fs.readFileSync(path.join(dir, n)))
		} catch {
			/* unreadable — treated as absent */
		}
	}
	return out
}

/**
 * `sudo -n <helper> …` with the EDID on stdin. Never throws.
 * @param {string[]} args
 * @param {Buffer | null} input
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function runEdidHelper(args, input) {
	return new Promise((resolve) => {
		let stderr = ''
		let child
		try {
			child = spawn('sudo', ['-n', EDID_HELPER, ...args], { stdio: ['pipe', 'ignore', 'pipe'] })
		} catch (e) {
			resolve({ ok: false, error: e.message })
			return
		}
		const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
		child.stderr.on('data', (d) => (stderr += d))
		child.on('error', (e) => {
			clearTimeout(timer)
			resolve({ ok: false, error: e.message })
		})
		child.on('close', (code) => {
			clearTimeout(timer)
			const msg = stderr.trim().split('\n').pop() || `exit ${code}`
			resolve(code === 0 ? { ok: true } : { ok: false, error: `sudo -n ${path.basename(EDID_HELPER)}: ${msg}` })
		})
		child.stdin.on('error', () => {})
		child.stdin.end(input || undefined)
	})
}

/** Blanking for a size the EDID has no DTD of: the output's CVT kind at the wanted rate, else CVT-RB@60 (clock is rescaled). */
function defaultFallbackTimings(config, head) {
	const { computeModelineForWxH } = require('./xrandr-custom-mode')
	const { readOsTimingSourceForOutput } = require('./modeline-timings')
	const kind = readOsTimingSourceForOutput(config, head.output)
	const a = { width: head.width, height: head.height }
	const plan = computeModelineForWxH({ ...a, refreshHz: head.refreshHz, timingKind: kind }) || computeModelineForWxH({ ...a, refreshHz: 60, timingKind: 'cvt_r' })
	return plan ? plan.timings : null
}

function defaultDeps(config) {
	const { getXAuthority, getGpuConnectorInventory } = require('./hardware-info')
	const { calculateLayoutPositions } = require('./os-layout-calculator')
	const { resolveSysIdToXrandrOutput } = require('./xrandr-output-resolve')
	return {
		isNvidia: () => isNvidiaProprietaryDriver(),
		layout: () => calculateLayoutPositions(config),
		resolver: () => {
			const inventory = getGpuConnectorInventory()
			return (sid) => resolveSysIdToXrandrOutput(sid, { inventory, config })
		},
		installDir: EDID_INSTALL_DIR,
		stageDir: path.join(os.homedir(), '.highascg', 'display-edid'),
		queryXrandr: async () => {
			const env = { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }
			return String((await execFileAsync('xrandr', ['--display', ':0', '--query'], { env, encoding: 'utf8' })).stdout || '')
		},
		liveEdid: (output) => {
			const { edidForXrandrOutput, invalidateGpuEdidCache } = require('./gpu-edid-probe')
			invalidateGpuEdidCache()
			const hex = String(edidForXrandrOutput(output).raw || '').replace(/[^0-9a-f]/gi, '')
			return hex.length >= 256 ? Buffer.from(hex, 'hex') : null
		},
		fallbackTimings: (head) => defaultFallbackTimings(config, head),
		runHelper: runEdidHelper,
	}
}

/**
 * @param {object} config
 * @param {{ log?: (level: string, msg: string) => void, deps?: object }} [opts] deps override defaultDeps (smokes)
 * @returns {Promise<{ skipped?: string, restartNeeded: boolean, messages: string[], warnings: string[],
 *   installed: string[], removed: string[] }>}
 */
async function syncForcedModeEdids(config, opts = {}) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const d = { ...defaultDeps(config), ...(opts.deps || {}) }
	const res = { restartNeeded: false, messages: [], warnings: [], installed: [], removed: [] }
	if (!d.isNvidia()) return { ...res, skipped: 'not_nvidia' }
	const installed = readInstalledEdids(d.installDir)
	let resolver = null
	const resolve = (sid) => (resolver || (resolver = d.resolver()))(sid)
	const heads = collectForcedModeHeads(config, d.layout(), resolve)
	if (heads.length === 0 && installed.size === 0) return { ...res, skipped: 'nothing' }

	let queryText = ''
	try {
		queryText = await d.queryXrandr()
	} catch (e) {
		log('warn', `[Forced mode] xrandr --query failed (${e?.message || e}) — treating every forced mode as unlisted`)
	}
	const origPath = (o) => path.join(d.stageDir, `${o}.orig.bin`)
	const plan = planCustomEdidSync({
		heads,
		installed,
		queryText,
		attempted,
		liveEdid: d.liveEdid,
		storedOrig: (o) => {
			try {
				return fs.readFileSync(origPath(o))
			} catch {
				return null
			}
		},
		fallbackTimings: d.fallbackTimings,
	})
	res.warnings.push(...plan.warnings)

	for (const it of plan.install) {
		try {
			fs.mkdirSync(d.stageDir, { recursive: true })
			fs.writeFileSync(origPath(it.output), it.orig)
		} catch (e) {
			log('warn', `[Forced mode] could not keep the original EDID of ${it.output}: ${e.message}`)
		}
		const r = await d.runHelper(['--install', it.output], it.edid)
		if (r.ok) {
			attempted.add(it.key)
			res.installed.push(it.output)
			res.messages.push(`${it.label} needs a display restart`)
		} else {
			res.warnings.push(`${it.output}: custom EDID not installed (${r.error})`)
		}
	}
	for (const output of plan.remove) {
		const r = await d.runHelper(['--remove', output], null)
		if (r.ok) {
			res.removed.push(output)
			res.messages.push(`${output}: forced mode removed — needs a display restart`)
			try {
				fs.rmSync(origPath(output), { force: true })
			} catch {
				/* stale copy is harmless */
			}
		} else {
			res.warnings.push(`${output}: custom EDID not removed (${r.error})`)
		}
	}
	for (const p of plan.pending) {
		attempted.add(p.key)
		res.messages.push(`${p.label} needs a display restart (custom EDID installed, not live yet)`)
	}
	res.restartNeeded = res.installed.length + res.removed.length + plan.pending.length > 0
	for (const m of res.messages) log('info', `[Forced mode] ${m}`)
	for (const w of res.warnings) log('warn', `[Forced mode] ${w}`)
	return res
}

module.exports = {
	EDID_HELPER,
	readInstalledEdids,
	syncForcedModeEdids,
}
