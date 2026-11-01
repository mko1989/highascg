'use strict'

/**
 * WO-919 — F2 (Server compare lists the LOADED project's channels, not a mirror of the running server), F6 (only a
 * real edit or an explicit save moves savedAt), F26 (the OS layout watchdog's give-up is broadcast + in the state),
 * N3 (Caspar's PRINT scratch still is not a media-list entry).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('WO-919 F2: config comparison expects the loaded project', () => {
	const defaults = require('../../src/config/defaults')
	const { buildConfigXml } = require('../../src/config/config-generator')
	const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
	const { refreshConfigComparison, compareExpectedToServer } = require('../../src/config/config-compare')

	const { clone, addMockGraph, addMainDestinations } = require('./lib/config-generator-routing-fixtures')
	/** A box with `n` main PGM/PRV screen destinations (same builder the Apply path reads). */
	const cfg = (n = 1, mode = '1080p5000') => {
		const app = clone(defaults)
		app.screen_count = n
		app.casparServer = { ...app.casparServer, screen_count: n, screen_1_mode: mode, multiview_enabled: false }
		app.streamingChannel = { ...app.streamingChannel, enabled: false }
		app.rtmp = { ...app.rtmp, enabled: false }
		addMockGraph(app)
		addMainDestinations(app, n)
		return app
	}
	const xmlOf = (c) => buildConfigXml(buildCasparGeneratorFlatConfig(c))
	function ctxFor(config, runningXml) {
		const sent = []
		return {
			config,
			gatheredInfo: { infoConfig: runningXml },
			_wsBroadcast: (type, msg) => sent.push([type, msg]),
			sent,
		}
	}

	it('running == what Apply would write: aligned, no issues', async () => {
		const c = cfg()
		const ctx = ctxFor(c, xmlOf(c))
		await refreshConfigComparison(ctx)
		assert.ok(ctx._configComparison.serverChannelCount >= 2, 'the fixture really has channels')
		assert.equal(ctx._configComparison.aligned, true)
		assert.deepEqual(ctx._configComparison.issues, [])
		assert.equal(ctx._configComparison.moduleChannels[0].source, 'project')
		assert.ok(ctx.sent.some(([t, m]) => t === 'change' && m.path === 'configComparison'))
	})

	it('the loaded project changes the layout while Caspar still runs the old one: a mismatch is reported', async () => {
		const running = cfg(1)
		const loaded = cfg(2)
		const ctx = ctxFor(loaded, xmlOf(running))
		await refreshConfigComparison(ctx)
		const cc = ctx._configComparison
		assert.equal(cc.aligned, false, 'not "matches"')
		assert.ok(cc.issues.length > 0)
		assert.ok(cc.moduleChannelCount > cc.serverChannelCount, 'the project (2 screens) expects more channels than Caspar runs (1)')
		assert.match(cc.issues[0], /Channel count: server \d+ vs loaded project \d+/)
		assert.notDeepEqual(cc.moduleChannels.map((m) => m.index), [], 'expects column is the project, not empty')
		assert.ok(cc.moduleChannels.every((m) => m.source === 'project'), 'never the server mirror')
	})

	it('compareExpectedToServer: mode, screen and DeckLink output differences, and the count', () => {
		const s = [
			{ index: 1, videoMode: '1080p5000', hasScreen: false, hasDecklinkOutput: false },
			{ index: 2, videoMode: '1080p5000', hasScreen: true, hasDecklinkOutput: false },
		]
		assert.deepEqual(compareExpectedToServer(s, s), [])
		const m = [
			{ index: 1, videoMode: '3840x1792', hasScreen: false, hasDecklinkOutput: false },
			{ index: 2, videoMode: '1080p5000', hasScreen: false, hasDecklinkOutput: true },
			{ index: 3, videoMode: '1080p5000', hasScreen: false, hasDecklinkOutput: false },
		]
		const issues = compareExpectedToServer(s, m)
		assert.equal(issues.length, 4)
		assert.match(issues[0], /Channel count: server 2 vs loaded project 3/)
		assert.match(issues[1], /Ch 1: server "1080p5000" ≠ project "3840x1792"/)
		assert.match(issues.join('\n'), /Ch 2: Caspar screen output is on, the project expects off/)
		assert.match(issues.join('\n'), /DeckLink output is off, the project expects on/)
	})

	it('a project activation recomputes it (source)', () => {
		const src = read('src/engine/project-activate.js')
		assert.ok(src.includes("require('../config/" + "config-compare').refreshConfigComparison(ctx)"))
		assert.ok(src.indexOf('refreshConfigComparison(ctx)') > src.indexOf('const afterSig'))
	})
})

