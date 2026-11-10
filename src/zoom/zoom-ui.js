'use strict'

/**
 * WO-1012 — drive the Zoom client through its accessibility tree: no pointer, no screen positions, no Zoom API.
 *
 * Zoom (Qt) lists every control by name on the accessibility bus with a "Press" / "Toggle" action
 * (tools/zoom-a11y/zoom_a11y.py is the only AT-SPI code). This module holds the meaning:
 *   state()               in a meeting / waiting room / join preview, muted, video, tabs, tiles, who shares
 *   setMute / setVideo    press the toolbar button when the state differs, read it back
 *   join()                the join preview: video on, then "Join"
 *   selectTab(which)      the main window on its "Meeting" tab (the speaker) or on the share tab
 *   participants()        names and their mic / video state from the Participants panel
 *   pin(name)             the tile's own menu ▸ Pin (Zoom offers it from three participants up)
 *   applySettings()       the settings this integration needs, set once in Zoom's Settings window (SETTINGS_PROFILE)
 * Everything keys on Zoom's ENGLISH control names (Zoom 7.1). A name that is gone comes back as an error naming it,
 * never as a silent success.
 *
 * `createZoomUi(deps)` takes injectable exec / sleep for the smoke test; `readState` and `settingsPlan` are pure.
 */

const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { displaySessionEnv } = require('../utils/x-display-session-runtime-env')
const { zoomClientEnv } = require('./zoom-launch-env')

const HELPER = path.join(__dirname, '..', '..', 'tools', 'zoom-a11y', 'zoom_a11y.py')
const MEETING = '^Meeting$'
const HOME = '^Zoom Workplace - '
const SETTINGS = '^Settings$'
const SETTINGS_PAGES = ['General', 'Video & effects', 'Audio', 'Meetings & webinars', 'Share screen']

/**
 * What the integration needs from Zoom's own settings. `want: true` on a radio selects it.
 * Camera = the program picture, so every "improve my video" option is off; the microphone = the program sound, so
 * Zoom must not ride its level or strip music out of it.
 */
const SETTINGS_PROFILE = [
	{ name: '^Meeting window view Dual window$', role: 'radio button', want: true, why: 'a second meeting window: share and camera at once' },
	{ name: '^Show video preview first$', role: 'check box', want: false, why: 'join without the preview click' },
	{ name: '^Automatically connect to computer audio$', role: 'check box', want: true, why: 'audio joins by itself' },
	{ name: '^Enter full screen automatically$', role: 'check box', want: false, why: 'a full-screen Zoom window covers the operator GUI' },
	{ name: '^Hide your own video from the video gallery$', role: 'check box', want: true, why: 'the camera source shows only the far end' },
	{ name: '^Show non-video participants$', role: 'check box', want: false, why: 'no name-only tiles in the picture' },
	{ name: '^Keep participant names visible$', role: 'check box', want: false, why: 'no name label on the video' },
	{ name: '^Show meeting timer$', role: 'check box', want: false, why: 'no timer in the picture' },
	{ name: '^Stop audio and video when computer locks$', role: 'check box', want: false, why: 'the feed never stops by itself' },
	{ name: '^HD$', role: 'check box', want: true, why: 'send the program in HD' },
	{ name: '^Mirror my video preview$', role: 'check box', want: false, why: 'the program is not mirrored' },
	{ name: '^Touch up my appearance$', role: 'check box', want: false, why: 'the program picture is sent as it is' },
	{ name: '^Adjust for low light$', role: 'check box', want: false, why: 'the program picture is sent as it is' },
	{ name: '^Portrait lighting$', role: 'check box', want: false, why: 'the program picture is sent as it is' },
	{ name: '^Auto-framing$', role: 'check box', want: false, why: 'the program picture is sent as it is' },
	{ name: '^Automatically adjust microphone volume$', role: 'check box', want: false, why: 'Zoom must not ride the program level' },
	{ name: '^Original sound for musicians$', role: 'radio button', want: true, why: 'music and tones pass (noise removal turns them into silence)' },
]

const showing = (c) => Array.isArray(c.states) && c.states.includes('showing')
const checked = (c) => Array.isArray(c.states) && c.states.includes('checked')
const find = (controls, re, role) => controls.find((c) => re.test(c.name) && (!role || c.role === role))

/**
 * Pure: what Zoom is doing, from a full `dump`.
 * @param {Array<{ name: string, states: string[], controls: object[] }>} frames
 */
