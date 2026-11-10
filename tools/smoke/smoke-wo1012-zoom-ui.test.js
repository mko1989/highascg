'use strict'

/**
 * WO-1012 — Zoom's own controls through its accessibility tree (src/zoom/zoom-ui.js): the state is read from the
 * controls Zoom shows, a two-state button is pressed only when the state differs and read back, the join preview is
 * joined with the camera on, tabs are clicked (their Press action does nothing), the settings profile is applied
 * page by page, and a control that is gone is an error that names it.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createZoomUi, readState, settingsPlan, SETTINGS_PROFILE } = require('../../src/zoom/zoom-ui')

const S = ['showing', 'enabled']
const c = (role, name, extra = []) => ({ role, name, states: [...S, ...extra], actions: ['Press'] })
const hidden = (role, name) => ({ role, name, states: ['enabled'], actions: ['Press'] })

function meetingFrames({ muted = false, video = true, tab = 'Meeting', share = true } = {}) {
	return [
		{ name: 'Zoom Workplace - Free account', states: S, controls: [c('button', 'Join'), c('button', 'Settings')] },
		{
			name: 'Meeting',
			states: S,
			controls: [
				c('page tab', tab === 'Meeting' ? 'Meeting, checked' : 'Meeting', tab === 'Meeting' ? ['checked'] : []),
				...(share ? [c('page tab', tab === 'share' ? "ZOOM's screen, checked" : "ZOOM's screen", tab === 'share' ? ['checked'] : [])] : []),
				c('button', 'video item ZOOM Active Speaker'),
				hidden('button', 'video item ZOOM '),
				hidden('button', 'Remove pin'),
				c('button', muted ? 'Unmute' : 'Mute'),
				c('button', video ? 'Stop video' : 'Start video'),
				c('button', 'Participants'),
				c('button', 'Leave'),
			],
		},
		{ name: 'Zoom Workplace', states: S, controls: [c('button', 'video item BSC AV Active Speaker'), hidden('button', 'Original sound for musicians: On')] },
		{ name: 'menu window', states: ['enabled'], controls: [c('menu item', 'Fullscreen')] },
	]
}

test('state: read from what Zoom shows (meeting, mic, camera, tabs, who shares, tiles per window)', () => {
	const s = readState(meetingFrames())
	assert.deepStrictEqual(
		{ inMeeting: s.inMeeting, waiting: s.waiting, preview: s.preview, muted: s.muted, video: s.video, sharing: s.sharing },
		{ inMeeting: true, waiting: false, preview: '', muted: false, video: true, sharing: ['ZOOM'] }
	)
	assert.deepStrictEqual(s.tabs, [{ name: 'Meeting', checked: true }, { name: "ZOOM's screen", checked: false }])
	assert.deepStrictEqual(s.tiles, [{ name: 'ZOOM', window: 'main', activeSpeaker: true }, { name: 'BSC AV', window: 'second', activeSpeaker: true }])
	assert.strictEqual(readState(meetingFrames({ muted: true, video: false })).muted, true)
	assert.strictEqual(readState(meetingFrames({ muted: true, video: false })).video, false)

	const waiting = readState([{ name: 'Meeting', states: S, controls: [c('label', "Host has joined. We've let them know you're here."), c('button', 'Test Speaker and Mic')] }])
	assert.deepStrictEqual([waiting.waiting, waiting.inMeeting, waiting.muted], [true, false, null])
	const preview = readState([{ name: 'Zoom Workplace - Free account', states: S, controls: [c('button', 'Join')] }, { name: "host's Zoom Meeting", states: S, controls: [c('button', 'Start video'), c('button', 'Join')] }])
	assert.strictEqual(preview.preview, "host's Zoom Meeting", 'the home window has a Join button too: it is not the preview')
	assert.strictEqual(readState([]).running, false)
})

/** A fake helper: `frames()` is what a dump returns, presses are recorded and may change the frames. */
function rig(frames, onPress = () => {}) {
	const calls = []
	const exec = async (bin, args) => {
		const a = args.slice(3)
		calls.push(a)
		if (a[0] === 'dump') {
			const i = a.indexOf('--frame')
			const re = i >= 0 ? new RegExp(a[i + 1], 'i') : null
			return { stdout: JSON.stringify({ ok: true, frames: frames().filter((f) => !re || re.test(f.name)) }) }
		}
		if (a[0] === 'press') {
			const get = (k) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : '')
			const fre = new RegExp(get('--frame'), 'i')
			const nre = new RegExp(get('--name'), 'i')
			const role = get('--role')
			for (const f of frames()) {
				if (!fre.test(f.name)) continue
				const hit = f.controls.find((x) => nre.test(x.name) && (!role || x.role === role))
				if (hit) {
					onPress(hit, a, f)
					return { stdout: JSON.stringify({ ok: true, pressed: { frame: f.name, role: hit.role, name: hit.name } }) }
				}
			}
			const e = new Error('exit 1')
			e.stdout = JSON.stringify({ ok: false, error: 'no Zoom control matches' })
			throw e
		}
		return { stdout: JSON.stringify({ ok: true }) }
	}
	return { ui: createZoomUi({ exec, sleep: async () => {} }), calls }
}

