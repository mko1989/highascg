'use strict'

/**
 * WO-265: CG Studio mounted on the playout server + operator-GUI workspace tab.
 * Offline-only — module handleApi is exercised directly (no HTTP server, no sockets);
 * client ESM files are asserted at source level (house pattern from smoke-wo255).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '../..')
const cgStudio = require('../../src/cg-studio/register')
const moduleRegistry = require('../../src/module-registry')
const pluginManager = require('../../src/plugins/plugin-manager')

function clientSrc(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

describe('WO-265 T265.1: cg-studio module descriptor', () => {
	it('has the playout-mount descriptor shape', () => {
		assert.equal(cgStudio.name, 'cg-studio')
		assert.deepEqual(cgStudio.apiPathPrefixes, ['/api/cg-studio'])
		for (const [prefix, dir] of Object.entries(cgStudio.staticMounts)) {
			assert.ok(prefix.startsWith('/') && prefix.endsWith('/'), `prefix ${prefix} must be /…/`)
			assert.ok(fs.existsSync(dir), `staticMounts dir must exist: ${dir}`)
		}
		assert.ok(cgStudio.staticMounts['/cg-studio/'].endsWith(path.join('cg-studio', 'public')))
		assert.ok(cgStudio.staticMounts['/studio-assets/'].endsWith('template'))
	})

	it('health responds through the /api/cg-studio adapter', async () => {
		const r = await cgStudio.handleApi({ method: 'GET', path: '/api/cg-studio/health', body: '', query: {} })
		assert.equal(r.status, 200)
		assert.equal(JSON.parse(r.body).ok, true)
	})

	it('templates list + detail respond through the adapter', async () => {
		const list = await cgStudio.handleApi({ method: 'GET', path: '/api/cg-studio/templates', body: '', query: {} })
		assert.equal(list.status, 200)
		const templates = JSON.parse(list.body).templates
		assert.ok(Array.isArray(templates) && templates.length > 0, 'expected shipped lower-thirds templates')
		const first = templates[0]
		const detail = await cgStudio.handleApi({
			method: 'GET',
			path: `/api/cg-studio/templates/${encodeURIComponent(first.id)}`,
			body: '',
			query: { category: first.category },
		})
		assert.equal(detail.status, 200)
		assert.ok(JSON.parse(detail.body).fields, 'detail carries inspector fields')
	})

	it('unknown adapter path returns null (falls through to 404)', async () => {
		const r = await cgStudio.handleApi({ method: 'GET', path: '/api/cg-studio/nope', body: '', query: {} })
		assert.equal(r, null)
	})

	it('export with invalid body is a 400, not a throw', async () => {
		const r = await cgStudio.handleApi({ method: 'POST', path: '/api/cg-studio/export', body: '{"exportId":""}', query: {} })
		assert.equal(r.status, 400)
	})
})

describe('WO-265 T265.1: module-registry collectStaticMounts', () => {
	it('merges mounts, skips duplicates and invalid prefixes', () => {
		const a = { name: 'wo265-test-a', staticMounts: { '/a/': '/tmp/a', 'bad': '/tmp/x', '/no-slash': '/tmp/y' } }
		const b = { name: 'wo265-test-b', staticMounts: { '/a/': '/tmp/other', '/b/': '/tmp/b' } }
		moduleRegistry.register(a)
		moduleRegistry.register(b)
		try {
			const warns = []
			const mounts = moduleRegistry.collectStaticMounts((level, msg) => warns.push([level, msg]))
			assert.equal(mounts['/a/'], '/tmp/a')
			assert.equal(mounts['/b/'], '/tmp/b')
			assert.equal(mounts['bad'], undefined)
			assert.equal(mounts['/no-slash'], undefined)
			assert.ok(warns.some(([, m]) => m.includes('"/a/"')), 'duplicate prefix is warned about')
		} finally {
			moduleRegistry.unregister('wo265-test-a')
			moduleRegistry.unregister('wo265-test-b')
		}
	})
})

describe('WO-265: plugin catalog gating', () => {
	it('cg-studio is catalogued and enabled by default', () => {
		delete process.env.HIGHASCG_CG_STUDIO
		assert.ok(pluginManager.getKnownPluginIds().includes('cg-studio'))
		const entry = pluginManager.listPlugins({}).find((p) => p.id === 'cg-studio')
		assert.ok(entry)
		assert.equal(entry.enabled, true)
	})

	it('features.cgStudio:false and env=0 both opt out', () => {
		const offByConfig = pluginManager.listPlugins({ features: { cgStudio: false } }).find((p) => p.id === 'cg-studio')
		assert.equal(offByConfig.enabled, false)
		process.env.HIGHASCG_CG_STUDIO = '0'
		try {
			const offByEnv = pluginManager.listPlugins({}).find((p) => p.id === 'cg-studio')
			assert.equal(offByEnv.enabled, false)
		} finally {
			delete process.env.HIGHASCG_CG_STUDIO
		}
	})
})

describe('WO-265 T265.2: studio UI dual-origin (source asserts)', () => {
	it('public/app.js resolves its API base for both origins', () => {
		const src = clientSrc('src/cg-studio/public/app.js')
		assert.match(src, /API_BASE = location\.pathname\.startsWith\('\/cg-studio\/'\)\s*\?\s*'\/api\/cg-studio'\s*:\s*'\/api'/)
		assert.ok(!/fetch\('\/api\//.test(src), 'no hardcoded /api fetches left')
	})

	it('public/index.html references assets relatively', () => {
		const src = clientSrc('src/cg-studio/public/index.html')
		assert.match(src, /href="studio\.css"/)
		assert.match(src, /src="app\.js"/)
	})
})

describe('WO-265 T265.3/T265.4: workspace tab + video latch (source asserts)', () => {
	it('cg-studio-tab.js injects the tab and registers as a video-blocking tab', () => {
		const src = clientSrc('client/components/cg-studio-tab.js')
		assert.match(src, /isModuleEnabled\(CG_STUDIO_TAB\)/)
		assert.match(src, /registerVideoBlockingTab\(CG_STUDIO_TAB\)/)
		assert.ok(!/setForegroundTabBlocksVideo/.test(src), 'component must not drive the latch directly (registry owns it)')
		assert.match(src, /\/cg-studio\/index\.html/)
	})

	it('app.js mounts the tab after optional modules resolve', () => {
		const src = clientSrc('client/app.js')
		assert.match(src, /initOptionalModules\(.*\)\.then\(\(\) => initCgStudioTab\(\)\)/)
	})

	it('operator-gui-mode.js gates every send on the tab latch', () => {
		// WO-255 T255.3 split: the tab latch + effectiveCells() now live in operator-gui-mode-report.js,
		// re-exported from operator-gui-mode.js — read the split pair concatenated.
		const src = clientSrc('client/lib/operator-gui-mode.js') + clientSrc('client/lib/operator-gui-mode-report.js')
		assert.match(src, /export function setForegroundTabBlocksVideo/)
		assert.match(src, /export function registerVideoBlockingTab/)
		assert.match(src, /_videoBlockingTabs\.has\(tab\)/, 'central listener computes the latch from the registered set')
		assert.match(src, /_suppressed \|\| _tabBlocked \? \[\] : mergedCells\(\)/)
		assert.ok(!/sendLayout\(mergedCells\(\)\)/.test(src), 'no send path bypasses effectiveCells()')
		assert.match(src, /_suppressed = false\s*\n\s*_tabBlocked = false/, 'test reset clears the latch')
	})
})