function readState(frames) {
	const list = (Array.isArray(frames) ? frames : []).filter(showing)
	const meeting = list.find((f) => f.name === 'Meeting')
	const mc = meeting ? meeting.controls.filter(showing) : []
	const preview = list.find((f) => f.name !== 'Meeting' && !/^Zoom Workplace/.test(f.name) && f.controls.some((c) => showing(c) && c.role === 'button' && c.name === 'Join'))
	const waiting = !!meeting && mc.some((c) => /Test Speaker and Mic|let them know you're here|Waiting for the host/i.test(c.name))
	const inMeeting = !!meeting && !waiting && mc.some((c) => c.role === 'button' && c.name === 'Leave')
	const mic = find(mc, /^(Mute|Unmute)$/, 'button')
	const cam = find(mc, /^(Stop video|Start video)$/, 'button')
	const tabs = mc.filter((c) => c.role === 'page tab').map((c) => ({ name: c.name.replace(/, checked$/, ''), checked: checked(c) || /, checked$/.test(c.name) }))
	const tiles = []
	for (const f of list) {
		if (f.name !== 'Meeting' && f.name !== 'Zoom Workplace') continue
		for (const c of f.controls) {
			const m = showing(c) && c.role === 'button' && c.name.match(/^video item (.*?)(\s+Active Speaker)?\s*$/)
			if (m && m[1]) tiles.push({ name: m[1], window: f.name === 'Meeting' ? 'main' : 'second', activeSpeaker: !!m[2] })
		}
	}
	const original = find(mc, /original sound/i)
	return {
		running: Array.isArray(frames) && frames.length > 0,
		preview: preview ? preview.name : '',
		waiting,
		inMeeting,
		muted: inMeeting && mic ? mic.name === 'Unmute' : null,
		video: inMeeting && cam ? cam.name === 'Stop video' : null,
		tabs,
		sharing: tabs.map((t) => (t.name.match(/^(.*)'s screen$/) || [])[1]).filter(Boolean),
		tiles,
		originalSound: original ? original.name : '',
	}
}

/**
 * Pure: the toggles to press so the Settings controls match `profile`.
 * @returns {{ press: object[], ok: object[], missing: object[] }}
 */
function settingsPlan(controls, profile = SETTINGS_PROFILE) {
	const out = { press: [], ok: [], missing: [] }
	for (const p of profile) {
		const c = find(Array.isArray(controls) ? controls : [], new RegExp(p.name), p.role)
		const label = p.name.replace(/^\^|\$$/g, '')
		if (!c) out.missing.push({ setting: label, why: p.why })
		else if (checked(c) === p.want) out.ok.push({ setting: label, on: p.want })
		else if (p.role === 'radio button' && !p.want) out.missing.push({ setting: label, why: 'a radio cannot be switched off' })
		else out.press.push({ setting: label, on: p.want, name: p.name, role: p.role, why: p.why })
	}
	return out
}

function createZoomUi(deps = {}) {
	const exec = deps.exec || promisify(execFile)
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
	const log = deps.log || (() => {})
	const env = () => ({ ...displaySessionEnv(), ...zoomClientEnv({}) })

	/** One helper call → its JSON (never throws: `{ ok: false, error }`). */
	async function a11y(args) {
		try {
			const { stdout } = await exec('python3', ['-W', 'ignore', HELPER, ...args], { env: env(), timeout: 10000, maxBuffer: 16 << 20 })
			return JSON.parse(stdout)
		} catch (e) {
			try {
				return JSON.parse(String(e.stdout || '')) // exit 1 still prints the reason
			} catch {
				return { ok: false, error: String(e.message || e).split('\n')[0] }
			}
		}
	}
	// One read serves every caller within 700 ms (the GUI polls each second, the join watcher too); any press drops it.
	let cached = { at: 0, value: null }
	const dump = async (frame) => (await a11y(frame ? ['dump', '--frame', frame] : ['dump'])).frames || []
	const press = (frame, name, extra = []) => {
		cached = { at: 0, value: null }
		return a11y(['press', '--frame', frame, '--name', name, ...extra])
	}
	const need = (r, what) => {
		if (!r || !r.ok) throw new Error(`Zoom control not found or not pressed: ${what}${r && r.error ? ` (${r.error})` : ''}`)
		return r
	}

	/** The last settings run: null (never), { running: true }, { error }, or applySettings' result. */
	let settingsRun = null
	const state = async () => {
		if (!cached.value || Date.now() - cached.at > 700) cached = { at: Date.now(), value: readState(await dump()) }
		return { ok: true, ...cached.value, settings: settingsRun }
	}

	/** Press a two-state toolbar button until Zoom shows the wanted state. */
	async function setToolbar(key, want, onName, offName) {
		let s = await state()
		if (!s.inMeeting) throw new Error('not in a meeting')
		if (s[key] === want) return s
		need(await press(MEETING, `^${want ? onName : offName}$`, ['--role', 'button']), want ? onName : offName)
		for (let i = 0; i < 8; i++) {
			await sleep(400)
			s = await state()
			if (s[key] === want) return s
		}
		throw new Error(`Zoom did not change: ${key} is still ${s[key]}`)
	}
	const setMute = (muted) => setToolbar('muted', !!muted, 'Mute', 'Unmute')
	const setVideo = (on) => setToolbar('video', !!on, 'Start video', 'Stop video')

	/** The join preview: camera on, then Join. A Zoom already in the meeting (or the waiting room) is left alone. */
	async function join() {
		const s = await state()
		if (s.inMeeting || s.waiting) return s
		if (!s.preview) throw new Error('no join preview on screen')
		const frame = `^${s.preview.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
		const cs = ((await dump(frame))[0] || { controls: [] }).controls.filter(showing)
		if (find(cs, /^Start video$/, 'button')) await press(frame, '^Start video$', ['--role', 'button'])
		need(await press(frame, '^Join$', ['--role', 'button']), 'Join')
		log('info', '[zoom-ui] pressed Join on the preview')
		await sleep(1500)
		return state()
	}

	/** After a launch with a meeting link: wait for the preview (or the meeting itself) and go in. */
	async function autoJoin(timeoutMs = 45000) {
		const until = Date.now() + timeoutMs
		while (Date.now() < until) {
			let s = await state()
			if (s.preview) s = await join()
			if (s.inMeeting || s.waiting) {
				cameraOnceInside().catch((e) => log('warn', `[zoom-ui] camera after joining: ${e.message}`))
				return s
			}
			await sleep(1500)
		}
		throw new Error('Zoom showed neither a join preview nor a meeting')
	}

	/**
	 * A join without the preview comes in with the camera off (10.11, live), and the waiting room has no camera
	 * button. So: wait until the box is inside (the host may take a while to admit it), then turn the camera on.
	 */
	async function cameraOnceInside(maxMs = 15 * 60 * 1000) {
		const until = Date.now() + maxMs
		while (Date.now() < until) {
			const s = await state()
			if (s.inMeeting) {
				if (s.video === false) {
					await setVideo(true)
					log('info', '[zoom-ui] inside the meeting: camera turned on')
				}
				return
			}
			if (!s.running) return
			await sleep(3000)
		}
	}

	/**
	 * The main window on one of its tabs: "meeting" (the speaker's video) or "share" (the shared screen). Zoom's tabs
	 * take the Press action and do nothing (10.11, live), so the tab is clicked where Zoom reports it, with the
	 * window brought to the front first.
	 */
	async function selectTab(which) {
		const s = await state()
		if (!s.inMeeting) throw new Error('not in a meeting')
		const tab = which === 'share' ? s.tabs.find((t) => /'s screen$/.test(t.name)) : s.tabs.find((t) => t.name === 'Meeting')
		if (!tab) throw new Error(which === 'share' ? 'nobody is sharing' : 'Zoom shows no Meeting tab')
		if (tab.checked) return s
		need(await press(MEETING, which === 'share' ? "'s screen" : '^Meeting', ['--role', 'page tab', '--click', '--raise']), `${tab.name} tab`)
		log('info', `[zoom-ui] main window on its "${tab.name}" tab`)
		await sleep(900)
		const after = await state()
		if (!(after.tabs.find((t) => t.name === tab.name) || {}).checked) throw new Error(`Zoom did not switch to the "${tab.name}" tab`)
		return after
	}

	/** Names from the Participants panel (opened for the read, then closed again if it was closed). */
	async function participants() {
		const read = async () => {
			const cs = ((await dump(MEETING))[0] || { controls: [] }).controls.filter(showing)
			const head = cs.findIndex((c) => c.role === 'label' && /^Participants \(\d+\)$/.test(c.name))
			if (head < 0) return null
			const out = []
			for (let i = head + 1; i < cs.length; i++) {
				const m = cs[i].role === 'label' && cs[i].name.match(/^(.*?)\((Me|Host|Co-host|Guest)(?:, [^)]*)?\)$/)
				if (!m) continue
				const row = []
				for (let j = i + 1; j < cs.length && !(cs[j].role === 'label' && /\((Me|Host|Co-host|Guest)/.test(cs[j].name)) && cs[j].name !== 'Invite'; j++) row.push(cs[j].name)
				out.push({ name: m[1].trim(), me: m[2] === 'Me', host: m[2] === 'Host', muted: row.includes('Muted') || row.includes('Unmute'), video: row.includes('Video on') || row.includes('Stop video'), sharing: row.includes('Sharing') })
			}
			return out
		}
		let list = await read()
		if (list) return { ok: true, participants: list }
		need(await press(MEETING, '^Participants$', ['--role', 'button']), 'Participants')
		await sleep(900)
		list = await read()
		await press(MEETING, '^Participants$', ['--role', 'button'])
		if (!list) throw new Error('Zoom showed no Participants panel')
		return { ok: true, participants: list }
	}

	/** Pin one participant in the main window (their tile's own menu). `name` empty = remove the pin. */
	async function pin(name) {
		const who = String(name || '').trim()
		if (!who) {
			need(await press(MEETING, '^Remove pin$', ['--role', 'button']), 'Remove pin')
			return state()
		}
		const tile = `^video item ${who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`
		need(await press(MEETING, tile, ['--role', 'button', '--click', '--raise', '--button', '3', '--at', '0.1,0.2']), `the video tile of ${who}`)
		await sleep(900)
		const r = await press('menu window', '^Pin$', ['--role', 'menu item'])
		if (!r.ok) {
			await a11y(['key', '--keysym', '0xff1b']) // close the menu
			throw new Error(`Zoom offers no Pin for ${who} (it needs three or more participants)`)
		}
		await sleep(600)
		return state()
	}

	/** Open Zoom's Settings, visit the pages (their controls only exist once shown), set SETTINGS_PROFILE, close. */
	async function applySettings(profile = SETTINGS_PROFILE) {
		let frames = await dump(SETTINGS)
		if (!frames.some(showing)) {
			need(await press(HOME, '^Settings$', ['--role', 'button']), 'Settings (Zoom home window)')
			await sleep(1800)
		}
		// Page by page: the Video page's controls only exist while that page is shown (10.11, live), so each page is
		// read and set while it is up. A setting counts as missing only when no page had it.
		const controls = () => dump(SETTINGS).then((f) => (f[0] || { controls: [] }).controls)
		const seen = new Map() // setting → { on, changed } | { failed }
		for (const page of SETTINGS_PAGES) {
			await press(SETTINGS, `^${page}$`, ['--role', 'label', '--click', '--raise'])
			await sleep(1000)
			const plan = settingsPlan(await controls(), profile)
			for (const o of plan.ok) if (!seen.has(o.setting)) seen.set(o.setting, { on: o.on, changed: false })
			for (const p of plan.press) {
				if (seen.has(p.setting)) continue
				await press(SETTINGS, p.name, ['--role', p.role, '--action', 'Toggle'])
				await sleep(350)
			}
			if (!plan.press.length) continue
			const after = settingsPlan(await controls(), profile)
			for (const p of plan.press) {
				if (seen.has(p.setting)) continue
				seen.set(p.setting, after.ok.some((o) => o.setting === p.setting) ? { on: p.on, changed: true, why: p.why } : { on: p.on, failed: true })
			}
		}
		await a11y(['close', '--frame', SETTINGS])
		const label = (p) => p.name.replace(/^\^|\$$/g, '')
		const changed = [...seen].filter(([, v]) => v.changed).map(([setting, v]) => ({ setting, on: v.on, why: v.why }))
		const failed = [...seen].filter(([, v]) => v.failed).map(([setting, v]) => ({ setting, on: v.on }))
		const missing = profile.filter((p) => !seen.has(label(p))).map((p) => ({ setting: label(p), why: p.why }))
		const alreadyRight = [...seen].filter(([, v]) => !v.changed && !v.failed).length
		log('info', `[zoom-ui] settings: ${changed.length} changed, ${alreadyRight} already right, ${failed.length} failed, ${missing.length} not found`)
		return { ok: failed.length === 0 && missing.length === 0, changed, alreadyRight, failed, missing }
	}

	/**
	 * Start applySettings in the background and answer at once: a run takes about half a minute (five pages, each
	 * shown before it is read), longer than a client waits for a POST. The result is `settings` in state().
	 */
	function startSettings() {
		if (settingsRun && settingsRun.running) return { ok: true, running: true }
		settingsRun = { running: true }
		applySettings()
			.then((r) => (settingsRun = { running: false, ...r }))
			.catch((e) => {
				settingsRun = { running: false, ok: false, error: String(e.message || e) }
				log('warn', `[zoom-ui] settings: ${settingsRun.error}`)
			})
		return { ok: true, running: true }
	}

	return { startSettings, state, setMute, setVideo, join, autoJoin, selectTab, participants, pin, applySettings, a11y }
}

let instance = null
/** The box instance (routes). */
function getZoomUi(log) {
	if (!instance) instance = createZoomUi({ log })
	return instance
}

module.exports = { createZoomUi, getZoomUi, readState, settingsPlan, SETTINGS_PROFILE }
