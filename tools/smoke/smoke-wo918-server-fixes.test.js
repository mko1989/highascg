'use strict'

/**
 * WO-918 server fixes: F25 (still-image INFO `<file><path>` resolves to a clip id), F22 (media usage / rename
 * agree with playback: project-scoped file when it exists, else the media root), F3 (Apply reports `layoutOk`
 * and a message that never claims "layout applied" for a failed/unverified layout). Temp dirs only.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wo918-home-')) // the apply tail writes $HOME/.config/highascg/caspar-env

const ROOT = path.join(__dirname, '..', '..')
const { parseLayerFgClipsFromChannelXml, pathsMatch } = require('../../src/state/live-scene-reconcile')
const { findProjectMediaUsage, rewriteProjectMediaRefs, projectReferencedFiles } = require('../../src/media/media-reference-rewrite')

const stillXml = (p) => `<?xml version="1.0" encoding="utf-8"?>
<channel><framerate>25</framerate><stage><layer>
<layer_10><foreground><file><path>${p}</path></file><paused>false</paused><producer>image</producer></foreground><background/></layer_10>
</layer></stage></channel>`

describe('WO-918 F25: still image INFO xml', () => {
	it('relative media/ path -> clip id comparable with the stored look value', async () => {
		const out = await parseLayerFgClipsFromChannelXml(stillXml('media/20261031T121932.png'))
		assert.equal(out['10'], '20261031T121932.png')
		assert.equal(pathsMatch('20261031T121932.png', out['10']), true)
		assert.equal(pathsMatch('projects/demo/20261031T121932.png', out['10']), true)
	})

	it('project subfolder and absolute media paths keep the media-root-relative part', async () => {
		assert.equal((await parseLayerFgClipsFromChannelXml(stillXml('media/projects/demo/a b.png')))['10'], 'projects/demo/a b.png')
		assert.equal((await parseLayerFgClipsFromChannelXml(stillXml('/home/casparcg/highascg/media/x/y.jpg')))['10'], 'x/y.jpg')
		assert.equal((await parseLayerFgClipsFromChannelXml(stillXml('C:\\caspar\\Media\\z.png')))['10'], 'z.png')
	})

	it('a different still does NOT match; <name> and <clip> shapes still win over <path>', async () => {
		const out = await parseLayerFgClipsFromChannelXml(stillXml('media/other.png'))
		assert.equal(pathsMatch('20261031T121932.png', out['10']), false)
		const named = stillXml('media/x.png').replace('<path>', '<name>BRIDGE/CLIP</name><path>')
		assert.equal((await parseLayerFgClipsFromChannelXml(named))['10'], 'BRIDGE/CLIP')
		const clip = stillXml('media/x.png').replace('<path>', '<clip>OLD/CLIP</clip><path>')
		assert.equal((await parseLayerFgClipsFromChannelXml(clip))['10'], 'OLD/CLIP')
	})
})

describe('WO-918 F22: media usage follows playback resolution (project file first, else media root)', () => {
	let tmp
	let config
	const proj = (value) => ({ scenes: { scenes: [{ id: 's1', name: 'Look', layers: [{ source: { type: 'media', value } }] }] } })
	const touch = (rel) => {
		fs.mkdirSync(path.dirname(path.join(tmp, 'media', rel)), { recursive: true })
		fs.writeFileSync(path.join(tmp, 'media', rel), 'x')
	}
	before(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo918-media-'))
		fs.mkdirSync(path.join(tmp, 'media'), { recursive: true })
		config = { local_media_path: path.join(tmp, 'media') }
		touch('root.png')
		touch('both.png')
		touch('projects/demo/both.png')
		touch('projects/demo/inproj.png')
		touch('projects/demo/sub/deep.mov')
	})
	after(() => fs.rmSync(tmp, { recursive: true, force: true }))

	it('a bare id that exists only at the media root is used by the root file', () => {
		assert.deepEqual(findProjectMediaUsage(proj('root.png'), 'demo', 'root.png', config).map((r) => r.count), [1])
		assert.deepEqual(findProjectMediaUsage(proj('root.png'), 'demo', 'projects/demo/root.png', config), [])
	})

	it('when the project copy exists it wins (as in playback); the root twin is unused', () => {
		assert.equal(findProjectMediaUsage(proj('both.png'), 'demo', 'projects/demo/both.png', config).length, 1)
		assert.equal(findProjectMediaUsage(proj('both.png'), 'demo', 'both.png', config).length, 0)
		assert.equal(findProjectMediaUsage(proj('inproj.png'), 'demo', 'projects/demo/inproj.png', config).length, 1)
	})

	it('neither on disk: legacy project-scoped reading; pathed project-relative value resolves too', () => {
		assert.equal(findProjectMediaUsage(proj('ghost.png'), 'demo', 'projects/demo/ghost.png', config).length, 1)
		assert.equal(findProjectMediaUsage(proj('sub/deep.mov'), 'demo', 'projects/demo/sub/deep.mov', config).length, 1)
		assert.equal(findProjectMediaUsage(proj('sub/deep.mov'), 'demo', 'sub/deep.mov', config).length, 0)
	})

	it('renaming a root file rewrites the bare ref (the file already moved on disk)', () => {
		touch('renamed.png') // post-move state: root.png is gone from the pre-move point of view only via the rename list
		const { project, changed } = rewriteProjectMediaRefs(proj('root.png'), 'demo', [{ from: 'root.png', to: 'renamed.png' }], config)
		assert.equal(changed, 1)
		assert.equal(project.scenes.scenes[0].layers[0].source.value, 'renamed.png')
	})

	it('moving a project file out of its folder: the bare ref follows even though the old file is gone', () => {
		const p = rewriteProjectMediaRefs(proj('gone.png'), 'demo', [{ from: 'projects/demo/gone.png', to: 'projects/demo/sub/gone.png' }], config)
		assert.equal(p.changed, 1)
		assert.equal(p.project.scenes.scenes[0].layers[0].source.value, 'sub/gone.png')
	})

	it('a rename of the root twin leaves a ref that plays the project copy alone', () => {
		const { changed } = rewriteProjectMediaRefs(proj('both.png'), 'demo', [{ from: 'both.png', to: 'both2.png' }], config)
		assert.equal(changed, 0)
	})

	it('gather: the catalog root file is the referenced file', () => {
		assert.deepEqual(projectReferencedFiles(proj('root.png'), 'demo', ['root.png', 'other.png'], config), ['root.png'])
		assert.deepEqual(projectReferencedFiles(proj('inproj.png'), 'demo', ['projects/demo/inproj.png', 'inproj.png'], config), ['projects/demo/inproj.png'])
	})
})

describe('WO-918 F3: Apply reports the layout honestly', () => {
	async function apply({ needsNodm = false, applied = true, verify = { ok: true, mismatches: [] }, noHeads = false, skipCasparRestart = false } = {}) {
		const mocks = {
			'/os-config': {
				applyX11Layout: (config, opts = {}) =>
					opts.live === false
						? { applied: false, persisted: !noHeads, xrandrCommand: noHeads ? null : 'xrandr --mock' }
						: { applied, persisted: false, xrandrCommand: noHeads ? null : 'xrandr --mock', verify: applied ? verify : null },
				restartDisplayManager: () => true,
			},
			'/display-stable-wait': { waitForDisplayStable: async () => ({ ok: true }) },
			'/caspar-restart': {
				killStuckCasparMainProcess: async () => true,
				isAmcpTcpConnected: () => false,
				waitForAmcpDisconnect: async () => true,
				reloadCasparAfterConfigWrite: async () => ({ attempted: true, restartSent: true, reconnected: true }),
			},
			'/xrandr-layout-verify': {
				verifyXrandrMatchesLayout: () => ({ ok: true }),
				needsNodmRestartForLayout: () => ({
					needed: needsNodm,
					plannedCanvas: { width: 3840, height: 1080 },
					currentCanvas: { width: 3840, height: 1080 },
					reason: noHeads ? 'no_planned_heads' : needsNodm ? 'canvas_expansion' : 'canvas_fits',
				}),
			},
			'/x-display-session': { applyOperatorDisplaySession: async () => {}, displaySessionEnv: () => ({}) },
			'/nvidia-display-policy': { applyNvidiaDisplayPolicy: async () => ({ ok: true }) },
			'/caspar-gl-sync-env': { writeCasparGlSyncEnvFile: () => {} },
		}
		const abs = require.resolve(path.join(ROOT, 'src/utils/full-config-apply.js'))
		const orig = Module._load
		Module._load = function (request) {
			for (const [suffix, value] of Object.entries(mocks)) if (request.endsWith(suffix)) return value
			return orig.apply(this, arguments)
		}
		try {
			delete require.cache[abs]
			return await require(abs).applyFullServerConfig(
				{ config: { screen_count: 1 }, amcp: {} },
				{ log: () => {}, force: true, skipCasparRestart, writeCasparConfig: async () => ({ ok: true, changed: true, path: '/tmp/x.config' }) },
			)
		} finally {
			Module._load = orig
			delete require.cache[abs]
		}
	}

	for (const needsNodm of [false, true]) {
		const tag = needsNodm ? 'nodm path' : 'canvas-fits path'
		it(`${tag}: applied + verified -> layoutOk true, "layout applied"`, async () => {
			const res = await apply({ needsNodm })
			assert.equal(res.ok, true)
			assert.equal(res.layoutOk, true)
			assert.equal(res.layoutProblem, undefined)
			assert.match(res.message, /layout applied/)
			assert.match(res.message, /Caspar restarted/)
		})

		it(`${tag}: xrandr failed -> layoutOk false, never says "layout applied", ok unchanged`, async () => {
			const res = await apply({ needsNodm, applied: false })
			assert.equal(res.ok, true, 'ok semantics unchanged')
			assert.equal(res.layoutOk, false)
			assert.match(res.layoutProblem, /NOT applied/)
			assert.doesNotMatch(res.message, /layout applied/)
			assert.match(res.message, /layout NOT applied/)
		})

		it(`${tag}: verify mismatch -> layoutOk false with the mismatch in the problem`, async () => {
			const res = await apply({ needsNodm, verify: { ok: false, mismatches: [{ sysId: 'DP-0+DP-6', field: 'overlap' }] } })
			assert.equal(res.layoutOk, false)
			assert.match(res.layoutProblem, /DP-0\+DP-6 overlap/)
			assert.doesNotMatch(res.message, /layout applied(?! but)/)
			assert.match(res.message, /NOT verified/)
		})
	}

	it('no GPU heads: nothing to apply -> layoutOk true', async () => {
		const res = await apply({ noHeads: true })
		assert.equal(res.layoutOk, true)
		assert.equal(res.message, 'Config written; Caspar restarted.')
	})

	it('skipCasparRestart keeps the honesty', async () => {
		const bad = await apply({ applied: false, skipCasparRestart: true })
		assert.equal(bad.layoutOk, false)
		assert.doesNotMatch(bad.message, /layout applied/)
		assert.match(bad.message, /Caspar restart skipped/)
		const good = await apply({ skipCasparRestart: true })
		assert.equal(good.message, 'Config written; layout applied; Caspar restart skipped.')
	})

	it('early failures report layoutOk false', async () => {
		const abs = require.resolve(path.join(ROOT, 'src/utils/full-config-apply.js'))
		delete require.cache[abs]
		const res = await require(abs).applyFullServerConfig({ config: {} }, { writeCasparConfig: async () => ({ ok: false, error: 'boom' }) })
		delete require.cache[abs]
		assert.equal(res.ok, false)
		assert.equal(res.layoutOk, false)
		assert.match(res.layoutProblem, /not applied/)
	})
})
