'use strict'

/**
 * WO-1035 smoke — the read-only PixelHue layer view, against a fake switcher (no network).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { makeToken, createPixelhueReader } = require('../../src/pixelhue/pixelhue-read')
const { handleSetConfig, handleLayers } = require('../../src/api/routes-pixelhue')

const layer = (screenId, sceneType, zorder, name, win, source) => ({
	layerId: 1000 + zorder,
	general: { name },
	layerIdObj: { attachScreenId: screenId, sceneType, type: 2 },
	enable: 1,
	opacity: 100,
	zorder,
	window: win,
	source: { general: { sourceName: source, sourceType: 2, sourceId: 5 } },
})

/** A switcher behind a control PC: discovery on .15 names the device on .7:8089; a restart changes startTime. */
function fakeSwitcher() {
	const state = { startTime: 1111, calls: [] }
	const get = async (url, headers = {}) => {
		state.calls.push(url)
		if (url === 'https://10.0.0.15:19998/unico/v1/ucenter/device-list') {
			return { code: 0, data: { list: [{ ip: '10.0.0.7', protocols: [{ port: 8089, linkType: 'http' }] }] } }
		}
		if (url === 'http://10.0.0.7:8089/unico/v1/node/open-detail') return { code: 0, data: { sn: 'SN1', startTime: state.startTime } }
		if (headers.Authorization !== makeToken('SN1', state.startTime)) return { code: 401, message: 'token' }
		if (url.endsWith('/unico/v1/screen/list-detail')) {
			return {
				code: 0,
				data: { list: [{ screenId: 1, enable: 1, general: { name: 'Screen 1' }, mosaic: { window: { width: 3072, height: 1024 } } }] },
			}
		}
		if (url.endsWith('/unico/v1/layers/list-detail')) {
			return {
				code: 0,
				data: {
					list: [
						layer(1, 2, 3, 'PIP', { x: 2000, y: 100, width: 800, height: 450 }, 'Input 7'),
						layer(1, 2, 1, 'BG', { x: 0, y: 0, width: 3072, height: 1024 }, 'Input 3'),
						layer(1, 4, 1, 'Next', { x: 10, y: 20, width: 30, height: 40 }, 'Input 8'),
					],
				},
			}
		}
		throw new Error(`unexpected ${url}`)
	}
	return { state, get }
}

