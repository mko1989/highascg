'use strict'

/**
 * WO-663 — CG Studio exports (`template/studio/lt-*`) are lower thirds: the inspector shows the lower-third fields,
 * pre-filled with the export's baked text + look, and a take with no operator text plays the baked values instead
 * of lt-engine's "Name / Title" placeholder.
 */

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const REPO = path.join(__dirname, '../..')
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

const { bakeDefaults } = require('../../src/cg-studio/export-template')
const { studioLtDefaults, studioLtDefaultsFromHtml } = require('../../src/cg-studio/studio-lt-defaults')
const { isLowerThirdSourceValue } = require('../../src/engine/scene-look-kind')
const { extractTemplateCgData } = require('../../src/engine/scene-template-cg')
const { handleSceneLowerThird } = require('../../src/api/routes-scene-lower-third')

let lib
before(async () => {
	lib = await import(pathToFileURL(path.join(REPO, 'client/lib/lower-third-cg-data.js')).href)
})

/** A real studio export of the classic box (the CG Studio export path minus the file write). */
function exportedHtml(data, style) {
	return bakeDefaults(src('template/lower-thirds/lt-classic-box.html'), { data, style })
}

describe('WO-663 (a): detection', () => {
	it('studio/lt-* is a lower third (web lib, server look kind); others unchanged', () => {
		for (const v of ['studio/lt-gradient-wave-marcin', 'STUDIO\\LT-X', 'studio/lt-a.html']) {
			assert.equal(lib.isLowerThirdSource({ value: v }), true, v)
			assert.equal(lib.isStudioLowerThirdSource({ value: v }), true, v)
			assert.equal(isLowerThirdSourceValue({ value: v }), true, v)
		}
		assert.equal(lib.isStudioLowerThirdSource({ value: 'lower-thirds/lt-classic-box' }), false)
		assert.equal(lib.isStudioLowerThirdSource({ value: 'mystudio/lt-x' }), false)
		assert.equal(lib.isLowerThirdSource({ value: 'templates/studio-guide' }), false)
		assert.equal(lib.deriveTemplateId('studio/lt-gradient-wave-marcin'), 'lt-gradient-wave-marcin')
	})
})

describe('WO-663 (b): baked defaults', () => {
	it('reads back what an export baked: text (HTML-escaped), colours, non-colour style seed', () => {
		const html = exportedHtml(
			{ title: 'Anna & <Jan>', subtitle: 'CEO' },
			{ primaryColor: '#112233', textColor: '#fafafa', titleFontSize: 60, position: 'right', marginX: 40 }
		)
		assert.deepEqual(studioLtDefaultsFromHtml(html), {
			title: 'Anna & <Jan>',
			subtitle: 'CEO',
			primaryColor: '#112233',
			textColor: '#fafafa',
			position: 'right',
			titleFontSize: 60,
		})
	})
	it('a colours-only export (no style seed) still gives text + colours; unknown id → null', () => {
		const d = studioLtDefaultsFromHtml(exportedHtml({ title: 'X', subtitle: 'Y' }, { primaryColor: '#99c1f1' }))
		assert.equal(d.title, 'X')
		assert.equal(d.subtitle, 'Y')
		assert.equal(d.primaryColor, '#99c1f1')
		assert.equal('titleFontSize' in d, false)
		assert.equal(studioLtDefaults('lt-does-not-exist-wo663'), null)
		assert.equal(studioLtDefaults('../etc/passwd'), null)
	})
})

describe('WO-663 (c): take with no operator text plays the baked values', () => {
	it('resolvers return null for a studio layer without config (built-ins keep the blank defaults)', () => {
		const studio = { source: { type: 'template', value: 'studio/lt-x' } }
		assert.equal(lib.resolveLayerLowerThirdConfig(studio), null)
		assert.equal(lib.resolveLayerLowerThirdCgData(studio), null)
		assert.equal(lib.resolveLayerLowerThirdConfig({ source: { value: 'lower-thirds/lt-classic-box' } }).title, '')
		const edited = { source: { value: 'studio/lt-x', lowerThirdConfig: { title: 'Op' } } }
		assert.equal(lib.resolveLayerLowerThirdConfig(edited).title, 'Op')
	})
	it('both take builders leave such a layer without cgData; the server CG ADD fills the baked values', () => {
		const guard =
			/isLowerThirdSource\(l\.source\) && !(h\.lt\.)?isStudioLowerThirdSource\(l\.source\)\) \{\n\t+\/\/ WO-663/
		assert.match(
			src('src/engine/scene-take-payload.js').replace(/h\.lt\.isLowerThirdSource/, 'isLowerThirdSource'),
			guard
		)
		assert.match(src('client/components/scenes-shared.js'), guard)
		const tpl = src('src/engine/scene-template-cg.js')
		assert.match(tpl, /if \(key\.startsWith\('studio\/lt-'\)\) return studioLtCgData\(key\) \|\| DEFAULT_LT_CG_DATA/)
		// a missing export still gets the old placeholder rather than nothing
		const cg = JSON.parse(
			extractTemplateCgData({ source: { value: 'studio/lt-missing-wo663' } }, 'studio/lt-missing-wo663')
		)
		assert.equal(cg.data.title, 'Name')
	})
})

describe('WO-663 (d): inspectors open with the baked values', () => {
	const look = { id: 'L1', layers: [{ layerNumber: 20, source: { type: 'template', value: 'studio/lt-marcin' } }] }
	const call = (action, extra = {}) => {
		const posts = []
		return handleSceneLowerThird(
			{ sceneId: 'L1', layerNumber: 20, action, ...extra },
			{},
			{
				resolveScene: () => look,
				getChannelMap: () => ({ programChannels: [1] }),
				post: async (p, b) => posts.push([p.split('/').pop(), b]),
				ltState: {},
				studioLtDefaults: (id) =>
					id === 'lt-marcin' ? { title: 'Marcin Wardecki', subtitle: 'High Creator', primaryColor: '#99c1f1' } : null,
				lowerThirds: { handleGet: () => ({ body: JSON.stringify({ templates: [{ id: 'lt-marcin', name: 'Marcin' }] }) }) },
			}
		).then((r) => ({ body: JSON.parse(r.body), posts }))
	}
	it('Godot (POST /api/scene/lower-third resolve) gets the baked config on top of the defaults', async () => {
		const { body } = await call('resolve')
		assert.equal(body.config.title, 'Marcin Wardecki')
		assert.equal(body.config.primaryColor, '#99c1f1')
		assert.equal(body.config.titleFontSize, 46, 'unbaked keys keep the defaults')
	})
	it('Play with no config sends the baked text, not blank', async () => {
		const { posts } = await call('play')
		assert.deepEqual(
			posts.map((p) => p[0]),
			['load', 'update', 'play']
		)
		assert.equal(posts[1][1].data.name, 'Marcin Wardecki')
	})
	it('web: template list carries defaults; inspector fills them in only while the layer has no config', () => {
		assert.match(src('src/api/routes-lower-thirds.js'), /defaults: studioLtDefaults\(id\),/)
		const insp = src('client/components/inspector-lower-third.js')
		assert.match(
			insp,
			/if \(!stored && !editedMeanwhile && found\?\.defaults\) \{\n\t+Object\.assign\(cfg, found\.defaults\)/
		)
	})
})
