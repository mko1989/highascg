'use strict'

/**
 * WO-731 — the audio operator's page: desk settings, mic → channel, and Accept (mic channel ON, fader raised to the
 * threshold only when it is lower), on an in-memory desk; the routes and the short /audio address.
 * The protocol drivers are tested against emulated desks in smoke-wo731-desk-drivers.test.js.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { normalizeSettings, loadSettings, saveSettings } = require('../../src/audio-desk/desk-store')
const { createDeskService, acceptChannel } = require('../../src/audio-desk/desk-service')
const { handleAudioDesk } = require('../../src/audio-desk/audio-routes')

const REPO = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo731-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** A desk in memory: channels { on, db, name }, with a log of every write. */
function fakeDesk(init = {}) {
	const ch = {}
	for (let i = 1; i <= 32; i++) ch[i] = { on: false, db: -Infinity, name: `Ch ${i}`, ...(init[i] || {}) }
	const writes = []
	return {
		ch,
		writes,
		probe: async () => 'Fake desk',
		getChannel: async (n) => ({ ...ch[n] }),
		setOn: async (n, on) => {
			writes.push(`on ${n} ${on}`)
			ch[n].on = on
		},
		setDb: async (n, db) => {
			writes.push(`db ${n} ${db}`)
			ch[n].db = Math.round(db * 4) / 4 // a quantised fader
		},
		names: async (count) =>
			Object.entries(ch)
				.slice(0, count)
				.map(([n, c]) => ({ channel: Number(n), name: c.name })),
		close: () => {},
	}
}

describe('WO-731 accept rule', () => {
	it('unmutes and raises a fader below the threshold', async () => {
		const d = fakeDesk({ 5: { on: false, db: -20 } })
		const r = await acceptChannel(d, 5, 0)
		assert.equal(r.ok, true)
		assert.deepEqual(d.writes, ['on 5 true', 'db 5 0'])
		assert.deepEqual(r.did, ['unmuted', 'fader -20 → 0 dB'])
	})

	it('never moves a fader already above the threshold', async () => {
		const d = fakeDesk({ 5: { on: false, db: 4.5 } })
		const r = await acceptChannel(d, 5, 0)
		assert.deepEqual(d.writes, ['on 5 true'])
		assert.equal(d.ch[5].db, 4.5)
		assert.equal(r.ok, true)
	})

	it('a fader at the threshold within quantisation is left alone; on + at level → no write', async () => {
		const d = fakeDesk({ 5: { on: true, db: -0.05 } })
		const r = await acceptChannel(d, 5, 0)
		assert.deepEqual(d.writes, [])
		assert.deepEqual(r.did, ['already on at 0 dB'])
	})

	it('-∞ counts as lower; a desk that does not follow is reported, not hidden', async () => {
		const d = fakeDesk({ 5: { on: true, db: -Infinity } })
		d.setDb = async () => {} // the desk ignores the write
		const r = await acceptChannel(d, 5, -5)
		assert.equal(r.ok, false)
		assert.match(r.error, /reads on at -∞ dB/)
	})
})

