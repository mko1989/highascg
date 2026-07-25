/**
 * Resolve binary paths for hardware GUI tools (WO-39).
 */

'use strict'

const { lookupCommandPath } = require('../utils/which')

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

/** Prefer .deb Firefox (eggs ISO); snap is legacy fallback only. @readonly */
const FIREFOX_BINARIES = ['/usr/bin/firefox-esr', '/usr/bin/firefox', '/snap/bin/firefox']

/** Dedicated :0 launcher (isolated profile; installed by 05-caspar-deps). @readonly */
const OPERATOR_FIREFOX_LAUNCHER = [
	'/usr/local/lib/highascg/highascg-launch-operator-firefox.sh',
	path.join(__dirname, '../../tools/runtime/highascg-launch-operator-firefox.sh'),
]
const FILE_MANAGER_BINARIES = [
	['/usr/bin/thunar', 'thunar'],
	['/usr/bin/pcmanfm', 'pcmanfm'],
	['/usr/bin/nautilus', 'nautilus'],
	['/usr/bin/dolphin', 'dolphin'],
]

/** @readonly */
const NVIDIA_SETTINGS_BINARIES = ['/usr/bin/nvidia-settings', '/usr/local/bin/nvidia-settings']

/**
 * @returns {string|null}
 */
function resolveOperatorFirefoxLauncher() {
	for (const launcher of OPERATOR_FIREFOX_LAUNCHER) {
		try {
			if (fs.existsSync(launcher)) return launcher
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @returns {string|null}
 */
function resolveFirefox() {
	for (const bin of FIREFOX_BINARIES) {
		try {
			if (fs.existsSync(bin)) return bin
		} catch {
			/* ignore */
		}
	}
	for (const name of ['firefox-esr', 'firefox']) {
		try {
			const p =
				lookupCommandPath(name)
			if (p && !p.startsWith('/snap/')) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

/**
 * @returns {{ bin: string, name: string } | null}
 */
function resolveFileManager() {
	for (const [bin, name] of FILE_MANAGER_BINARIES) {
		try {
			if (fs.existsSync(bin)) return { bin, name }
		} catch {
			/* ignore */
		}
	}
	for (const name of ['thunar', 'pcmanfm', 'nautilus', 'dolphin']) {
		try {
			const p =
				lookupCommandPath(name)
			if (p) return { bin: p, name }
		} catch {
			/* ignore */
		}
	}
	return null
}

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
			lookupCommandPath('nvidia-settings')
		return p || null
	} catch {
		return null
	}
}

/**
 * @returns {string|null}
 */
function resolveDesktopvideoSetup() {
	for (const name of ['desktopvideo_setup', 'BlackmagicDesktopVideoSetup']) {
		try {
			const p =
				lookupCommandPath(name)
			if (p) return p
		} catch {
			/* ignore */
		}
	}
	for (const p of [
		'/usr/bin/BlackmagicDesktopVideoSetup',
		'/usr/bin/desktopvideo_setup',
		'/usr/local/bin/desktopvideo_setup',
	]) {
		if (fs.existsSync(p)) return p
	}
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

module.exports = {
	resolveOperatorFirefoxLauncher,
	resolveFirefox,
	resolveFileManager,
	resolveNvidiaSettings,
	resolveDesktopvideoSetup,
	resolveBmdUpdater,
}
