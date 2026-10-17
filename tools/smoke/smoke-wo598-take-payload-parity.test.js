'use strict'

/**
 * WO-598 C1 — the server-built take payload (src/engine/scene-take-payload.js) must equal the REAL web
 * client builder (client/components/scenes-shared.js buildIncomingScenePayload) for every look, main and
 * PGM-only mode — except `playSeekFrames`, which the server's take engine resolves itself (WO-582).
 *
 * Fixtures: tools/fixtures/projects/*.json (synthetic, in CI). Extra local evidence:
 *   HIGHASCG_PARITY_PROJECTS_DIR=projects node --test tools/smoke/smoke-wo598-take-payload-parity.test.js
 * runs the same check over real show files (not committed — they are the owner's shows).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { buildServerIncomingScene } = require('../../src/engine/scene-take-payload')

const REPO = path.join(__dirname, '..', '..')
const RES = [
	{ w: 3072, h: 1728, fps: 50 },
	{ w: 1920, h: 1080, fps: 50 },
	{ w: 5120, h: 1024, fps: 50 },
]

/** The web builder runs in Node with minimal browser stubs (it only touches sceneState). */
async function loadWebBuilder() {
	globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
	globalThis.window = globalThis
	globalThis.document = globalThis.document || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, querySelector: () => null, querySelectorAll: () => [] }
	const shared = await import(pathToFileURL(path.join(REPO, 'client/components/scenes-shared.js')).href)
	const { sceneState } = await import(pathToFileURL(path.join(REPO, 'client/lib/scene-state.js')).href)
	sceneState.setCanvasResolutions(RES)
	return shared.buildIncomingScenePayload
}

function projectFiles() {
	const dirs = [path.join(REPO, 'tools/fixtures/projects')]
	if (process.env.HIGHASCG_PARITY_PROJECTS_DIR) dirs.push(path.resolve(process.env.HIGHASCG_PARITY_PROJECTS_DIR))
	const out = []
	for (const d of dirs) {
		if (!fs.existsSync(d)) continue
		for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) out.push(path.join(d, f))
	}
	return out
}

function normalize(payload) {
	const p = JSON.parse(JSON.stringify(payload))
	for (const l of p.layers || []) delete l.playSeekFrames
	return p
}

test('WO-598 C1: server take payload == web builder payload (all fixture looks × mains × PGM-only)', async () => {
	const webBuild = await loadWebBuilder()
	const channelMap = { programResolutions: RES }
	let compared = 0
	const mismatches = []
	for (const file of projectFiles()) {
		let project
		try {
			project = JSON.parse(fs.readFileSync(file, 'utf8'))
		} catch {
			continue
		}
		const scenes = project?.scenes?.scenes
		if (!Array.isArray(scenes)) continue
		for (const scene of scenes) {
			const scope = String(scene.mainScope ?? 'all')
			const mains = scope === 'all' ? [0, 1, 2] : [Math.min(2, Math.max(0, parseInt(scope, 10) || 0))]
			for (const mainIdx of mains) {
				for (const pgmOnly of [false, true]) {
					const web = normalize(webBuild(scene, { timeline: null, positionMs: 0, mainIdx, pgmOnly }))
					const srv = normalize(await buildServerIncomingScene(scene, { mainIdx, channelMap, pgmOnly }))
					compared++
					try {
						assert.deepStrictEqual(srv, web)
					} catch (e) {
						mismatches.push(`${path.basename(file)} :: ${scene.name} (main ${mainIdx}, pgmOnly ${pgmOnly}): ${e.message.slice(0, 400)}`)
					}
				}
			}
		}
	}
	assert.ok(compared > 0, 'no looks compared — fixtures missing?')
	assert.deepEqual(mismatches, [], `${mismatches.length}/${compared} payloads differ`)
	console.log(`[parity] ${compared} payloads identical`)
})

test('WO-598 C1: composeCanvas comes from the TARGET main (WO-531), fallback 1920×1080', async () => {
	const scene = { id: 'x', name: 'x', mainScope: 'all', layers: [] }
	const a = await buildServerIncomingScene(scene, { mainIdx: 2, channelMap: { programResolutions: RES } })
	assert.deepEqual(a.composeCanvas, { w: 5120, h: 1024 })
	const b = await buildServerIncomingScene(scene, { mainIdx: 3, channelMap: { programResolutions: RES } })
	assert.deepEqual(b.composeCanvas, { w: 1920, h: 1080 })
	assert.deepEqual(b.defaultTransition, { type: 'CUT', duration: 0, tween: 'linear' })
})

test('WO-598 C1: /api/scene/take-look builds the same take body the web client sends', async () => {
	const { handleTakeLook } = require('../../src/api/routes-scene-take-look')
	const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/fixtures/projects/take-payload-coverage.json'), 'utf8'))
	const byId = Object.fromEntries(fixture.scenes.scenes.map((s) => [s.id, s]))
	const map = { programChannels: [1, 3], previewChannels: [2, 3], programResolutions: RES }
	const sent = []
	const deps = {
		resolveSceneById: (id) => byId[id] || null,
		getChannelMap: () => map,
		withBorder: (scene) => scene,
		take: async (b) => {
			sent.push(b)
			return { status: 200 }
		},
	}
	await handleTakeLook('{"sceneId":"cov-media"}', {}, deps) // main from mainScope '0', PGM
	await handleTakeLook({ sceneId: 'cov-cg', target: 'preview' }, {}, deps) // main 1, PRV staging
	await handleTakeLook({ sceneId: 'cov-cg', forceCut: true }, {}, deps) // main 1 is PGM-only (prv==pgm)
	assert.equal(sent[0].channel, 1)
	assert.equal(sent[0].useServerLive, true)
	assert.equal(sent[0].framerate, 50)
	assert.equal(sent[0].target, undefined)
	assert.equal(sent[0].incomingScene.composeCanvas.w, 3072)
	assert.equal(sent[1].channel, 3)
	assert.equal(sent[1].target, 'preview')
	assert.equal(sent[2].forceCut, true)
	const web = normalize((await loadWebBuilder())(byId['cov-cg'], { mainIdx: 1, pgmOnly: true }))
	assert.deepStrictEqual(normalize(sent[2].incomingScene), web, 'PGM-only main gets the PGM-only payload')
	assert.equal((await handleTakeLook({}, {}, deps)).status, 400)
	assert.equal((await handleTakeLook({ sceneId: 'nope' }, {}, deps)).status, 404)
	assert.equal((await handleTakeLook({ sceneId: 'cov-media', mainIdx: 3 }, {}, deps)).status, 400)
})
