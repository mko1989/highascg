'use strict'

/**
 * WO-380 — todos28.07.26 (owner):
 *
 *   "i noticed there is a share link on shader toy. it should be easy to be able to paste that link
 *    and it will fill in all the code layers. example link https://www.shadertoy.com/view/lldcR8"
 *
 * The network edge needs the owner's free Shadertoy API key (www.shadertoy.com is behind
 * Cloudflare — measured 403 for a plain request, the unauthenticated api/v1 path, the site's own
 * internal POST endpoint, AND headless Chrome). Everything either side of that fetch is pure and
 * is proven here against Shadertoy's documented response shape.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

const {
	shadertoyIdFromInput,
	shadertoyConfigFromApiJson,
	fetchShadertoyShader,
} = require('../../src/shaderfx/shadertoy-import.js')
const { normalizeShaderConfig } = require('../../src/shaderfx/shader-store.js')

/** Shadertoy `api/v1/shaders/<id>` shape: image + one buffer + common + a music channel. */
const API_JSON = {
	Shader: {
		info: { id: 'lldcR8', name: 'Example Shader', username: 'someone' },
		renderpass: [
			{ type: 'common', name: 'Common', code: '#define PI 3.14159', inputs: [], outputs: [] },
			{
				type: 'buffer',
				name: 'Buf A',
				code: 'void mainImage(out vec4 f, in vec2 c){ f = vec4(0.5); }',
				inputs: [{ channel: 0, ctype: 'music', id: 99 }],
				outputs: [{ channel: 0, id: 257 }],
			},
			{
				type: 'image',
				name: 'Image',
				code: 'void mainImage(out vec4 f, in vec2 c){ f = texture(iChannel0, c); }',
				inputs: [
					{ channel: 0, ctype: 'buffer', id: 257 },
					{ channel: 1, ctype: 'webcam', id: 42 },
					{ channel: 2, ctype: 'texture', id: 7 },
				],
				outputs: [{ channel: 0, id: 37 }],
			},
			{ type: 'sound', name: 'Sound', code: 'vec2 mainSound(...)', inputs: [], outputs: [] },
		],
	},
}

test('WO-380 a pasted share link yields the shader id', () => {
	assert.equal(shadertoyIdFromInput('https://www.shadertoy.com/view/lldcR8'), 'lldcR8')
	assert.equal(shadertoyIdFromInput('http://shadertoy.com/view/lldcR8'), 'lldcR8')
	assert.equal(shadertoyIdFromInput('https://www.shadertoy.com/embed/lldcR8?gui=true&t=10'), 'lldcR8')
	assert.equal(shadertoyIdFromInput('  lldcR8  '), 'lldcR8', 'a bare id is accepted too')
	for (const junk of ['', null, 'https://example.com/view/lldcR8x?', 'not a link', 'ab12']) {
		assert.equal(shadertoyIdFromInput(junk), null, String(junk))
	}
})