test('mute / video: pressed only when the state differs, then read back; a gone control is an error that names it', async () => {
	let st = { muted: false, video: true }
	const r = rig(() => meetingFrames(st), (hit) => {
		if (hit.name === 'Mute') st = { ...st, muted: true }
		if (hit.name === 'Unmute') st = { ...st, muted: false }
		if (hit.name === 'Stop video') st = { ...st, video: false }
	})
	assert.strictEqual((await r.ui.setMute(false)).muted, false)
	assert.ok(!r.calls.some((a) => a[0] === 'press'), 'already unmuted: nothing pressed')
	assert.strictEqual((await r.ui.setMute(true)).muted, true)
	assert.strictEqual((await r.ui.setVideo(false)).video, false)
	assert.strictEqual(r.calls.filter((a) => a[0] === 'press').length, 2)

	const stuck = rig(() => meetingFrames({ muted: false }))
	await assert.rejects(stuck.ui.setMute(true), /did not change/)
	const out = rig(() => [])
	await assert.rejects(out.ui.setMute(true), /not in a meeting/)
})

test('join: the preview gets its camera on and Join; a Zoom already inside is left alone', async () => {
	let inside = false
	const frames = () =>
		inside
			? meetingFrames()
			: [{ name: 'Zoom Workplace - Free account', states: S, controls: [c('button', 'Join')] }, { name: "host's Zoom Meeting", states: S, controls: [c('button', 'Start video'), c('button', 'Join')] }]
	const r = rig(frames, (hit, a, f) => {
		if (hit.name === 'Join' && f.name === "host's Zoom Meeting") inside = true
	})
	const s = await r.ui.autoJoin(5000)
	assert.strictEqual(s.inMeeting, true)
	const pressed = r.calls.filter((a) => a[0] === 'press').map((a) => a[a.indexOf('--name') + 1])
	assert.deepStrictEqual(pressed, ['^Start video$', '^Join$'])
	r.calls.length = 0
	await r.ui.join()
	assert.ok(!r.calls.some((a) => a[0] === 'press'))
})

test('tabs: clicked with the window raised (Press does nothing on them), and the switch is verified', async () => {
	let tab = 'share'
	const r = rig(() => meetingFrames({ tab }), (hit, a) => {
		assert.ok(a.includes('--click') && a.includes('--raise'))
		tab = /screen/.test(hit.name) ? 'share' : 'Meeting'
	})
	assert.strictEqual((await r.ui.selectTab('meeting')).tabs[0].checked, true)
	assert.strictEqual((await r.ui.selectTab('share')).tabs[1].checked, true)
	const none = rig(() => meetingFrames({ share: false }))
	await assert.rejects(none.ui.selectTab('share'), /nobody is sharing/)
	const dead = rig(() => meetingFrames({ tab: 'share' }))
	await assert.rejects(dead.ui.selectTab('meeting'), /did not switch/)
})

test('settings: the plan presses only what differs; a radio is only ever selected; unknown names are reported', () => {
	const controls = [
		c('radio button', 'Meeting window view Dual window'),
		c('check box', 'Show video preview first', ['checked']),
		c('check box', 'HD', ['checked']),
		c('radio button', 'Original sound for musicians', ['checked']),
	]
	const plan = settingsPlan(controls)
	assert.deepStrictEqual(plan.press.map((p) => [p.setting, p.on]), [['Meeting window view Dual window', true], ['Show video preview first', false]])
	assert.deepStrictEqual(plan.ok.map((p) => p.setting), ['HD', 'Original sound for musicians'])
	assert.strictEqual(plan.missing.length, SETTINGS_PROFILE.length - 4)
	assert.deepStrictEqual(settingsPlan([c('radio button', 'X', ['checked'])], [{ name: '^X$', role: 'radio button', want: false, why: '' }]).press, [])
})

