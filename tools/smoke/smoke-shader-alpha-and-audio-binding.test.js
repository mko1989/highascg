'use strict'

/**
 * todos28.07.26 (owner) — two shader defects:
 *
 *   "alpha doesnt work on shaders."
 *   "when audio reactive is ticked on a shader audio must be chosen in image iCh0."
 *
 * Both were silent: the UI showed the feature as ON while nothing downstream acted on it.
 *
 *  - AUDIO: `audio.enabled` only set a flag. player.js creates the audio texture only when a pass
 *    actually BINDS 'audio' to a channel (`usesAudioChannel()`), so tick-and-forget produced a
 *    shader that could not react — while still wearing the ♪ badge in the library. Four shaders on
 *    this box were in that state (sh-balatro, sh-console, sh-test, sh-wavy).
 *  - ALPHA: the transparent page background and the alpha-claimed WebGL2 context were already
 *    right. The shaders are opaque: every alpha-enabled one ends `fragColor = vec4(col, 1.0)`.
 *
 * @see work/work-orders/374_WO_shader_alpha_keying.md
 * @see work/work-orders/375_WO_shader_audio_channel_autobind.md
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const { normalizeShaderConfig } = require('../../src/shaderfx/shader-store.js')

const base = (over = {}) => ({
	name: 'probe',
	passes: { image: { source: 'void mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }', channels: [] } },
	...over,
})

test('audio-reactive shaders bind audio to a channel or the flag means nothing', async (t) => {
	await t.test('ticked + nothing bound → image iChannel0', () => {
		const cfg = normalizeShaderConfig(base({ audio: { enabled: true } }))
		assert.deepEqual(cfg.passes.image.channels, ['audio', null, null, null])
	})

	await t.test('never displaces an existing binding — takes the first FREE slot', () => {
		const cfg = normalizeShaderConfig(
			base({
				audio: { enabled: true },
				passes: { image: { source: base().passes.image.source, channels: ['A', null, null, null] } },
			}),
		)
		assert.deepEqual(cfg.passes.image.channels, ['A', 'audio', null, null])
	})

	await t.test('already bound anywhere → left alone (a buffer may own the audio texture)', () => {
		const cfg = normalizeShaderConfig(
			base({
				audio: { enabled: true },
				passes: {
					image: { source: base().passes.image.source, channels: ['A', null, null, null] },
					bufferA: { source: base().passes.image.source, channels: ['audio', null, null, null] },
				},
			}),
		)
		assert.deepEqual(cfg.passes.image.channels, ['A', null, null, null], 'image must not gain a second audio bind')
		assert.deepEqual(cfg.passes.bufferA.channels, ['audio', null, null, null])
	})

	await t.test('audio OFF → nothing is bound', () => {
		const cfg = normalizeShaderConfig(base({ audio: { enabled: false } }))
		assert.deepEqual(cfg.passes.image.channels, [null, null, null, null])
	})

	await t.test('every image channel occupied → config left untouched, never silently rewired', () => {
		const cfg = normalizeShaderConfig(
			base({
				audio: { enabled: true },
				passes: { image: { source: base().passes.image.source, channels: ['A', 'B', 'C', 'D'] } },
			}),
		)
		assert.deepEqual(cfg.passes.image.channels, ['A', 'B', 'C', 'D'])
	})
})

test('player.js fixes already-exported templates without a re-export', () => {
	const player = fs.readFileSync(path.join(repoRoot, 'template/shaders/player.js'), 'utf8')

	// The runtime half of the audio binding: the owner's existing sh-*.html must start working on
	// their next load, because player.js is shared and loaded fresh by every template.
	assert.ok(/function ensureAudioChannelBinding\(\)/.test(player))
	assert.ok(/ensureAudioChannelBinding\(\)\n\t\tif \(config\.audio/.test(player), 'must run before usesAudioChannel()')
	assert.ok(/const bound = Object\.keys\(passes\)\.some/.test(player), 'must not displace an existing binding')

	// Alpha keying, and its fail-safes.
	assert.ok(/function alphaKeyImageSource\(src\)/.test(player))
	assert.ok(/if \(decls\.length !== 1\) return null/.test(player), 'ambiguous sources must fall back to today’s behaviour')
	assert.ok(/void mainImageAuthor\(/.test(player), 'the author’s entry point is renamed, not edited')
	assert.ok(/c\.a < 1\.0 \? c\.a :/.test(player), 'a shader that authors real alpha must keep it')
	assert.ok(/fragColor = vec4\(c\.rgb \* a, a\)/.test(player), 'context is premultipliedAlpha:true — output must be premultiplied')
	assert.ok(/key === 'image' && config\.opts && config\.opts\.alpha/.test(player), 'keying is gated on the Alpha flag')
	// WO-345 hot-recompile must not silently drop the keying.
	assert.ok(/passConfig\(config\.passes\[key\], key\)/.test(player))
})

test('the exporter still writes a transparent page only for alpha shaders', () => {
	const { buildShaderTemplateHtml } = require('../../src/shaderfx/shader-template-export.js')
	const on = buildShaderTemplateHtml({ id: 'sh-x', name: 'x', opts: { alpha: true } })
	const off = buildShaderTemplateHtml({ id: 'sh-x', name: 'x', opts: { alpha: false } })
	assert.ok(/background: transparent/.test(on))
	assert.ok(/background: #000/.test(off))
})
