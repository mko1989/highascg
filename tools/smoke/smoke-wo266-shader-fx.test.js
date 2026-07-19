'use strict'

/**
 * WO-266: Shader FX library, template export, routes, player runtime wiring.
 * Offline-only — fs round-trip uses a throwaway `sh-smoke-wo266-tmp` id (created + deleted
 * in-place under data/shaders + template/shaders); no HTTP, no Caspar, no GL.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '../..')
const store = require('../../src/shaderfx/shader-store')
const { buildShaderTemplateHtml, embedConfigJson } = require('../../src/shaderfx/shader-template-export')
const routes = require('../../src/api/routes-shaders')

const TMP_ID = 'sh-smoke-wo266-tmp'
const VALID_INPUT = {
	name: 'Smoke WO266 Tmp',
	id: TMP_ID,
	common: '// common',
	passes: { image: { source: 'void mainImage(out vec4 o, in vec2 f){o=vec4(1.);}', channels: ['audio', null, 'A', 'bogus'] } },
	audio: { enabled: true },
	opts: { alpha: true },
}

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

after(async () => {
	await store.deleteShader(TMP_ID)
})

describe('WO-266 T266.1: shader-store normalize', () => {
	it('requires name and image pass', () => {
		assert.throws(() => store.normalizeShaderConfig({}), /name is required/)
		assert.throws(() => store.normalizeShaderConfig({ name: 'x' }), /image pass source is required/)
	})

	it('generates sh- slug ids and rejects invalid ids', () => {
		const cfg = store.normalizeShaderConfig({ name: 'My Cool FX!', passes: { image: { source: 'x' } } })
		assert.equal(cfg.id, 'sh-my-cool-fx')
		assert.throws(() => store.normalizeShaderConfig({ ...VALID_INPUT, id: '../evil' }), /invalid shader id/)
		assert.throws(() => store.normalizeShaderConfig({ ...VALID_INPUT, id: 'nope' }), /invalid shader id/)
	})

	it('filters channel values and keeps audio/alpha flags', () => {
		const cfg = store.normalizeShaderConfig(VALID_INPUT)
		assert.deepEqual(cfg.passes.image.channels, ['audio', null, 'A', null])
		assert.equal(cfg.passes.bufferA, null)
		assert.equal(cfg.audio.enabled, true)
		assert.equal(cfg.opts.alpha, true)
	})
})

describe('WO-266 T266.1: fs round-trip + export', () => {
	it('save → list/get → delete (json + exported template)', async () => {
		const { casparPath } = await store.saveShader(VALID_INPUT)
		assert.equal(casparPath, `shaders/${TMP_ID}`)
		assert.ok(fs.existsSync(path.join(store.SHADERS_DATA_DIR, `${TMP_ID}.json`)))
		const tplFile = path.join(store.SHADERS_TEMPLATE_DIR, `${TMP_ID}.html`)
		assert.ok(fs.existsSync(tplFile))
		const listed = await store.listShaders()
		assert.ok(listed.some((s) => s.id === TMP_ID && s.audio && s.alpha))
		const got = await store.getShader(TMP_ID)
		assert.equal(got.name, VALID_INPUT.name)
		assert.equal(await store.deleteShader(TMP_ID), true)
		assert.ok(!fs.existsSync(tplFile))
		assert.equal(await store.getShader(TMP_ID), null)
	})
})

describe('WO-266 T266.2: template export builder', () => {
	it('escapes </script in embedded shader source', () => {
		const out = embedConfigJson({ source: 'x</script><script>alert(1)' })
		assert.ok(!out.includes('</script'), 'must not contain a raw close-script sequence')
	})

	it('builds a relative-asset, contract-carrying page', () => {
		const cfg = store.normalizeShaderConfig(VALID_INPUT)
		const html = buildShaderTemplateHtml(cfg)
		assert.match(html, /<canvas id="shaderfx-canvas">/)
		assert.match(html, /src="ShaderToyLite\.js"/)
		assert.match(html, /src="player\.js"/)
		assert.match(html, /background: transparent/)
		const opaque = buildShaderTemplateHtml(store.normalizeShaderConfig({ ...VALID_INPUT, opts: { alpha: false } }))
		assert.match(opaque, /background: #000/)
	})
})

describe('WO-266 T266.1: routes', () => {
	it('GET list + 404 detail + POST 400 + DELETE 404', async () => {
		const list = await routes.handleGet('/api/shaders')
		assert.equal(list.status, 200)
		assert.ok(Array.isArray(JSON.parse(list.body).shaders))
		const miss = await routes.handleGet('/api/shaders/sh-definitely-missing')
		assert.equal(miss.status, 404)
		const bad = await routes.handlePost('/api/shaders', JSON.stringify({ name: '' }))
		assert.equal(bad.status, 400)
		const delMiss = await routes.handleDelete('/api/shaders/sh-definitely-missing')
		assert.equal(delMiss.status, 404)
	})
})

describe('WO-266 T266.2/T266.3: player runtime + vendored lib (source asserts)', () => {
	it('template copy carries provenance + the channel patch; vendor snapshot stays pristine', () => {
		const patched = src('template/shaders/ShaderToyLite.js')
		assert.match(patched, /WO-266 patch/)
		assert.match(patched, /11bbc09ac0e78791895e9a022e27cc749d7e27c5/)
		const pristine = src('vendor/shadertoy/ShaderToyLite.js')
		assert.ok(!pristine.includes('WO-266 patch'), 'vendor snapshot must stay unpatched')
		assert.ok(fs.existsSync(path.join(REPO, 'vendor/shadertoy/LICENSE')))
	})

	it('player implements the Caspar contract and both audio tiers', () => {
		const player = src('template/shaders/player.js')
		for (const token of ['window.update', 'window.play', 'window.stop', 'getUserMedia', "type !== 'osc'", 'texSubImage2D', 'addTexture(audioTexture']) {
			assert.ok(player.includes(token), `player.js must contain ${token}`)
		}
		assert.ok(player.indexOf('toy.addTexture') < player.indexOf('toy.setImage'), 'addTexture must precede setImage (patch requirement)')
	})

	it('client wiring: New shader… in the main ingest (+) menu + edit branch + WO-265 studio-tab fallback', () => {
		// todos19.07.26 feedback: no extra (+) on the templates tab — the manager entry
		// lives in the media ingest plus menu instead.
		const ingest = src('client/components/sources-panel-ingest-ui.js')
		assert.match(ingest, /import \{ showShaderFxModal \} from '\.\/shader-fx-modal\.js'/)
		assert.match(ingest, /class="ingest-menu-item" id="ingest-menu-shaderfx"[^>]*>New shader…</)
		assert.match(ingest, /showShaderFxModal\(\)/)
		const tpl = src('client/components/sources-panel-templates.js')
		assert.ok(!tpl.includes('ingest-plus-btn'), 'templates tab must not render its own (+) button')
		assert.ok(!tpl.includes('sources-shaderfx-btn'), 'old always-visible Shader FX… button must be gone')
		assert.ok(!tpl.includes('sources-shaderfx-new'), 'templates-tab New shader… menu item must be gone')
		assert.match(tpl, /shaders\\\/\(sh-\[a-z0-9-\]\+\)\$/)
		assert.match(tpl, /highascgActivateWorkspaceTab\('cg-studio'\)/)
		const modal = src('client/components/shader-fx-modal.js')
		assert.match(modal, /\/api\/shaders/)
		assert.match(modal, /\/templates\/shaders\//)
	})
})