describe('WO-731 desk settings and the service', () => {
	it('settings keep only valid fields', () => {
		const s = normalizeSettings({
			model: 'x32',
			host: ' 10.0.0.9 ',
			port: 70000,
			threshold_db: -99,
			mics: { 3: 5, 'bad/mic': 2, 4: 0, 7: 33, 8: 32 },
		})
		assert.deepEqual(s, {
			model: 'x32',
			host: '10.0.0.9',
			port: 0,
			midi_channel: 1,
			threshold_db: -60,
			mics: { 3: 5, 8: 32 },
		})
		assert.equal(normalizeSettings({ model: 'nope' }).model, '')
		const f = path.join(tmp, 'desk.json')
		assert.ok(saveSettings({ model: 'yamaha-cl', host: 'mixer.local', mics: { 1: 1 } }, f))
		assert.deepEqual(loadSettings(f), {
			model: 'yamaha-cl',
			host: 'mixer.local',
			port: 0,
			midi_channel: 1,
			threshold_db: 0,
			mics: { 1: 1 },
		})
	})

	it('accept goes mic → channel, records what it did, and refuses unmapped mics', async () => {
		const d = fakeDesk({ 7: { on: false, db: -30 } })
		const made = []
		const svc = createDeskService(null, {
			file: path.join(tmp, 'svc.json'),
			makeDriver: (model, opts) => (made.push([model, opts.host, opts.port]), d),
		})
		assert.equal(svc.view().status.state, 'off')
		assert.equal(svc.setSettings({ model: 'x32', host: '10.0.0.9', threshold_db: -5, mics: { 3: 7 } }).status, 200)
		assert.deepEqual(made, [['x32', '10.0.0.9', 10023]])
		await svc.probe()
		assert.equal(svc.view().status.state, 'ok')
		const ok = await svc.accept({ id: 'p1', name: 'Anna', mic: '3', created: 111 })
		assert.equal(ok.status, 200)
		assert.deepEqual(d.writes, ['on 7 true', 'db 7 -5'])
		assert.equal(svc.view().accepted.p1.channel, 7)
		assert.equal(svc.view().accepted.p1.created, 111, 'ids are reused slots: the page matches created too')
		assert.equal((await svc.accept({ id: 'p2', name: 'Bob', mic: '9' })).status, 409)
		assert.equal((await svc.accept({ id: 'p3', name: 'Cy', mic: '' })).status, 409)
		svc.setSettings({ threshold_db: -2 })
		assert.equal(made.length, 1, 'threshold / mics do not reconnect')
		assert.deepEqual((await svc.channels()).body.channels[6], { channel: 7, name: 'Ch 7' })
	})

	it('a desk that throws is a failed accept and an error status', async () => {
		const d = fakeDesk()
		d.getChannel = async () => {
			throw new Error('no answer from the desk (1500 ms)')
		}
		const svc = createDeskService(null, { file: path.join(tmp, 'svc2.json'), makeDriver: () => d })
		svc.setSettings({ model: 'x32', host: '10.0.0.9', mics: { 1: 1 } })
		const r = await svc.accept({ id: 'p1', name: 'Anna', mic: '1' })
		assert.equal(r.status, 502)
		assert.equal(svc.view().status.state, 'error')
		assert.match(svc.view().accepted.p1.error, /no answer/)
	})
})

describe('WO-731 routes', () => {
	const duties = { has: () => true }
	const call = (desk, presenters, method, p, body) =>
		handleAudioDesk(desk, presenters, { method, path: p, body: body && JSON.stringify(body), duties })

	it('page, desk view/save, channels, accept; other presenter paths are not ours', async () => {
		const d = fakeDesk({ 2: { db: -10 } })
		const svc = createDeskService(null, { file: path.join(tmp, 'routes.json'), makeDriver: () => d })
		const roster = { list: () => [{ id: 'p4', name: 'Dee', mic: '12' }] }
		const page = await call(svc, roster, 'GET', '/api/tracking/presenters/audio')
		assert.equal(page.status, 200)
		assert.match(page.body, /<title>Presenter audio<\/title>/)
		const saved = await call(svc, roster, 'POST', '/api/tracking/presenters/audio/desk', {
			model: 'wing',
			host: '10.0.0.7',
			mics: { 12: 2 },
		})
		assert.equal(JSON.parse(saved.body).settings.mics['12'], 2)
		assert.equal((await call(svc, roster, 'GET', '/api/tracking/presenters/audio/channels')).status, 200)
		const acc = await call(svc, roster, 'POST', '/api/tracking/presenters/p4/accept')
		assert.equal(acc.status, 200)
		assert.deepEqual(d.writes, ['on 2 true', 'db 2 0'])
		assert.equal((await call(svc, roster, 'POST', '/api/tracking/presenters/p9/accept')).status, 404)
		assert.equal(await call(svc, roster, 'GET', '/api/tracking/presenters/p4/photo'), null)
		assert.equal(await call(svc, roster, 'GET', '/api/tracking/presenters'), null)
		const off = await handleAudioDesk(svc, roster, {
			method: 'GET',
			path: '/api/tracking/presenters/audio',
			duties: { has: () => false },
		})
		assert.equal(off.status, 409)
	})

	it('the server wires it and /audio redirects to the page', () => {
		const reg = fs.readFileSync(path.join(REPO, 'src/tracking/register.js'), 'utf8')
		assert.ok(reg.includes('const audio = await handleAudioDesk(_desk, _presenters, { method, path, body })'))
		assert.ok(reg.indexOf('if (audio) return audio') < reg.indexOf('await handlePresenters(_presenters'))
		assert.ok(reg.includes('_desk = createDeskService(ctx)'))
		const http = fs.readFileSync(path.join(REPO, 'src/server/http-server.js'), 'utf8')
		assert.match(http, /reqPathForRouting === '\/audio'[\s\S]{0,200}Location: '\/api\/tracking\/presenters\/audio'/)
		const page = fs.readFileSync(path.join(REPO, 'src/audio-desk/audio-page.html'), 'utf8')
		assert.ok(page.includes('desk.accepted[p.id]?.created === p.created ? desk.accepted[p.id] : null'))
	})
})