test('WO-380 the response maps onto our config', async (t) => {
	const cfg = shadertoyConfigFromApiJson(API_JSON)

	await t.test('code layers land in the right places', () => {
		assert.equal(cfg.name, 'Example Shader')
		assert.equal(cfg.common, '#define PI 3.14159')
		assert.match(cfg.passes.image.source, /texture\(iChannel0, c\)/)
		assert.match(cfg.passes.bufferA.source, /vec4\(0\.5\)/)
	})

	await t.test('channels are wired by OUTPUT id, not by the buffer’s free-text name', () => {
		// image iChannel0 ← the buffer whose output id is 257, i.e. our bufferA → 'A'
		assert.equal(cfg.passes.image.channels[0], 'A')
	})

	await t.test('music → audio and webcam → camera, our two runtime channels', () => {
		assert.equal(cfg.passes.bufferA.channels[0], 'audio')
		assert.equal(cfg.passes.image.channels[1], 'camera')
		assert.equal(cfg.audio.enabled, true, 'audio is claimed only because a channel asked for it')
	})

	await t.test('what we cannot represent is REPORTED, not silently dropped', () => {
		assert.ok(
			cfg.skipped.some((x) => /texture/.test(x)),
			'the texture channel must be named in skipped',
		)
		assert.ok(cfg.skipped.some((x) => /sound/.test(x)))
		assert.equal(cfg.passes.image.channels[2], null, 'and its channel is left unbound')
	})

	await t.test('the result is a valid shader-store config', () => {
		const norm = normalizeShaderConfig({ ...cfg, id: 'sh-imported' })
		assert.equal(norm.id, 'sh-imported')
		assert.equal(norm.passes.image.channels[0], 'A')
		assert.equal(norm.passes.image.channels[1], 'camera')
	})

	await t.test('a shader with no image pass is refused rather than half-imported', () => {
		assert.throws(
			() => shadertoyConfigFromApiJson({ Shader: { info: {}, renderpass: [{ type: 'sound', code: 'x' }] } }),
			/no image pass/,
		)
		assert.throws(() => shadertoyConfigFromApiJson({}), /no renderpass/)
	})
})

test('WO-380 audio is NOT claimed when nothing asks for it', () => {
	const cfg = shadertoyConfigFromApiJson({
		Shader: {
			info: { name: 'plain' },
			renderpass: [{ type: 'image', code: 'void mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }', inputs: [], outputs: [] }],
		},
	})
	assert.equal(cfg.audio.enabled, false)
})

test('WO-380 the fetch edge fails with an explanation, not a stack trace', async () => {
	await assert.rejects(() => fetchShadertoyShader('https://www.shadertoy.com/view/lldcR8', ''), /No Shadertoy API key/)
	// NB: any 6+ alphanumeric string IS a plausible Shadertoy id, so the rejection case has to be
	// something that cannot be one — otherwise this test would reach the network.
	await assert.rejects(() => fetchShadertoyShader('not a link', 'key'), /not a Shadertoy share link/)

	// The key is never put anywhere but the query string of the API call.
	let seen = ''
	await fetchShadertoyShader('lldcR8', 'SECRET', {
		fetchImpl: async (url) => {
			seen = url
			return { ok: true, json: async () => API_JSON }
		},
	})
	assert.match(seen, /^https:\/\/www\.shadertoy\.com\/api\/v1\/shaders\/lldcR8\?key=SECRET$/)

	await assert.rejects(
		() => fetchShadertoyShader('lldcR8', 'k', { fetchImpl: async () => ({ ok: false, status: 403 }) }),
		/HTTP 403/,
	)
	await assert.rejects(
		() =>
			fetchShadertoyShader('lldcR8', 'k', {
				fetchImpl: async () => ({ ok: true, json: async () => ({ Error: 'Shader not found' }) }),
			}),
		/Shader not found/,
	)
})

test('WO-380 the modal imports without overwriting the open shader', () => {
	const modal = read('client/components/shader-fx-modal.js')
	assert.ok(/id="shaderfx-import-url"/.test(modal))
	assert.ok(/shaderfx-import-go/.test(modal))
	assert.ok(/currentId = null/.test(modal), 'an import is a NEW shader, never an overwrite')
	assert.ok(/review and save/.test(modal), 'the operator saves it themselves')
	assert.ok(/e\.key === 'Enter'/.test(modal), 'a pasted link is usually followed by Enter')

	const routes = read('src/api/routes-shaders.js')
	assert.ok(/p === '\/api\/shaders\/import'/.test(routes))
	assert.ok(/jsonBody\(\{ ok: true, config \}\)/.test(routes), 'the endpoint returns a config, it does not save')
	assert.ok(/shadertoyApiKey \|\| process\.env\.SHADERTOY_API_KEY/.test(routes))
	assert.ok(/routes\.post\('\/api\/shaders\/import'/.test(read('src/api/router.js')))
})
