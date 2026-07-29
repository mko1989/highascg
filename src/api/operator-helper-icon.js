'use strict'

/**
 * operator-helper-icon.js — WO-387: resolve the taskbar chip icon for a helper action.
 *
 * The five WO-283 tools keep the exact hard-coded paths todos27.07.26 added (they were verified
 * against what those packages actually ship on this box, and a theme lookup that regressed them
 * would silently degrade the chips to letters). Everything else comes from the .desktop entry's
 * `Icon=` key, resolved through the standard icon directories.
 *
 * PATH SAFETY: `Icon=` is a THEME NAME, not a path, in every entry that has one — so a bare name is
 * only ever used as a filename component and is rejected unless it is `[A-Za-z0-9._+-]+` with no
 * `..`. The spec does also allow an absolute path, which is accepted only when it sits under one of
 * the icon roots below. Nothing derived from the request reaches the filesystem un-validated: the
 * action selects a CATALOG ENTRY first, and the icon name comes from that entry, not from the query.
 */

const fs = require('fs')
const path = require('path')

/** todos27.07.26 hard-coded chips — exact package paths, first hit wins. @readonly */
const HELPER_ICON_CANDIDATES = {
	firefox: [
		'/usr/share/icons/hicolor/64x64/apps/firefox-esr.png',
		'/usr/share/icons/hicolor/128x128/apps/firefox-esr.png',
		'/usr/share/icons/hicolor/64x64/apps/firefox.png',
	],
	'file-manager': [
		'/usr/share/icons/hicolor/128x128/apps/org.xfce.thunar.png',
		'/usr/share/icons/hicolor/48x48/apps/org.xfce.thunar.png',
	],
	desktopvideo_setup: [
		'/usr/share/icons/hicolor/128x128/apps/BlackmagicDesktopVideoSetup.png',
		'/usr/share/icons/hicolor/48x48/apps/BlackmagicDesktopVideoSetup.png',
	],
	desktop_video_updater: [
		'/usr/share/icons/hicolor/128x128/apps/DesktopVideoUpdater.png',
		'/usr/share/icons/hicolor/48x48/apps/DesktopVideoUpdater.png',
	],
	'nvidia-settings': [
		'/usr/share/icons/hicolor/64x64/apps/nvidia-settings.png',
		'/usr/share/pixmaps/nvidia-settings.png',
	],
}

/** Icon theme roots, in search order. @readonly */
const ICON_ROOTS = [
	path.join(process.env.HOME || '/home/casparcg', '.local/share/icons'),
	'/usr/local/share/icons',
	'/usr/share/icons',
]

/** Themes to search inside each root — hicolor is the spec's fallback theme every package installs. @readonly */
const ICON_THEMES = ['hicolor', 'Adwaita', 'gnome']

/** Largest first: the chip is ~28px but a downscaled 128 looks better than an upscaled 32. @readonly */
const ICON_SIZES = ['256x256', '128x128', '96x96', '64x64', '48x48', 'scalable', '32x32', '24x24']

/** Only formats a browser renders. XPM is common on Debian (xterm, mc) and is deliberately NOT
 * here — an <img> pointing at one shows nothing, so a 404 and the client's letter fallback is the
 * honest answer. @readonly */
const ICON_EXTS = ['.png', '.svg']

/** Flat directories that predate the theme spec. @readonly */
const PIXMAP_DIRS = ['/usr/share/pixmaps', '/usr/local/share/pixmaps']

/**
 * PURE-ish (fs.existsSync only). Candidate files for a freedesktop icon name.
 * @param {string} icon the `Icon=` value
 * @returns {string[]} absolute paths, best first
 */
function iconCandidates(icon) {
	const name = String(icon || '').trim()
	if (!name) return []
	if (name.startsWith('/')) {
		// Absolute path form: allowed by the spec, but only inside the icon roots we already trust.
		const norm = path.normalize(name)
		const inRoot = [...ICON_ROOTS, ...PIXMAP_DIRS].some((r) => norm.startsWith(`${r}/`))
		return inRoot && ICON_EXTS.includes(path.extname(norm).toLowerCase()) ? [norm] : []
	}
	if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) || name.includes('..')) return []
	/** @type {string[]} */
	const out = []
	for (const root of ICON_ROOTS) {
		for (const theme of ICON_THEMES) {
			for (const size of ICON_SIZES) {
				for (const ext of ICON_EXTS) {
					out.push(path.join(root, theme, size, 'apps', `${name}${ext}`))
					out.push(path.join(root, theme, 'apps', size, `${name}${ext}`)) // KDE-style layout
				}
			}
		}
	}
	for (const dir of PIXMAP_DIRS) for (const ext of ICON_EXTS) out.push(path.join(dir, `${name}${ext}`))
	return out
}

/**
 * @param {string} action a pinned action or `app:<id>`
 * @returns {string[]} candidate icon files, best first
 */
function candidatesForAction(action) {
	const pinned = HELPER_ICON_CANDIDATES[action]
	if (pinned) return pinned
	try {
		const entry = require('../utils/desktop-app-catalog').findAppEntry(action)
		if (!entry) return []
		/* An app that aliases to a pinned tool (firefox-esr.desktop -> the operator Firefox) should
		 * show the same chip, whichever menu row was clicked. */
		const viaPinned = entry.pinnedAction ? HELPER_ICON_CANDIDATES[entry.pinnedAction] || [] : []
		return [...iconCandidates(entry.icon), ...viaPinned]
	} catch {
		return []
	}
}

/**
 * The icon file to serve for an action, or null.
 * @param {string} action
 * @returns {{ file: string, contentType: string }|null}
 */
function resolveHelperIcon(action) {
	for (const f of candidatesForAction(action)) {
		try {
			if (!fs.statSync(f).isFile()) continue
		} catch {
			continue
		}
		return { file: f, contentType: f.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png' }
	}
	return null
}

module.exports = {
	HELPER_ICON_CANDIDATES,
	iconCandidates,
	candidatesForAction,
	resolveHelperIcon,
}
