'use strict'

/**
 * WO-1034 smoke — one PGM destination cabled to two GPU jacks, one of them key-only.
 *
 * Before: the generator wrote ONE `<screen>` per destination (the last gpu_out connector won the OS head, the first
 * cable won the flags) and the other jack got no window — owner 11.11: "the key displays but the fill doesnt".
 * Now the first cable keeps `screen_N`, every further jack is an extra head with its own window and its own flags.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { extraOutputsOfScreen, EXTRA_OUTPUT_DEVICE_BASE } = require('../../src/config/config-generator-extra-screens')

function appConfig({ edges }) {
	return {
		casparServer: {
			screen_count: 1,
			caspar_build_profile: 'custom_live',
			screen_1_mode: '1080p5000',
			// physical port keys: port 1 = gpu_p0, port 2 = gpu_p1
			screen_1_key_only: true,
			screen_1_stretch: 'none',
			screen_2_key_only: false,
			screen_2_stretch: 'fill',
		},
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'dst_a', label: 'PGM 1', mainScreenIndex: 0, mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, fps: 50 },
			],
		},
		deviceGraph: {
			version: 1,
			devices: [
				{ id: 'caspar_host', role: 'caspar_host' },
				{ id: 'destinations', role: 'destinations' },
			],
			connectors: [
				{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
				// connector order deliberately differs from cable order
				{ id: 'gpu_p1', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'DP-2' },
				{ id: 'gpu_p0', deviceId: 'caspar_host', kind: 'gpu_out', externalRef: 'DP-0' },
			],
			edges,
		},
	}
}

const twoJacks = [
	{ id: 'e1', sourceId: 'dst_in_dst_a', sinkId: 'gpu_p0' },
	{ id: 'e2', sourceId: 'dst_in_dst_a', sinkId: 'gpu_p1' },
]

const screensOfChannel = (xml, marker) => {
	const from = xml.indexOf(marker)
	const block = xml.slice(from, xml.indexOf('</channel>', from))
	return block.split('<screen>').slice(1)
}

describe('WO-1034 a destination on two GPU jacks', () => {
	it('layout: first cable keeps the screen, the second jack is an extra head beside it', () => {
		const lay = calculateLayoutPositions(buildCasparGeneratorFlatConfig(appConfig({ edges: twoJacks })))
		assert.equal(lay.screens[1].sysId, 'DP-0')
		const extra = Object.values(lay.screenExtra || {})
		assert.equal(extra.length, 1)
		assert.equal(extra[0].sysId, 'DP-2')
		assert.equal(extra[0].extraOfScreen, 1)
		assert.equal(extra[0].connectorId, 'gpu_p1')
		assert.deepEqual([extra[0].width, extra[0].height], [1920, 1080])
		assert.ok(extra[0].x >= lay.screens[1].x + lay.screens[1].width, 'extra head must not overlap the primary')
	})

	it('generator: two windows on the PGM channel, each with its own jack flags and head', () => {
		const flat = buildCasparGeneratorFlatConfig(appConfig({ edges: twoJacks }))
		const extras = extraOutputsOfScreen(flat, 1)
		assert.equal(extras.length, 1)
		assert.equal(extras[0].device, EXTRA_OUTPUT_DEVICE_BASE)
		const screens = screensOfChannel(buildConfigXml(flat), 'Screen 1 program output (PGM)')
		assert.equal(screens.length, 2)
		const [key, fill] = screens
		assert.match(key, /<key-only>true<\/key-only>/)
		assert.match(key, /<x>0<\/x><y>0<\/y>/)
		assert.match(fill, /<key-only>false<\/key-only>/)
		assert.match(fill, /<stretch>fill<\/stretch>/)
		assert.match(fill, new RegExp(`<device>${EXTRA_OUTPUT_DEVICE_BASE}</device>`))
		assert.match(fill, new RegExp(`<x>${extras[0].x}</x><y>0</y>`))
		assert.match(fill, /<width>1920<\/width><height>1080<\/height>/)
		assert.match(fill, /<gpu-texture>true<\/gpu-texture>/)
		// distinct consumer indexes on the one channel: 600 + (key ? 10 : 0) + device − 1
		const dev = (s) => parseInt(/<device>(\d+)<\/device>/.exec(s)[1], 10)
		assert.notEqual(610 + dev(key) - 1, 600 + dev(fill) - 1)
	})

	it('one jack: no extra head, no extra window, no screenExtra key in the layout', () => {
		const flat = buildCasparGeneratorFlatConfig(appConfig({ edges: [twoJacks[0]] }))
		assert.equal(flat.screen_1_extra_outputs, undefined)
		assert.equal('screenExtra' in calculateLayoutPositions(flat), false)
		assert.equal(screensOfChannel(buildConfigXml(flat), 'Screen 1 program output (PGM)').length, 1)
	})

	it('a PRV-half cable (outputLayer 2) is a PRV head, never an extra PGM window', () => {
		const cfg = appConfig({
			edges: [twoJacks[0], { id: 'e2', sourceId: 'dst_in_dst_a', sinkId: 'gpu_p1', note: JSON.stringify({ outputLayer: 2 }) }],
		})
		cfg.screenDestinations.destinations[0].mode = 'pgm_prv'
		const flat = buildCasparGeneratorFlatConfig(cfg)
		assert.equal(flat.screen_1_extra_outputs, undefined)
		assert.equal('screenExtra' in calculateLayoutPositions(flat), false)
	})
})

describe('WO-1034 window placement with two windows on one channel', () => {
	const { parseScreenConsumerRects, pairWindowsWithRects, placeScreenConsumers } = require('../../src/system/screen-consumer-placement')
	const fs = require('node:fs')
	const os = require('node:os')
	const path = require('node:path')
	const xml = buildConfigXml(buildCasparGeneratorFlatConfig(appConfig({ edges: twoJacks })))

	it('reads every <screen> of a channel', () => {
		const rects = parseScreenConsumerRects(xml).filter((r) => r.width === 1920)
		assert.deepEqual(rects.map((r) => r.x), [0, rects[1].x])
		assert.equal(rects[0].channel, rects[1].channel)
		assert.ok(rects[1].x >= 1920)
	})

	it('a window standing on its rect stays; the stray one goes to the free rect', () => {
		const rects = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 2048, y: 0, width: 1920, height: 1080 }]
		const rows = pairWindowsWithRects(rects, [
			{ wid: 'fill', x: 2048, y: 0, width: 1920, height: 1080 },
			{ wid: 'key', x: 900, y: 200, width: 1920, height: 1080 },
		])
		assert.deepEqual(rows.map((r) => r.win.wid), ['key', 'fill'])
		assert.equal(pairWindowsWithRects(rects, [{ wid: 'only', x: 0, y: 0 }])[1].win, null)
		// both stray: creation order (ascending id) follows config order, whatever order the search listed them in
		const stray = pairWindowsWithRects(rects, [
			{ wid: '4194313', x: 500, y: 100, width: 1920, height: 1080 },
			{ wid: '4194311', x: 500, y: 100, width: 1920, height: 1080 },
		])
		assert.deepEqual(stray.map((r) => r.win.wid), ['4194311', '4194313'])
	})

	it('placeScreenConsumers leaves a correctly placed pair alone (it used to pull the fill onto the key jack)', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1034-'))
		const configPath = path.join(dir, 'casparcg.config')
		fs.writeFileSync(configPath, xml)
		const rects = parseScreenConsumerRects(xml)
		const moves = []
		// one window per rect, listed in REVERSE order by the search
		const wins = rects.map((r, i) => ({ wid: String(100 + i), ...r })).reverse()
		const execFileImpl = async (_cmd, args) => {
			if (args[0] === 'search') {
				const ch = parseInt(/\[(\d+)/.exec(args[2].replace(/\\/g, ''))[1], 10)
				return { stdout: wins.filter((w) => w.channel === ch).map((w) => w.wid).join('\n') }
			}
			if (args[0] === 'getwindowgeometry') {
				const w = wins.find((x) => x.wid === args[2])
				return { stdout: `X=${w.x}\nY=${w.y}\nWIDTH=${w.width}\nHEIGHT=${w.height}\n` }
			}
			moves.push(args)
			return { stdout: '' }
		}
		const r = await placeScreenConsumers({ configPath, execFileImpl })
		fs.rmSync(dir, { recursive: true, force: true })
		if (r.skipped) return // sandbox instance
		assert.deepEqual(moves, [])
		assert.equal(r.alreadyCorrect, rects.length)
	})
})
