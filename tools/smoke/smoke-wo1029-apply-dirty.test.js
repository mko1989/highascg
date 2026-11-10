'use strict'

/**
 * WO-1029 — "does this box need the Apply?" decided by the server (GET /api/caspar-config/dirty), the snapshot never
 * blocking the Apply, and one owner of the restore per Caspar connect (WO-1013 never runs twice).
 *   src/config/caspar-config-dirty.js, src/engine/air-snapshot-apply.js, src/bootstrap/caspar-info-ready.js
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { memPersistence } = require('./lib/wo1029-apply-fixtures')
const D = require('../../src/config/caspar-config-dirty')
const AirApply = require('../../src/engine/air-snapshot-apply')
const Air = require('../../src/engine/air-snapshot')

/** A box: `ctx.config.cables` stands for the cabling the generated XML is built from; `disk` is casparcg.config. */
function box(persistence = memPersistence()) {
	const files = { '/cfg/casparcg.config': '<config cables="A"/>' }
	const deps = {
		persistence,
		generatedXml: (c) => `<config cables="${c.config.cables}"/>`,
		configPath: () => '/cfg/casparcg.config',
		readFile: (p) => (p in files ? files[p] : null),
		now: () => 42,
	}
	const ctx = { config: { cables: 'A' }, amcp: { isConnected: true } }
	D.rememberConfigAtConnect(ctx, deps)
	const ask = () => D.casparConfigDirty(ctx, { deps })
	const apply = () => {
		files['/cfg/casparcg.config'] = deps.generatedXml(ctx) // write
		D.rememberConfigAtConnect(ctx, deps) // Caspar restarted and read it
		D.clearRestartPending(ctx, deps)
	}
	return { ctx, deps, files, ask, apply, persistence }
}

