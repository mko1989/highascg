/**
 * Resolve paths for hardware GUI tools + detached spawn on :0 (WO-39).
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { checkNuclearPassword } = require('./routes-system-setup')
const { getXAuthority } = require('../utils/hardware-info')

/** @readonly */
const NVIDIA_SETTINGS_BINARIES = ['/usr/bin/nvidia-settings', '/usr/local/bin/nvidia-settings']

/**
 * @returns {string|null}
 */
function resolveNvidiaSettings() {
	for (const bin of NVIDIA_SETTINGS_BINARIES) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	try {
		const p =
			execFileSync('/usr/bin/command', ['-v', 'nvidia-settings'], {
				encoding: 'utf8',
				timeout: 2000,
			}).trim() || null
		return p || null
	} catch {
		return null
	}
}

/**
 * @returns {string|null}
 */
function resolveDesktopvideoSetup() {
	try {
		const p =
			execFileSync('/usr/bin/command', ['-v', 'desktopvideo_setup'], {
				encoding: 'utf8',
				timeout: 2000,
			}).trim() || null
		if (p) return p
	} catch {
		/* ignore */
	}
	for (const p of ['/usr/bin/desktopvideo_setup', '/usr/local/bin/desktopvideo_setup']) if (fs.existsSync(p)) return p
	return null
}

/**
 * Blackmagic Desktop Video GUI updater heuristic (bundle layout varies).
 * @returns {string|null}
 */
function resolveBmdUpdater() {
	const candidates = []
	for (const pkg of ['desktopvideo-gui', 'desktopvideo']) {
		let out = ''
		try {
			out = execFileSync('dpkg', ['-L', pkg], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
		} catch {
			continue
		}
		const lines = out.split('\n').map((s) => s.trim()).filter(Boolean)
		for (const line of lines) {
			if (!/^\/usr\/(s?bin)\//i.test(line)) continue
			try {
				const st = fs.statSync(line)
				if (!st.isFile() || !(st.mode & 0o111)) continue
			} catch {
				continue
			}
			const bn = path.basename(line).toLowerCase()
			const looksUpdater = bn.includes('updater') || bn.includes('installer')
			const looksBm = bn.includes('blackmagic') || bn.includes('desktopvideo')
			const looksFirmware = bn.includes('firmware')
			if ((looksBm && looksUpdater) || (looksFirmware && looksUpdater))
				candidates.push(line)
		}
	}
	return candidates.sort((a, b) => a.length - b.length)[0] || null
}

/**
 * @param {string} action
 */
function spawnGuiDetached(action) {
	const bin =
		action === 'nvidia-settings' ?
			resolveNvidiaSettings()
		: action === 'desktopvideo_setup' ?
			resolveDesktopvideoSetup()
		: action === 'desktop_video_updater' ?
			resolveBmdUpdater()
		:	null

	if (!bin || !fs.existsSync(bin))
		throw new Error(`Launcher not installed or not on PATH (${action}).`)

	const env = { ...process.env, DISPLAY: ':0', XAUTHORITY: getXAuthority() }

	const proc = spawn(bin, [], {
		env,
		detached: true,
		stdio: 'ignore',
	})
	proc.unref()
	return bin
}

/**
 * @param {string} body
 * @param {*} ctx
 */
async function handleGuiLaunchPost(body, ctx) {
	const pw = checkNuclearPassword(body, ctx)
	if (!pw.ok) return { status: pw.status || 403, headers: JSON_HEADERS, body: jsonBody({ error: pw.error }) }

	const b = parseBody(body)
	const action = String(b?.action ?? '').trim()
	const okActions = /** @type {const} */ (['nvidia-settings', 'desktopvideo_setup', 'desktop_video_updater'])
	if (!okActions.includes(/** @type {any} */ (action))) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `Unknown action: ${action}` }),
		}
	}
	try {
		const exe = spawnGuiDetached(action)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, action, exe }) }
	} catch (e) {
		const m = e instanceof Error ? e.message : String(e)
		return {
			status: 502,
			headers: JSON_HEADERS,
			body: jsonBody({ error: m }),
		}
	}
}

module.exports = {
	resolveNvidiaSettings,
	resolveDesktopvideoSetup,
	resolveBmdUpdater,
	spawnGuiDetached,
	handleGuiLaunchPost,
}
