'use strict'

/**
 * WO-661 smoke — the Templates tab groups (Templates / Lower thirds / Shaders) and the shader GPU warning
 * (owner 21.10). Covers client/lib/template-category.js (ESM, no DOM: require() works) and
 * src/shaderfx/caspar-html-gpu.js (what GET /api/shaders reports as `gpu`).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { templateCategory, TEMPLATE_GROUPS, shaderGpuWarning } = require('../../client/lib/template-category.js')
const { parseHtmlEnableGpu, htmlGpuState } = require('../../src/shaderfx/caspar-html-gpu')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('WO-661: template categories', () => {
	it('sorts the box TLS ids into the three groups', () => {
		assert.deepEqual(TEMPLATE_GROUPS.map((g) => g.id), ['templates', 'lower_thirds', 'shaders'])
		assert.equal(templateCategory('SHADERS/SH-3D-METERS-C2'), 'shaders')
		assert.equal(templateCategory('WIN\\SHADERS\\SH-BALATRO'), 'shaders')
		assert.equal(templateCategory('LOWER-THIRDS/LT-NAME'), 'lower_thirds')
		assert.equal(templateCategory('STUDIO/LT-GRADIENT-WAVE-MARCIN'), 'lower_thirds', 'CG Studio exports were plain templates')
		assert.equal(templateCategory('COUNTDOWN/COUNTDOWN'), 'templates')
		assert.equal(templateCategory('SHADERS/README'), 'templates', 'only sh-* exports are shaders')
		assert.equal(templateCategory(''), 'templates')
	})
	it('the web Templates tab renders the groups and the warning', () => {
		const src = read('client/components/sources-panel-templates.js')
		assert.match(src, /for \(const g of TEMPLATE_GROUPS\)/)
		assert.match(src, /_gpuWarning = shaderGpuWarning\(r\?\.gpu\)/)
	})
})

describe('WO-661: Caspar HTML GPU state', () => {
	it('reads <html><enable-gpu> from INFO CONFIG', () => {
		assert.equal(parseHtmlEnableGpu('<configuration><html><remote-debugging-port>0</remote-debugging-port><enable-gpu>true</enable-gpu></html></configuration>'), true)
		assert.equal(parseHtmlEnableGpu('<configuration><html>\n  <enable-gpu>false</enable-gpu>\n</html></configuration>'), false)
		assert.equal(parseHtmlEnableGpu('<configuration><channels/></configuration>'), false, 'no html block = Caspar default (off)')
		assert.equal(parseHtmlEnableGpu(''), null, 'not gathered yet')
		assert.equal(parseHtmlEnableGpu(undefined), null)
	})
	it('pairs the running state with the setting', () => {
		assert.deepEqual(htmlGpuState({ config: { operatorTools: { cefEnableGpu: true } }, gatheredInfo: { infoConfig: '<html><enable-gpu>false</enable-gpu></html>' } }), { running: false, setting: true })
		assert.deepEqual(htmlGpuState(undefined), { running: null, setting: false })
	})
	it('warning text per state', () => {
		assert.equal(shaderGpuWarning({ running: true, setting: false }), '')
		assert.equal(shaderGpuWarning({ running: null, setting: true }), '')
		assert.match(shaderGpuWarning({ running: false, setting: false }), /^GPU acceleration is off/)
		assert.match(shaderGpuWarning({ running: null, setting: false }), /^GPU acceleration is off/)
		assert.match(shaderGpuWarning({ running: false, setting: true }), /restart Caspar/)
		assert.equal(shaderGpuWarning(undefined), '', 'older server')
	})
	it('GET /api/shaders carries it', () => {
		assert.match(read('src/api/routes-shaders.js'), /gpu: htmlGpuState\(ctx\)/)
		assert.match(read('src/api/router.js'), /routes\.get\('\/api\/shaders', \(\{ path, ctx \}\) => routesShaders\.handleGet\(path, ctx\)/)
	})
})