describe('WO-1029 GET /api/caspar-config/dirty', () => {
	it('clean box → false', () => {
		const b = box()
		assert.deepEqual(b.ask(), { dirty: false, reasons: [], generatedAt: 42, caspar_connected: true })
	})

	it('a cable change → true, for every client that asks, and across a node restart; cleared after the apply', () => {
		const b = box()
		b.ctx.config.cables = 'B' // cable click: casparServer keys saved, XML not written (restart deferred)
		b.ctx.casparApplyPending = true
		const first = b.ask()
		assert.equal(first.dirty, true)
		assert.deepEqual(first.reasons.map((r) => r.code), ['unwritten', 'pending'])
		assert.deepEqual(b.ask().reasons, first.reasons, 'another client asking gets the same answer')
		const after = { config: { cables: 'B' }, amcp: { isConnected: true } } // node restarted: the in-memory flag is gone
		assert.ok(D.casparConfigDirty(after, { deps: b.deps }).reasons.some((r) => r.code === 'pending'), 'remembered on disk')
		b.apply()
		assert.equal(b.ask().dirty, false)
		assert.equal(b.ctx.casparApplyPending, false)
	})

	it('config written but Caspar not restarted → not_restarted', () => {
		const b = box()
		b.ctx.config.cables = 'C'
		b.files['/cfg/casparcg.config'] = '<config cables="C"/>'
		assert.deepEqual(b.ask().reasons.map((r) => r.code), ['not_restarted'])
	})

	it('runtime consumers (stream / record / meter / compose added over AMCP) never make it dirty', () => {
		const b = box()
		b.ctx.gatheredInfo = { channelXml: { 1: '<channel><output><port_96><type>ffmpeg</type></port_96><port_701><type>file</type></port_701></output></channel>' } }
		b.ctx.streamingChannelRtmp = { active: true }
		b.ctx._configComparison = { serverConfigDriven: true, aligned: true, issues: [] }
		assert.equal(b.ask().dirty, false)
		b.ctx._configComparison = { serverConfigDriven: true, aligned: false, issues: ['Ch 1: server "1080p5000" ≠ project "2160p5000"'] }
		assert.deepEqual(b.ask().reasons.map((r) => r.code), ['running_differs'], 'a real running-config difference still counts')
	})

	it('wired: route registered, apply clears / records the pending state', () => {
		const router = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
		assert.match(router, /routes\.get\('\/api\/caspar-config\/dirty'/)
		const routes = fs.readFileSync(path.join(__dirname, '../../src/api/routes-caspar-config.js'), 'utf8')
		assert.match(routes, /p === '\/api\/caspar-config\/dirty'/)
		assert.match(routes, /clearRestartPending\(ctx\)/)
		assert.match(routes, /markRestartPending\(ctx, 'config written, restart skipped'\)/)
	})
})

describe('WO-1029 the snapshot never blocks the Apply', () => {
	it('snapshot failure → apply still runs; answer restored: null with the reason', async () => {
		const p = memPersistence({ [Air.KEY]: { v: 1, id: 'old', taken_at: Date.now() } })
		const s = await AirApply.takeForApply({ log: () => {} }, { deps: { persistence: p, capture: async () => { throw new Error('INFO 1 timed out') } } })
		assert.deepEqual(s, { taken: false, error: 'INFO 1 timed out' })
		assert.equal(p.get(Air.KEY), undefined, 'an older snapshot is not restored by this apply’s reconnect')
		const r = await AirApply.settleAfterApply({}, s, { ok: true, casparRestart: { attempted: true, reconnected: true } }, { deps: { persistence: p } })
		assert.deepEqual(r, { restored: null, restored_reason: 'snapshot failed: INFO 1 timed out' })
	})

	it('the real route: Caspar absent (snapshot impossible) → the apply still runs to its own answer', async () => {
		const { applyCasparConfigToDiskAndRestart } = require('../../src/api/routes-caspar-config')
		const logs = []
		const ctx = { config: { offline_mode: true }, log: (l, m) => logs.push(m) } // offline_mode: the write refuses, nothing touches the box
		const r = await applyCasparConfigToDiskAndRestart(ctx, {})
		assert.equal(r.status, 400)
		assert.match(JSON.parse(r.body).error, /Offline preparation mode/)
		assert.ok(logs.some((m) => /snapshot failed \(Caspar not connected\) — applying anyway/.test(m)))
		assert.ok(logs.some((m) => /Full apply starting/.test(m)))
	})

	it('no restart (config unchanged) → snapshot discarded; Caspar back → waits for the restore report', async () => {
		const p = memPersistence()
		const s = await AirApply.takeForApply({ log: () => {} }, { deps: { persistence: p, capture: async () => ({ id: 'a1', channels: [], looks: [], errors: [] }) } })
		assert.equal(p.get(Air.KEY).id, 'a1')
		assert.deepEqual(await AirApply.settleAfterApply({}, s, { ok: true, step: 'no_changes' }, { deps: { persistence: p } }), { restored: null, restored_reason: 'no restart' })
		assert.equal(p.get(Air.KEY), undefined)
		const r = await AirApply.settleAfterApply({}, { taken: true, id: 'a2' }, { ok: true, casparRestart: { attempted: true, reconnected: true } }, {
			deps: { persistence: p, waitRestored: async (id) => ({ id, clips: [] }) },
		})
		assert.deepEqual(r, { restored: { id: 'a2', clips: [] }, restored_reason: '' })
		setTimeout(() => Air.reportRestored('a3', { ms: 5 }), 5)
		assert.deepEqual(await Air.waitRestored('a3', 1000), { ms: 5 })
	})
})

describe('WO-1029 one owner of the restore per Caspar connect', () => {
	it('with an armed snapshot: looks / layers / card once per connect, never a second WO-1013 pass', async () => {
		const seq = []
		const patch = (mod, name, fn) => {
			const m = require(mod)
			const old = m[name]
			m[name] = fn
			return () => void (m[name] = old)
		}
		const persistence = require('../../src/utils/persistence') // test-isolated file under node --test
		const undo = [
			patch('../../src/engine/restore-on-screens', 'restoreProgramLooks', async (_c, o) => void seq.push(`looks:${o.reconnect}`)),
			patch('../../src/engine/restore-on-screens', 'restoreLedTestCard', async () => void seq.push('card')),
			patch('../../src/engine/restore-on-screens', 'verifyPrimedLedTestCard', async () => void seq.push('verify')),
			patch('../../src/engine/restore-on-screens', 'primeLedTestCardFromPersisted', () => {}),
			patch('../../src/engine/air-snapshot-restore', 'rekeyLiveLooks', async () => (seq.push('rekey'), { moved: [], dropped: [] })),
			patch('../../src/engine/air-snapshot-restore', 'restoreChannels', async () => (seq.push('layers'), { clips: [], layers: [], skipped: [] })),
			patch('../../src/engine/air-snapshot-restore', 'resumeTimeline', async () => void seq.push('timeline')),
			patch('../../src/engine/air-snapshot-restore', 'restoreConsumers', async () => (seq.push('consumers'), { stream: null, records: [], skipped: [] })),
			patch('../../src/config/routing-setup', 'restagePersistedPreviewLooks', async () => void seq.push('preview')),
			patch('../../src/config/routing-setup', 'warmLookDeckThumbnails', async () => {}),
			patch('../../src/system/screen-consumer-placement', 'placeScreenConsumers', async () => ({ missing: 0 })),
			patch('../../src/engine/template-cg-orphan-sweep', 'sweepTemplateCgOrphansOnCasparConnected', async () => {}),
			patch('../../src/engine/screen-timers', 'loadRegistry', () => {}),
			patch('../../src/engine/screen-timers', 'linesForReAdd', () => []),
		]
		try {
			const { createOnAfterInfoConfigReady } = require('../../src/bootstrap/caspar-info-ready')
			const appCtx = { log: () => {}, config: {} }
			const onReady = createOnAfterInfoConfigReady({
				appCtx,
				config: {},
				getChannelMap: () => ({ previewChannels: [], screenCount: 0, programCh: () => 1 }),
				handleCasparConnected: () => {},
				setupAllRouting: async () => void seq.push('routing'),
				reconcileAfterInfoGather: async () => {},
			})
			const settle = () => new Promise((r) => setTimeout(r, 80))
			onReady() // boot
			await settle()
			seq.length = 0
			Air.storeSnapshot({ v: 1, id: 'apply-1', taken_at: Date.now(), roles: {}, channels: [], looks: [] }, persistence)
			onReady() // the apply's reconnect
			await settle()
			assert.deepEqual(seq, ['routing', 'rekey', 'looks:true', 'preview', 'layers', 'timeline', 'card', 'consumers'])
			assert.equal(persistence.get(Air.KEY) ?? null, null, 'used once')
			seq.length = 0
			onReady() // a later reconnect (Caspar crash): WO-1013 only, the snapshot is not used again
			await settle()
			assert.deepEqual(seq, ['routing', 'looks:true', 'preview', 'card'])
		} finally {
			for (const u of undo) u()
		}
	})
})
