'use strict'

/**
 * WO-628 — the operator dock (owner 20.10: "because we are running a normal app with no funny business with windows
 * and cut outs, we can start treating the operator gui as a normal computer screen … an extremely small dock, maybe
 * with autohide, in the middle bottom (macOS dock style), with the most important apps and more which shows a menu
 * list. So no need for the 'taskbar' hack in the top bar").
 *
 * The Godot client is an ordinary window, so opening an app is just that: launch it, or bring its window to the front
 * when it is already running (a dock click). None of the WO-283 kiosk machinery applies — no ABOVE-layer promotion,
 * no kiosk top-assert suspension, no one-helper-at-a-time session, no restore watchdog.
 *
 * Vocabulary and gate are the WO-283/387 ones: the five curated tools (their bespoke launch paths — isolated Firefox
 * profile, media-path file manager, NVIDIA display policy — live in spawnGuiDetached) plus `app:<desktop-id>` for any
 * installed application, re-checked against the catalog on every launch (operator-helper-window.js isHelperAction).
 */

const { HELPER_ACTIONS, isHelperAction } = require('./operator-helper-window')
const { classifyHelperWindows } = require('./operator-helper-window-state')

/** Pinned order + dock names (web header-bar-operator-helper.js HELPER_ITEMS). */
const PINNED = [
	['firefox', 'Web browser'],
	['file-manager', 'File browser'],
	['desktopvideo_setup', 'DeckLink setup'],
	['desktop_video_updater', 'DeckLink updater'],
	['nvidia-settings', 'NVIDIA settings'],
]

/** The dock's own first icon: the HighAsCG operator window itself (Godot client title "HighAsCG Operator…"). */
const SELF_ACTION = 'highascg'
const SELF_TITLE_RE = '^HighAsCG Operator'

/** The kiosk-era Firefox page forced this into its title; never treat that window as "the browser is open". */
const OPERATOR_TITLE_MARKER = 'HIGHASCG-OPERATOR-GUI'

/**
 * Pure: the dock's content. `apps` = desktop-app-catalog listAppsForMenu(); an installed app that IS a pinned tool
 * (pinnedAction set) is left out of "more" — it is already on the dock.
 * @returns {{ pinned: { action: string, name: string }[], apps: { action: string, name: string, comment: string }[] }}
 */
function dockModel(apps) {
	const pinned = PINNED.filter(([a]) => HELPER_ACTIONS.includes(a)).map(([action, name]) => ({ action, name }))
	const more = (Array.isArray(apps) ? apps : [])
		.filter((a) => a && a.action && !a.pinnedAction)
		.map((a) => ({
			action: String(a.action),
			name: String(a.name || a.id || a.action),
			comment: String(a.comment || ''),
		}))
		.sort((x, y) => x.name.localeCompare(y.name))
	return { pinned, apps: more }
}

/**
 * The dock's content + `running`: the pinned tools that have a window open (the dots under their icons). A Firefox
 * profile-lock dialog counts, as in launchOrFocus. No xdotool / display → none running.
 * @param {{ findGuiWindowIds?: Function, listApps?: Function }} [deps]
 */
async function getDock(deps = {}) {
	let apps = []
	try {
		apps = (deps.listApps || require('../utils/desktop-app-catalog').listAppsForMenu)()
	} catch {
		/* no catalog → pinned tools only */
	}
	const model = dockModel(apps)
	const find = deps.findGuiWindowIds || require('../utils/x-display-session').findGuiWindowIds
	const hits = await Promise.all(
		model.pinned.map(async ({ action }) => {
			try {
				const w = classifyHelperWindows(await find(action, { excludeTitle: OPERATOR_TITLE_MARKER, withNames: true }))
				return w.usable.length || w.blocked.length ? action : null
			} catch {
				return null
			}
		})
	)
	return { ...model, running: hits.filter(Boolean) }
}

/**
 * Launch `action`, or focus its window when one is already mapped.
 * @param {string} action
 * @param {{ config?: object, log?: Function }} ctx
 * @param {{ findGuiWindowIds?: Function, activate?: Function, spawnGuiDetached?: Function, isHelperAction?: Function }} [deps]
 * @returns {Promise<{ status: number, body: object }>}
 */
async function launchOrFocus(action, ctx, deps = {}) {
	const a = String(action || '').trim()
	if (a === SELF_ACTION) return focusSelf(ctx, deps)
	const gate = deps.isHelperAction || isHelperAction
	if (!a || !gate(a)) return { status: 400, body: { ok: false, error: `Unknown app: ${a || '(none)'}` } }
	const log = typeof ctx?.log === 'function' ? ctx.log : () => {}
	const find = deps.findGuiWindowIds || require('../utils/x-display-session').findGuiWindowIds
	let wins = { usable: [], blocked: [] }
	try {
		wins = classifyHelperWindows(await find(a, { excludeTitle: OPERATOR_TITLE_MARKER, withNames: true }))
	} catch {
		/* no xdotool / no display → just launch */
	}
	// A "Close Firefox" profile-lock modal counts as running: bring it forward to be dismissed, never spawn a second.
	const target = wins.usable[0] || wins.blocked[0]
	if (target) {
		const activate = deps.activate || activateWindow
		await activate(target.id)
		log(
			'info',
			`[dock] ${a}: focused the running window ${target.id}${wins.usable.length ? '' : ' (profile-lock dialog)'}`
		)
		return { status: 200, body: { ok: true, action: a, focused: true } }
	}
	try {
		const spawn = deps.spawnGuiDetached || require('../api/system-hardware-gui').spawnGuiDetached
		const exe = spawn(a, { config: ctx?.config || {}, log })
		log('info', `[dock] ${a}: launched ${exe}`)
		return { status: 200, body: { ok: true, action: a, launched: true, exe } }
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		log('warn', `[dock] ${a}: launch failed: ${msg}`)
		return { status: 500, body: { ok: false, action: a, error: msg } }
	}
}

/** Bring the operator client back over whatever the dock opened (a WM refuses a client raising itself). */
async function focusSelf(ctx, deps = {}) {
	const search = deps.searchByName || searchWindowsByName
	const ids = await search(SELF_TITLE_RE)
	if (!ids.length) return { status: 404, body: { ok: false, action: SELF_ACTION, error: 'HighAsCG window not found' } }
	await (deps.activate || activateWindow)(ids[0])
	return { status: 200, body: { ok: true, action: SELF_ACTION, focused: true } }
}

async function searchWindowsByName(re) {
	const { execFile } = require('child_process')
	const { displaySessionEnv } = require('../utils/x-display-session-runtime-env')
	return new Promise((resolve) => {
		execFile(
			'xdotool',
			['search', '--onlyvisible', '--name', re],
			{ env: displaySessionEnv(), timeout: 3000 },
			(_e, out) =>
				resolve(
					String(out || '')
						.trim()
						.split(/\s+/)
						.filter(Boolean)
				)
		)
	})
}

/** xdotool windowactivate: map, raise and focus through the window manager (a dock click on a running app). */
async function activateWindow(wid) {
	const { execFile } = require('child_process')
	const { displaySessionEnv } = require('../utils/x-display-session-runtime-env')
	await new Promise((resolve) => {
		execFile('xdotool', ['windowactivate', String(wid)], { env: displaySessionEnv(), timeout: 3000 }, () => resolve())
	})
}

module.exports = { PINNED, SELF_ACTION, dockModel, getDock, launchOrFocus }