describe('WO-919 F6: only real edits and explicit saves move savedAt', () => {
	const S = require('../../src/engine/project-scenes')
	const mkCtx = () => ({ persistence: require('../../src/utils/persistence'), config: {}, log: () => {} })
	const look = (id) => ({ id, name: id, layers: [] })
	const OLD = '2026-01-01T00:00:00Z'
	const base = (name, extra = {}) => ({ version: 2, name, savedAt: OLD, scenes: { scenes: [look('a'), look('b')] }, ...extra })

	it('showContentEquals ignores the server-stamped slices only', () => {
		const a = base('X', { hardwareConfig: { v: 1 }, channelScheme: 'operator-first', rev: 3 })
		assert.equal(S.showContentEquals(a, { ...a, hardwareConfig: { v: 2 }, channelScheme: 'legacy', rev: 9, savedAt: 'later' }), true)
		assert.equal(S.showContentEquals(a, { ...a, name: 'Y' }), false)
		assert.equal(S.showContentEquals(a, { ...a, scenes: { scenes: [look('a')] } }), false)
		// the web client exports keys in another order than the stored file — not an edit (every web boot re-stamped)
		const reordered = { scenes: { scenes: [{ layers: [], name: 'a', id: 'a' }, { layers: [], name: 'b', id: 'b' }] }, name: 'X', version: 2 }
		assert.equal(S.showContentEquals(a, reordered), true)
		assert.equal(S.showContentEquals(a, { ...reordered, scenes: { scenes: [look('b'), look('a')] } }), false, 'look order is content')
	})

	it('a hardwareConfig-only re-stamp (Apply / load) keeps the stored savedAt; a look edit moves it', () => {
		const ctx = mkCtx()
		S.persistProject(ctx, base('Wo919Stamp', { hardwareConfig: { v: 1 } }), { writeAutosave: true })
		const stored = require('../../src/engine/project-store').readProjectFile('wo919stamp')
		assert.equal(stored.savedAt, OLD, 'first write of a project takes the incoming stamp')
		const NEW = '2026-11-01T12:00:00Z'
		S.persistProject(ctx, base('Wo919Stamp', { hardwareConfig: { v: 2 }, savedAt: NEW }), { writeAutosave: true })
		const after = require('../../src/engine/project-store').readProjectFile('wo919stamp')
		assert.deepEqual(after.hardwareConfig, { v: 2 }, 'the new hardware slice IS written')
		assert.equal(after.savedAt, OLD, 'but "Saved" does not move')
		assert.ok(after.rev > stored.rev, 'rev still bumps (stale checks)')
		const edited = base('Wo919Stamp', { hardwareConfig: { v: 2 }, savedAt: NEW, scenes: { scenes: [look('a'), look('b'), look('c')] } })
		S.persistProject(ctx, edited, { writeAutosave: true })
		assert.equal(require('../../src/engine/project-store').readProjectFile('wo919stamp').savedAt, NEW, 'a real edit stamps')
	})

	it('an explicit save (userSave) stamps even when nothing changed but the hardware', () => {
		const ctx = mkCtx()
		S.persistProject(ctx, base('Wo919Save', { hardwareConfig: { v: 1 } }), { writeAutosave: true })
		const NEW = '2026-11-01T13:00:00Z'
		S.persistProject(ctx, base('Wo919Save', { hardwareConfig: { v: 2 }, savedAt: NEW }), { writeAutosave: true, userSave: true })
		assert.equal(require('../../src/engine/project-store').readProjectFile('wo919save').savedAt, NEW)
		assert.ok(read('src/api/routes-data-project-handlers.js').includes('{ writeAutosave: true, userSave: true }'), '/api/project/save passes userSave')
	})

	it('the stale checks still read savedAt/rev as before', () => {
		const src = read('src/engine/project-scenes.js')
		assert.ok(src.includes("reason: revBased ? 'stale_rev' : 'stale_saved_at'"))
		assert.ok(src.includes('stamped.rev = Math.max(storedRev, projectRevOf(stamped) || 0) + 1'))
	})
})

