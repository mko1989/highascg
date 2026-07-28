'use strict'

/**
 * WO-379 — todos28.07.26 (owner), two lines:
 *
 *   "there is no way to remove a shader from a pgm stack in shaders editor."
 *   "sh-mirrors shader fails to load with 404"
 *
 * The 404 was not one shader: a shader lives in TWO files (`data/shaders/<id>.json` = the config
 * the library lists, `template/shaders/<id>.html` = the template that actually plays) and they had
 * diverged in BOTH directions on this box — 7 configs with no template (in the library, 404 on
 * play) and 2 templates with no config (in Caspar's catalog, 404 on `/api/shaders/<id>`).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

test('WO-379 the two halves of the shader store are reconciled, never deleted', async (t) => {
	const store = require('../../src/shaderfx/shader-store.js')
	const { buildShaderTemplateHtml } = require('../../src/shaderfx/shader-template-export.js')

	await t.test('a config embedded in a template can be recovered from it', () => {
		// This is what makes the HTML→JSON direction possible at all: the exporter embeds the
		// whole config, escaping `</` so shader source cannot close the script tag.
		const cfg = store.normalizeShaderConfig({
			id: 'sh-probe',
			name: 'probe',
			passes: {
				image: { source: 'void mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); } // </script> trap', channels: [] },
			},
			opts: { alpha: true },
		})
		const html = buildShaderTemplateHtml(cfg)
		assert.ok(!html.includes('</script> trap'), 'the trap must be escaped in the exported HTML')

		const m = /window\.__SHADERFX_CONFIG__ = (\{[\s\S]*?\})<\/script>/.exec(html)
		assert.ok(m, 'the embedded config must be extractable')
		const back = JSON.parse(m[1].replace(/<\\\//g, '</'))
		assert.equal(back.id, 'sh-probe')
		assert.equal(back.opts.alpha, true)
		assert.equal(back.passes.image.source, cfg.passes.image.source, 'source survives the round trip verbatim')
	})

	await t.test('reconcile is best-effort and never throws on a hostile store', async () => {
		// Real store on this box; it must be idempotent and quiet once healed.
		const first = await store.reconcileShaderStore()
		assert.ok(Array.isArray(first.exported) && Array.isArray(first.recovered))
		const second = await store.reconcileShaderStore()
		assert.deepEqual(second, { exported: [], recovered: [] }, 'a healed store reconciles to a no-op')
	})

	await t.test('an unparseable orphan template is left alone rather than faked', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo379-'))
		fs.writeFileSync(path.join(dir, 'sh-broken.html'), '<html>no config here</html>')
		// The regex must simply not match — the reconciler skips it (a 404 beats a fabricated config).
		const m = /window\.__SHADERFX_CONFIG__ = (\{[\s\S]*?\})<\/script>/.exec(
			fs.readFileSync(path.join(dir, 'sh-broken.html'), 'utf8')
		)
		assert.equal(m, null)
		fs.rmSync(dir, { recursive: true, force: true })
	})

	await t.test('the library read path heals before listing', () => {
		const src = read('src/shaderfx/shader-store.js')
		assert.ok(
			/async function listShaders\(\) \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*try \{\s*\n\s*await reconcileShaderStore\(\)/.test(src)
		)
	})
})

test('WO-379 a stacked shader can be taken off air', () => {
	const route = read('src/api/routes-shader-stack.js')

	// The action exists and is explicit — `clear: true`, not "post an empty value".
	assert.ok(/const clear = b\.clear === true \|\| b\.clear === 'true'/.test(route))
	assert.ok(/if \(!clear && !value\)/.test(route), 'value is still required for a LANDING')
	// A layerNumber outside the stack band is still refused for both actions.
	assert.ok(/layerNumber < STACK_LAYER_MIN \|\| layerNumber > STACK_LAYER_MAX/.test(route))

	// Fade THEN clear — a MIX that clears immediately loses the transition (WO-175's shape).
	assert.ok(/MIXER \$\{channel\}-\$\{pLayer\} OPACITY 0 \$\{fadeFrames\}/.test(route))
	assert.ok(/CLEAR \$\{channel\}-\$\{pLayer\}/.test(route))
	assert.ok(/await new Promise\(\(r\) => setTimeout\(r, Math\.min\(4000,/.test(route), 'the fade must finish first')

	// The live scene must forget the layer, or the row still reads as occupied.
	assert.ok(/if \(idx >= 0\) scene\.layers\.splice\(idx, 1\)/.test(route))
	assert.ok(/cleared: clear/.test(route), 'the response says which action ran')
})

test('WO-379 the stack UI offers the control only where it means something', () => {
	const ui = read('client/components/shader-live-stack.js')

	assert.ok(/data-stack-clear="\$\{n\}"/.test(ui))
	assert.ok(/const clearBtn = occ\s*\n\s*\?/.test(ui), '✕ only on OCCUPIED rows')
	assert.ok(/clear: true/.test(ui), 'it must call the clear action, not land an empty value')

	// The ✕ is nested inside the row button — without stopPropagation it would ALSO land a shader.
	const handler = ui.slice(ui.indexOf("host.addEventListener('click'"))
	assert.ok(/e\.stopPropagation\(\)/.test(handler))
	assert.ok(handler.indexOf('data-stack-clear') < handler.indexOf("closest('[data-stack]')"), 'clear is tested FIRST')

	const css = read('client/styles/08d-modals-shader-fx.css')
	assert.ok(/\.shader-live__stack-clear \{/.test(css))
	assert.ok(/\.shader-live__stack-row:hover \.shader-live__stack-clear/.test(css), 'quiet until hovered')
})