test('settings: applied page by page (the Video page only has its controls while shown), then the window is closed', async () => {
	let page = ''
	const box = (name, on) => c('check box', name, on ? ['checked'] : [])
	const state = { 'Show video preview first': true, HD: false, 'Mirror my video preview': false }
	const frames = () => [
		{ name: 'Zoom Workplace - Free account', states: S, controls: [c('button', 'Settings')] },
		{
			name: 'Settings',
			states: S,
			controls: [
				...['General', 'Video & effects', 'Audio', 'Meetings & webinars', 'Share screen'].map((p) => c('label', p)),
				box('Show video preview first', state['Show video preview first']),
				...(page === 'Video & effects' ? [box('HD', state.HD), box('Mirror my video preview', state['Mirror my video preview'])] : []),
			],
		},
	]
	const r = rig(frames, (hit) => {
		if (hit.role === 'label') page = hit.name
		else if (hit.role === 'check box') state[hit.name] = !state[hit.name]
	})
	const out = await r.ui.applySettings()
	assert.deepStrictEqual(out.changed.map((x) => [x.setting, x.on]), [['Show video preview first', false], ['HD', true]])
	assert.strictEqual(out.alreadyRight, 1)
	assert.deepStrictEqual(out.failed, [])
	assert.ok(out.missing.length > 5 && !out.ok, 'settings this fake Zoom does not have are reported, not hidden')
	assert.deepStrictEqual(r.calls[r.calls.length - 1].slice(0, 3), ['close', '--frame', '^Settings$'])
})

test('participants and pin: names with their state; no Pin in the menu is said so and the menu is closed', async () => {
	let panel = false
	const frames = () => {
		const f = meetingFrames()
		if (panel)
			f[1].controls.push(c('label', 'Participants (2)'), c('label', 'BSC AV(Me)'), c('button', 'Mute'), c('button', 'Stop video'), c('label', 'ZOOM(Host)'), c('button', 'Sharing'), c('button', 'Muted'), c('button', 'Video on'), c('button', 'Invite'))
		return f
	}
	const r = rig(frames, (hit) => {
		if (hit.name === 'Participants') panel = !panel
	})
	const p = await r.ui.participants()
	assert.deepStrictEqual(p.participants, [
		{ name: 'BSC AV', me: true, host: false, muted: false, video: true, sharing: false },
		{ name: 'ZOOM', me: false, host: true, muted: true, video: true, sharing: true },
	])
	assert.strictEqual(panel, false, 'the panel is closed again')
	await assert.rejects(r.ui.pin('ZOOM'), /no Pin for ZOOM/)
	assert.deepStrictEqual(r.calls[r.calls.length - 1], ['key', '--keysym', '0xff1b'])
})

test('routes: actions map to the UI, unknown actions and failures are 400s, raw JSON body', async () => {
	const routes = { h: {} }
	routes.get = (p, fn) => (routes.h['GET ' + p] = fn)
	routes.post = (p, fn) => (routes.h['POST ' + p] = fn)
	require('../../src/api/routes-zoom-ui').register(routes)
	assert.deepStrictEqual(Object.keys(routes.h).sort(), ['GET /api/zoom/ui', 'POST /api/zoom/ui'])
	const bad = await routes.h['POST /api/zoom/ui']({ ctx: {}, body: JSON.stringify({ action: 'dance' }) })
	assert.strictEqual(bad.status, 400)
	assert.match(JSON.parse(bad.body).error, /unknown Zoom action/)
	const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'api', 'router.js'), 'utf8')
	assert.ok(src.includes("require('./routes-zoom-" + "ui').register(routes)"))
	const helper = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'zoom-a11y', 'zoom_a11y.py'), 'utf8')
	for (const cmd of ['"dump"', '"press"', '"close"', '"key"']) assert.ok(helper.includes(`sub.add_parser(${cmd})`), cmd)
})

test('settings from the API answer at once; the run and its result are in the state', async () => {
	const frames = () => [{ name: 'Zoom Workplace - Free account', states: S, controls: [c('button', 'Settings')] }, { name: 'Settings', states: S, controls: [c('check box', 'HD', ['checked'])] }]
	const r = rig(frames)
	assert.strictEqual((await r.ui.state()).settings, null)
	assert.deepStrictEqual(r.ui.startSettings(), { ok: true, running: true })
	assert.deepStrictEqual(r.ui.startSettings(), { ok: true, running: true }, 'a second press while it runs starts nothing')
	for (let i = 0; i < 50 && (await r.ui.state()).settings.running; i++) await new Promise((res) => setImmediate(res))
	const done = (await r.ui.state()).settings
	assert.strictEqual(done.running, false)
	assert.strictEqual(done.alreadyRight, 1)
	assert.ok(done.missing.length > 5)
	assert.strictEqual(r.calls.filter((a) => a[0] === 'press' && a.includes('^Settings$') && a.includes('button')).length, 0, 'the Settings window was already open: not opened twice')
})
