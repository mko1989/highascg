/**
 * WO-577 — Shader Live key controls: the synthesis must work on ANY shader (no per-shader
 * authoring), keep the main panel small, and never emit junk labels. Runs over the whole
 * library plus synthetic shaders.
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '../..')
const libPromise = import(pathToFileURL(path.join(ROOT, 'client/lib/shader-controls.js')).href)
const scanPromise = import(pathToFileURL(path.join(ROOT, 'client/lib/shader-param-scan.js')).href)
const { normalizeShaderConfig } = require('../../src/shaderfx/shader-store.js')

const cfgOf = (image, common = '') => ({ common, passes: { image: { source: image } } })

function library() {
	const dir = path.join(ROOT, 'data/shaders')
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => ({ f, cfg: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }))
}

test('library: main panel stays small and never shows junk-named controls', async () => {
	const { scanShaderCfg, buildControls } = await libPromise
	const lib = library()
	assert.ok(lib.length > 10, 'library present')
	let raw = 0
	let main = 0
	for (const { f, cfg } of lib) {
		const params = scanShaderCfg(cfg)
		const { controls } = buildControls(params)
		raw += params.length
		main += controls.length
		assert.ok(controls.length <= 16, `${f}: ${controls.length} controls`)
		for (const c of controls) {
			assert.doesNotMatch(c.label, /^(value|x|y|z|w)( \d+)?$|^if arg|^col \(|arg \d/i, `${f}: junk label "${c.label}"`)
			assert.ok(c.keys.length >= 1 && c.section, `${f}: control shape`)
		}
	}
	// The whole point: an order of magnitude fewer things on screen than the raw flood.
	assert.ok(main * 4 < raw, `main panel (${main}) must be far smaller than the raw list (${raw})`)
})

test('universal: an unannotated foreign shader gets named, sectioned controls', async () => {
	const { scanShaderCfg, buildControls } = await libPromise
	const src = `
#define SPEED 1.5
#define MIRROR 1
const vec3 TINT = vec3(1.0, 0.2, 0.2);
const float GLOW_STRENGTH = 0.8;
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
	vec2 uv = fragCoord / iResolution.xy;
	float w = sin(uv.x * 12.0 + iTime * 0.7);
	fragColor = vec4(TINT * w * GLOW_STRENGTH, 1.0);
}`
	const { controls } = buildControls(scanShaderCfg(cfgOf(src)))
	const byLabel = Object.fromEntries(controls.map((c) => [c.label, c]))
	assert.equal(byLabel.Speed?.section, 'Motion')
	assert.equal(byLabel.Mirror?.widget, 'toggle', '#define X 1 becomes a switch')
	assert.equal(byLabel.Tint?.widget, 'color')
	assert.equal(byLabel['Glow strength']?.section, 'Look')
})

test('structural literals (texture coords, hash constants, resolution plumbing) stay out of the main panel', async () => {
	const { scanShaderCfg, buildControls } = await libPromise
	const src = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void mainImage(out vec4 o, in vec2 fc){
	vec2 uv = (2.0*fc - iResolution.xy) / iResolution.y;
	float a = texture(iChannel0, vec2(0.25, 0.75)).x;
	o = vec4(vec3(hash(uv), a, 0.5), 1.0);
}`
	const { controls } = buildControls(scanShaderCfg(cfgOf(src)))
	assert.equal(controls.length, 0, JSON.stringify(controls.map((c) => c.label)))
})

test('macro: many time multipliers collapse into one Speed × control; divisors run the right way', async () => {
	const { scanShaderCfg, buildControls, macroFactor } = await libPromise
	const { rewriteParamValues } = await scanPromise
	const src = `
void mainImage(out vec4 o, in vec2 fc){
	float a = sin(iTime * 0.5);
	float b = cos(iTime * 1.5);
	float c = sin(iTime / 8.0);
	o = vec4(a, b, c, 1.0);
}`
	const cfg = cfgOf(src)
	const params = scanShaderCfg(cfg)
	const { controls } = buildControls(params)
	const speed = controls.find((c) => c.id === 'macro:speed')
	assert.ok(speed, 'macro present')
	assert.equal(speed.keys.length, 3)
	assert.equal(speed.inverse.length, 1, 'the iTime / 8.0 divisor is flagged inverse')

	// Drive ×2 the way the panel does: multiply normal members, divide inverse ones.
	const pristine = new Map(params.map((p) => [p.key, [...p.values]]))
	let out = src
	const members = speed.keys.map((k) => params.find((p) => p.key === k)).sort((a, b) => b.spans[0].start - a.spans[0].start)
	for (const p of members) {
		const base = pristine.get(p.key)[0]
		out = rewriteParamValues(out, p, [speed.inverse.includes(p.key) ? base / 2 : base * 2])
	}
	assert.match(out, /iTime \* 1\.0\)/)
	assert.match(out, /iTime \* 3\.0\)/)
	assert.match(out, /iTime \/ 4\.0\)/, 'divisor halves so the animation is 2× faster')
	const after = scanShaderCfg(cfgOf(out))
	const k = macroFactor(after, speed, pristine)
	assert.ok(Math.abs(k - 2) < 1e-6, `macro reads back ×${k}`)
})

test('rewrite keeps integer literals integer (#define FLAG 1 feeds #if)', async () => {
	const { scanShaderCfg } = await libPromise
	const { rewriteParamValues } = await scanPromise
	const src = '#define FLAG 1\nvoid mainImage(out vec4 o, in vec2 fc){ o = vec4(1.0); }'
	const [p] = scanShaderCfg(cfgOf(src))
	assert.equal(rewriteParamValues(src, p, [0], { preserveInt: true }).split('\n')[0], '#define FLAG 0')
	assert.equal(rewriteParamValues(src, p, [0]).split('\n')[0], '#define FLAG 0.0', 'default keeps the WO-340 always-decimal contract')
	const f = '#define K 1.5\n'
	const [pf] = scanShaderCfg(cfgOf(f))
	assert.equal(rewriteParamValues(f, pf, [2], { preserveInt: true }).split('\n')[0], '#define K 2.0', 'float literals keep their decimal point')
})

test('keys survive editing a neighbouring literal; manifest pin/hide is honoured', async () => {
	const { scanShaderCfg, buildControls } = await libPromise
	const { rewriteParamValues } = await scanPromise
	const src = 'void mainImage(out vec4 o, in vec2 fc){ float s = 0.4; vec3 col = mix(vec3(0.1, 0.4, 0.9), vec3(0.9, 0.3, 0.1), s); o = vec4(col, 1.0); }'
	const before = scanShaderCfg(cfgOf(src))
	const keyed = before.find((p) => p.kind === 'color')
	// Edit the OTHER colour (its digits sit inside this key's context window) — key must not move.
	const other = before.filter((p) => p.kind === 'color')[1]
	const edited = rewriteParamValues(src, other, [0.5, 0.5, 0.5])
	const after = scanShaderCfg(cfgOf(edited))
	assert.ok(after.some((p) => p.key === keyed.key), 'key stable after neighbour edit')

	const hidden = buildControls(before, { manifest: { hidden: [keyed.key] } }).controls
	assert.ok(!hidden.some((c) => c.keys.includes(keyed.key)))
	const sl = before.find((p) => p.kind === 'slider')
	const pinned = buildControls(before, { manifest: { pinned: [{ key: sl.key, label: 'Blend', section: 'Look' }] } }).controls
	assert.equal(pinned.find((c) => c.keys.includes(sl.key))?.label, 'Blend')
})

test('store keeps a bounded controls manifest and drops junk', () => {
	const base = { name: 'T', passes: { image: { source: 'void mainImage(out vec4 o,in vec2 f){o=vec4(1.0);}', channels: [] } } }
	const out = normalizeShaderConfig({
		...base,
		controls: {
			pinned: [{ key: 'image:a', label: 'A'.repeat(200), section: 'Look' }, { key: 'image:a' }, { key: '' }, { key: 'image:b', section: 'Nope' }],
			hidden: ['image:h', 'image:h', ''],
			presets: [{ name: 'Calm', v: { 'image:a': [0.5], bad: 'x' } }, { name: '', v: {} }],
		},
	})
	assert.equal(out.controls.pinned.length, 2, 'dupes/empties dropped')
	assert.equal(out.controls.pinned[0].label.length, 60)
	assert.equal(out.controls.pinned[1].section, undefined, 'unknown section dropped')
	assert.deepEqual(out.controls.hidden, ['image:h'])
	assert.deepEqual(out.controls.presets, [{ name: 'Calm', v: { 'image:a': [0.5] } }])
	assert.equal(normalizeShaderConfig({ ...base, controls: { pinned: [], hidden: [], presets: [] } }).controls, undefined, 'empty manifest not stored')
})

test('editor wires the panel, persists without baking live edits (source asserts)', () => {
	const editor = fs.readFileSync(path.join(ROOT, 'client/components/shader-live-editor.js'), 'utf8')
	assert.match(editor, /createShaderControlsPanel\(\{/)
	assert.match(editor, /source: pristine\.passes\[k\]\.source/, 'persistCfg writes the PRISTINE source, never the live-edited one')
	assert.match(editor, /preserveInt: !!p\.intLiteral/, 'batch path keeps int defines int')
	assert.match(editor, /list\.sort\(\(a, b\) => b\.p\.spans\[0\]\.start - a\.p\.spans\[0\]\.start\)/, 'batch rewrites right-to-left')
})
