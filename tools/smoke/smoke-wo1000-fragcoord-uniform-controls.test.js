'use strict'

/**
 * WO-1000 — a FragCoord shader's own controls in the Shader Live session: the uniform parse (same rules as
 * fragcoord_glsl.gd uniforms(), pinned by the same cases as godot/client/tests/test_fragcoord_glsl.gd), the view rows,
 * set / reset / presets / reset-all / Save-as-child through `cfg.values`, and the Godot wiring. The store is stubbed.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const store = require('../../src/shaderfx/shader-store')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const MAIN = `uniform float u_speed; //1.5, [0.0, 6.0]
uniform vec3 u_tint;   //1.0, 0.55, 0.2, [0.0, 1.0]
uniform float u_gain = 0.25; //[0.0, 5.0]
uniform vec2 u_off = vec2(0.5);
uniform float u_lo; //[2.0, 4.0]
uniform int u_n; //3
uniform sampler2D u_tex; //https://example.com/a.png
uniform vec2 u_resolution;
uniform sampler2D u_pass1;
void main() {
	vec2 uv = gl_FragCoord.xy / u_resolution.xy;
	fragColor = vec4(u_tint * texture(u_audio, vec2(uv.x, 0.0)).r * u_speed * 0.5, 1.0);
}
`
const COMMON = 'uniform float u_speed; //9.0\nuniform bool u_on; //1\n'
const FC = { id: 'sh-fc-test', name: 'FC', dialect: 'fragcoord', common: COMMON, passes: { main: { source: MAIN } }, values: { u_gain: 2 } }
const lib = { 'sh-fc-test': FC }
const saved = []
store.getShader = async (id) => (lib[id] ? JSON.parse(JSON.stringify(lib[id])) : null)
store.listShaders = async () => Object.values(lib).map((x) => ({ id: x.id }))
store.saveShader = async (cfg) => {
	saved.push(JSON.parse(JSON.stringify(cfg)))
	return { config: cfg, casparPath: null }
}

const U = require('../../src/shaderfx/fragcoord-uniforms')
const S = require('../../src/shaderfx/shader-live-session')
const Ops = require('../../src/shaderfx/shader-live-ops')
const env = { ctx: { amcp: { raw: async () => ({}) }, config: {} }, id: 'sh-fc-test' }

test('the parse matches fragcoord_glsl.gd uniforms(): order, defaults, ranges, skips', () => {
	const us = U.fragcoordUniforms(FC)
	assert.deepEqual(
		us.map((u) => u.name),
		['u_speed', 'u_on', 'u_tint', 'u_gain', 'u_off', 'u_lo', 'u_n'],
		'common first, textures / built-ins / u_passN left out, first declaration wins'
	)
	const by = Object.fromEntries(us.map((u) => [u.name, u]))
	assert.deepEqual(by.u_speed.values, [9], "common's u_speed wins over main's")
	assert.deepEqual(by.u_tint.values, [1, 0.55, 0.2])
	assert.deepEqual([by.u_tint.min, by.u_tint.max], [0, 1])
	assert.deepEqual(by.u_gain.values, [0.25], 'an initialiser is the default')
	assert.deepEqual(by.u_off.values, [0.5, 0.5], 'vec2(0.5) fills both, and the 2 of vec2 is not a number')
	assert.deepEqual(by.u_lo.values, [2], 'no default: 0 pulled into the range')
	assert.deepEqual(by.u_n.values, [3])
	assert.deepEqual(U.fragcoordUniforms({ ...FC, passes: { pass1: { source: MAIN } } }), [], 'no main, nothing')
	const many = Array.from({ length: 20 }, (_, i) => `uniform float u_k${i}; //1`).join('\n')
	assert.equal(U.fragcoordUniforms({ passes: { main: { source: many } } }).length, U.SLOTS, 'at most 16 value slots')
})

test('view rows: widget kinds, current values over defaults, changed vs the library', () => {
	const rows = U.uniformParams(FC, FC.values)
	const by = Object.fromEntries(rows.map((r) => [r.name, r]))
	assert.equal(by.u_tint.key, 'u:u_tint')
	assert.equal(by.u_tint.kind, 'color', 'a vec3 in 0..1 is a colour')
	assert.equal(by.u_on.kind, 'toggle')
	assert.equal(by.u_n.step, 1, 'ints step by 1')
	assert.deepEqual([by.u_lo.min, by.u_lo.max], [2, 4])
	assert.deepEqual([by.u_speed.min, by.u_speed.max], [0, 18], "common's u_speed has no range (it wins): 0..2× the value")
	assert.deepEqual(by.u_gain.values, [2], 'the stored value wins over the default')
	assert.deepEqual(by.u_gain.defaults, [0.25])
	assert.ok(rows.every((r) => !r.changed), 'nothing changed against the library')
	assert.ok(by.u_off.max >= 1 && by.u_off.min <= 0, 'no range: a slider around the value')
	assert.deepEqual(U.uniformParams({ ...FC, dialect: undefined }, {}), [], 'Shadertoy configs have none')
})

test('set / reset / clamp through the session; values only, the source never changes', async () => {
	const s = await S.open('sh-fc-test')
	const v0 = await S.view('sh-fc-test', s)
	assert.equal(v0.uniforms.length, 7)
	assert.equal(v0.dirty, false)
	const r = await Ops.run('set', { key: 'u:u_speed', values: [4.5] }, s, env)
	assert.deepEqual(r, { items: [] }, 'no literal rewrite')
	assert.equal(s.cfg.values.u_speed, 4.5)
	await Ops.run('set', { key: 'u:u_tint', values: [2, 0.5, -1] }, s, env)
	assert.deepEqual(s.cfg.values.u_tint, [1, 0.5, 0], 'clamped into [0, 1]')
	await Ops.run('set', { key: 'u:u_n', values: [2.6] }, s, env)
	assert.equal(s.cfg.values.u_n, 3, 'ints round')
	assert.equal((await Ops.run('set', { key: 'u:u_tint', values: [1] }, s, env)).status, 400, 'wrong arity')
	assert.equal((await Ops.run('set', { key: 'u:u_nope', values: [1] }, s, env)).status, 400, 'unknown uniform')
	const v1 = await S.view('sh-fc-test', s)
	assert.equal(v1.dirty, true)
	assert.ok(v1.uniforms.find((u) => u.name === 'u_speed').changed)
	assert.equal(S.workingOf(s).values.u_speed, 4.5, 'the working copy carries the values (Godot merged())')
	assert.equal(S.workingOf(s).passes.main.source, MAIN, 'the source is untouched')
	assert.equal(await S.open('sh-fc-test'), s, 'an edited session survives a reopen')
	await Ops.run('reset', { key: 'u:u_speed' }, s, env)
	assert.equal(s.cfg.values.u_speed, undefined, 'reset drops a value the library did not have')
	await Ops.run('set', { key: 'u:u_gain', values: [3] }, s, env)
	await Ops.run('reset', { key: 'u:u_gain' }, s, env)
	assert.equal(s.cfg.values.u_gain, 2, "reset restores the library's stored value")
})

test('presets carry the controls; Original and reset-all restore; Save as child keeps the values', async () => {
	const s = await S.open('sh-fc-test')
	await Ops.run('set', { key: 'u:u_speed', values: [5] }, s, env)
	const ps = await Ops.run('preset-save', { name: 'Fast' }, s, env)
	const preset = ps.manifest.presets.find((p) => p.name === 'Fast')
	assert.deepEqual(preset.v['u:u_speed'], [5])
	s.cfg.controls = ps.manifest
	await Ops.run('preset', { original: true }, s, env)
	assert.deepEqual(s.cfg.values, { u_gain: 2 }, 'Original = the library values')
	await Ops.run('preset', { name: 'Fast' }, s, env)
	assert.equal(s.cfg.values.u_speed, 5)
	assert.ok((await S.view('sh-fc-test', s)).dirty)
	const child = await Ops.run('save', {}, s, env)
	assert.match(child.extra.savedAs, /^sh-fc-test-c\d+$/)
	assert.equal(saved.at(-1).values.u_speed, 5, 'the child is saved with the controls')
	assert.equal(saved.at(-1).dialect, 'fragcoord')
	assert.equal(await S.open('sh-fc-test'), s, 'after Save as child the session keeps the values (mouse test 08.11: the stage went back)')
	assert.equal(S.workingOf(s).values.u_speed, 5)
	await Ops.run('set', { key: 'u:u_speed', values: [1] }, s, env)
	await Ops.run('reset', {}, s, env)
	assert.deepEqual(s.cfg.values, { u_gain: 2 }, 'reset all = the library values')
	assert.equal((await S.view('sh-fc-test', s)).dirty, false)
})

test('Godot: merged() takes the values, the panel draws the controls first and posts u: keys', () => {
	const sync = read('godot/client/features/visuals/visuals_shader_sync.gd')
	assert.match(sync, /if working\.get\("values"\) is Dictionary:[^\n]*\n\t\tcfg\["values"\] = \(working\.values as Dictionary\)\.duplicate\(true\)/)
	const mode = read('godot/client/features/visuals/visuals_shader_mode.gd')
	assert.match(mode, /_main\.add_child\(W\.group\("Shader controls", _uniform_rows\(us\)\)\)/)
	assert.match(mode, /for p in v\.get\("params", \[\]\) \+ v\.get\("uniforms", \[\]\):/)
	assert.match(mode, /_key_cards\.append\(\{"label": name\.text, "card": row\}\)/, 'MIDI knobs follow them')
	const rd = read('godot/client/features/visuals/fragcoord_rd.gd')
	assert.match(rd, /if key == _key and not _spirv\.is_empty\(\):\n\t\t_values = values\n\t\treturn ""/, 'a values-only change compiles nothing')
})

test('the store keeps presets, labels and the Save-as-child parent on a FragCoord shader (normalizeShaderConfig)', () => {
	const real = require('../../src/shaderfx/shader-store')
	const out = real.normalizeShaderConfig({
		...FC,
		id: 'sh-fc-test-c2',
		parentId: 'sh-fc-test',
		paramLabels: { 'u:u_speed': 'Speed' },
		controls: { pinned: [], hidden: [], presets: [{ name: 'Fast', v: { 'u:u_speed': [5], 'u:u_tint': [1, 0, 0] } }] },
	})
	assert.equal(out.dialect, 'fragcoord')
	assert.equal(out.parentId, 'sh-fc-test')
	assert.deepEqual(out.paramLabels, { 'u:u_speed': 'Speed' })
	assert.deepEqual(out.controls.presets[0].v, { 'u:u_speed': [5], 'u:u_tint': [1, 0, 0] }, 'u: keys survive the manifest bounds')
	assert.deepEqual(out.values, { u_gain: 2 })
})