describe('WO-919 F26: the OS layout give-up reaches the GUI', () => {
	const { reportOsLayoutIssue, clearOsLayoutIssue } = require('../../src/bootstrap/os-layout-issue')

	it('report stores the issue on ctx and broadcasts change osLayout; clear takes it back', () => {
		const sent = []
		const ctx = { _wsBroadcast: (t, m) => sent.push([t, m]) }
		const issue = reportOsLayoutIssue(ctx, { mismatches: [{ sysId: 'DP-6', field: 'x', expected: 0, actual: 1920 }] }, 12)
		assert.equal(ctx._osLayoutIssue, issue)
		assert.deepEqual(sent[0][1].path, 'osLayout')
		assert.equal(sent[0][1].value.ok, false)
		assert.deepEqual(sent[0][1].value.mismatches[0], { sysId: 'DP-6', field: 'x', expected: '0', actual: '1920' })
		assert.equal(sent[0][1].value.attempts, 12)
		assert.equal(clearOsLayoutIssue(ctx), true)
		assert.equal(ctx._osLayoutIssue, null)
		assert.deepEqual(sent[1][1], { path: 'osLayout', value: { ok: true, at: sent[1][1].value.at } })
		assert.equal(clearOsLayoutIssue(ctx), false, 'nothing to clear: no second broadcast')
		assert.equal(sent.length, 2)
	})

	it('a broadcast-less ctx and an empty check do not throw; mismatches are capped', () => {
		const issue = reportOsLayoutIssue({}, undefined, 3)
		assert.deepEqual(issue.mismatches, [])
		const many = Array.from({ length: 20 }, (_, i) => ({ sysId: `DP-${i}`, field: 'x' }))
		assert.equal(reportOsLayoutIssue({}, { mismatches: many }, 12).mismatches.length, 6)
	})

	it('wired: watchdog give-up reports, state carries osLayout, a good Apply clears it (source)', () => {
		const wd = read('src/bootstrap/os-layout-watchdog.js')
		const giveUp = wd.indexOf('Layout still wrong after')
		assert.ok(giveUp > 0 && wd.indexOf('reportOsLayoutIssue(ctx,', giveUp) > giveUp)
		assert.ok(read('src/api/get-state.js').includes('osLayout: ctx._osLayoutIssue || null'))
		const apply = read('src/api/routes-caspar-config.js')
		assert.ok(apply.includes("fullApply.layoutOk !== false) require('../bootstrap/" + "os-layout-issue').clearOsLayoutIssue(ctx)"))
	})
})

describe('WO-919 N3: PRINT scratch stills are not media entries', () => {
	const { isPrintScratchStill } = require('../../src/api/media-catalog')

	it('exact PRINT name at the media root only', () => {
		assert.equal(isPrintScratchStill('20261101T115540'), true, 'CLS lists it without the extension')
		assert.equal(isPrintScratchStill('20261101T115540.png'), true, 'disk scan lists it with it')
		assert.equal(isPrintScratchStill('shows/20261101T115540.png'), false, 'a file in a folder is the operator\'s')
		assert.equal(isPrintScratchStill('20261101T115540.mp4'), false)
		assert.equal(isPrintScratchStill('20261101T115540_logo.png'), false)
		assert.equal(isPrintScratchStill('logo.png'), false)
		assert.equal(isPrintScratchStill(undefined), false)
	})

	it('agrees with the capture code that deletes them, and both catalog sources are filtered (source)', () => {
		assert.ok(read('src/media/live-thumbnail-cache-capture.js').includes('/^\\d{8}T\\d{6}\\.png$/i.test(basename)'))
		const src = read('src/api/media-catalog.js')
		assert.ok(src.includes('!isHiddenThumbnailBucket(m?.id) && !isPrintScratchStill(m?.id)'), 'CLS rows')
		assert.ok(src.includes('isHiddenThumbnailBucket(item?.id) || isPrintScratchStill(item?.id)'), 'disk-scan rows')
	})
})