describe('WO-1035 PixelHue layer read', () => {
	it('token: HS256 over { SN } with String(startTime), no iat', () => {
		const [h, p, s] = makeToken('SN1', 1111).split('.')
		assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString()), { SN: 'SN1' })
		assert.equal(s, crypto.createHmac('sha256', '1111').update(`${h}.${p}`).digest('base64url'))
	})

	it('discovers the device, reads screens with layers bottom-first in screen pixels', async () => {
		const sw = fakeSwitcher()
		const snap = await createPixelhueReader('10.0.0.15', { get: sw.get }).read()
		assert.deepEqual(snap.device, { ip: '10.0.0.7', port: 8089 })
		const s = snap.screens[0]
		assert.deepEqual([s.screenId, s.name, s.width, s.height], [1, 'Screen 1', 3072, 1024])
		assert.deepEqual(s.layers.map((l) => `${l.scene}:${l.name}`), ['pgm:BG', 'pvw:Next', 'pgm:PIP'])
		const pip = s.layers[2]
		assert.deepEqual([pip.x, pip.y, pip.width, pip.height, pip.zorder, pip.source], [2000, 100, 800, 450, 3, 'Input 7'])
		// the same rectangle as a look-layer fill (fractions of the 3072x1024 screen)
		assert.deepEqual(pip.fill, { x: 0.651042, y: 0.097656, scaleX: 0.260417, scaleY: 0.439453 })
		assert.deepEqual(s.layers[0].fill, { x: 0, y: 0, scaleX: 1, scaleY: 1 })
		assert.deepEqual([s.x, s.y, s.pgmLocked], [0, 0, false])
	})

	it('as pixelhue-studio: a screen origin makes layers screen-relative; Cut & Fill fill is a normal layer; sources list', () => {
		const { normalize, normalizeSources } = require('../../src/pixelhue/pixelhue-read')
		const screens = { data: { list: [{ screenId: 1, enable: 1, pgmEdit: 0, screenIdObj: { type: 2 }, general: { name: 'Wall' }, mosaic: { window: { x: 4000, y: 100, width: 2000, height: 1000 } } }] } }
		const mk = (type, win) => ({ ...layer(1, 2, 1, 'L', win, 'In'), layerIdObj: { attachScreenId: 1, sceneType: 2, type } })
		const out = normalize(screens, { data: { list: [mk(256, { x: 4500, y: 350, width: 500, height: 250 }), mk(128, { x: 4000, y: 100, width: 64, height: 64 })] } })[0]
		assert.deepEqual([out.x, out.y, out.pgmLocked], [4000, 100, true])
		const fillLayer = out.layers.find((l) => l.cutFill)
		assert.deepEqual([fillLayer.type, fillLayer.x, fillLayer.y, fillLayer.fill], ['normal', 500, 250, { x: 0.25, y: 0.25, scaleX: 0.25, scaleY: 0.25 }])
		assert.equal(out.layers.find((l) => !l.cutFill).type, 'cut')
		const iface = (id, state, extra = {}) => ({ interfaceId: id, state, general: { name: `Input ${id}` }, auxiliaryInfo: { online: 1, connectorInfo: { interfaceType: 2, type: 8, workMode: 0, ...extra } } })
		const src = normalizeSources({ data: { list: [iface(5, 0), iface(9, 1), iface(7, 1, { workMode: 2 }), iface(3, 1, { interfaceType: 3 })] } }, screens)
		assert.deepEqual(src.map((x) => [x.id, x.type, x.name, x.connected]), [[9, 2, 'Input 9', true], [5, 2, 'Input 5', false], [1, 3, 'Wall PGM', true], [1, 4, 'Wall PVW', true]])
	})

	it('reads inside the cache window share one round trip; a switcher restart re-authenticates once', async () => {
		const sw = fakeSwitcher()
		let t = 0
		const reader = createPixelhueReader('10.0.0.15', { get: sw.get, now: () => t })
		await Promise.all([reader.read(), reader.read()])
		await reader.read()
		const n = sw.state.calls.length
		assert.equal(sw.state.calls.filter((u) => u.endsWith('layers/list-detail')).length, 1)
		sw.state.startTime = 2222 // restart: the old token is refused
		t = 10_000
		const snap = await reader.read()
		assert.equal(snap.screens[0].layers.length, 3)
		assert.equal(sw.state.calls.slice(n).filter((u) => u.endsWith('open-detail')).length, 1)
	})

	it('route: no address → 409; address set → filtered layers; a dead switcher → 502, never a throw', async () => {
		const storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo1035-')), 'pixelhue.json')
		const sw = fakeSwitcher()
		const deps = { storePath, createReader: (host) => createPixelhueReader(host, { get: sw.get }) }
		assert.equal((await handleLayers({}, deps)).status, 409)
		assert.equal(handleSetConfig(JSON.stringify({ host: 'http://x/' }), deps).status, 400)
		assert.equal(handleSetConfig(JSON.stringify({ host: '10.0.0.15' }), deps).status, 200)
		const r = await handleLayers({ screen: '1', scene: 'pgm' }, deps)
		assert.equal(r.status, 200)
		assert.deepEqual(JSON.parse(r.body).screens[0].layers.map((l) => l.name), ['BG', 'PIP'])
		assert.equal(JSON.parse((await handleLayers({ screen: '9' }, deps)).body).screens.length, 0)
		handleSetConfig(JSON.stringify({ host: '10.0.0.99' }), deps)
		const dead = { storePath, createReader: (host) => createPixelhueReader(host, { get: async () => { throw new Error('ECONNREFUSED') } }) }
		assert.equal((await handleLayers({}, dead)).status, 502)
		fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
	})

	it('WO-1042: discovery listing several switchers → the one at the host address, never simply the first', async () => {
		const list = [
			{ ip: '10.0.0.11', protocols: [{ port: 8088, linkType: 'http' }] },
			{ ip: '10.0.0.254', protocols: [{ port: 8090, linkType: 'http' }] },
		]
		const seen = []
		const get = (opens) => async (url) => {
			seen.push(url)
			if (url.endsWith('/ucenter/device-list')) return { code: 0, data: { list } }
			if (url.endsWith('/node/open-detail')) return opens(url)
			return { code: 0, data: { list: [] } }
		}
		const ok = async () => ({ code: 0, data: { sn: 'SN', startTime: 1 } })
		const snap = await createPixelhueReader('10.0.0.254', { get: get(ok) }).read()
		assert.deepEqual(snap.device, { ip: '10.0.0.254', port: 8090 })
		assert.ok(!seen.some((u) => u.includes('10.0.0.11')), 'the other switcher is never asked')
		await assert.rejects(createPixelhueReader('10.0.0.15', { get: get(ok) }).read(), /lists 2 switchers \(10\.0\.0\.11, 10\.0\.0\.254\)/)
	})
})
