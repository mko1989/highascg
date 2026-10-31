'use strict'

/**
 * WO-580 — Shader Live "Speed ×" rides the player's clock rate instead of rewriting the iTime multipliers: the eased
 * clock (player-live.js) never jumps the phase, the op sends CG UPDATE `{ timeScale }` (no source push, no recompile),
 * reset / reset-all put 1 back, and Save bakes the ride into the child's literals. The shader store is stubbed.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const store = require('../../src/shaderfx/shader-store')

const ROOT = path.join(__dirname, '..', '..')
const Live = require(path.join(ROOT, 'template', 'shaders', 'player-live.js'))

const SRC =
	'void mainImage(out vec4 o, in vec2 f) {\n' +
	'\tfloat a = sin(iTime * 0.5 + f.x);\n' +
	'\tfloat b = cos(iTime * 0.7 + f.y);\n' +
	'\to = vec4(a, b, 0.5, 1.0);\n}\n'
const lib = { 'sh-speed': { id: 'sh-speed', name: 'Speed', common: '', passes: { image: { source: SRC } } } }
const saved = []
store.getShader = async (id) => (lib[id] ? JSON.parse(JSON.stringify(lib[id])) : null)
store.listShaders = async () => Object.values(lib).map((x) => ({ id: x.id }))
store.saveShader = async (cfg) => {
	saved.push(JSON.parse(JSON.stringify(cfg)))
	return { config: cfg, casparPath: `shaders/${cfg.id}` }
}

const liveSceneState = require('../../src/state/live-scene-state')
const LIVE = {
	1: { scene: { id: 'a', name: 'A', layers: [{ layerNumber: 3, source: { value: 'shaders/sh-speed' } }] } },
}
liveSceneState.getAll = () => LIVE
liveSceneState.getChannel = (ch) => LIVE[ch] || null

const S = require('../../src/shaderfx/shader-live-session')
const Ops = require('../../src/shaderfx/shader-live-ops')

function makeCtx() {
	const sent = []
	return {
		sent,
		config: {},
		programLayerBankByChannel: {},
		playlistActiveIndices: {},
		amcp: { raw: async (l) => (sent.push(l), { ok: true }) },
	}
}

/** What routes-shader-live.js handleOp does with an op result (items → pushLive, timeScale → pushTimeScale). */
async function apply(ctx, s, r) {
	let passes = r.passes || []
	if (r.items?.length) passes = await S.applyBatch(s, r.items)
	if (passes.length) await S.pushLive(ctx, 'sh-speed', s, passes)
	if (r.timeScale != null) {
		s.timeScale = r.timeScale
		await S.pushTimeScale(ctx, 'sh-speed', s)
	}
}

test('the clock eases to its rate and iTime never jumps', () => {
	assert.deepEqual(
		[Live.rateOf(0.5), Live.rateOf(100), Live.rateOf(0), Live.rateOf('x'), Live.rateOf(-2)],
		[0.5, 10, 1, 1, 1]
	)
	let rate = 1
	for (let i = 0; i < 21; i++) rate = Live.step(rate, 0.5, 1 / 60).rate // 0.35 s
	assert.ok(rate > 0.66 && rate < 0.7, `≈63% of the way after TAU (${rate})`)
	for (let i = 0; i < 600; i++) rate = Live.step(rate, 0.5, 1 / 60).rate
	assert.equal(rate, 0.5, 'snaps onto the target')
	assert.equal(Live.step(1, 1, 5).extra, 0, 'at rate 1 iTime is real time')

	// 20 min on air, then Speed 1 → 0.5 → 4 → 0.05: every frame's iTime step stays within the rates' bounds.
	let t = 0
	let r = 1
	const dt = 1 / 60
	for (const [target, frames] of [
		[1, 72000],
		[0.5, 120],
		[4, 120],
		[0.05, 120],
	]) {
		for (let i = 0; i < frames; i++) {
			const st = Live.step(r, target, dt)
			const inc = dt + st.extra
			assert.ok(inc >= dt * 0.05 - 1e-12 && inc <= dt * 10 + 1e-12, `frame step ${inc}`)
			assert.ok(
				Math.abs(inc - dt * r) <= dt * Math.abs(target - r) + 1e-12,
				'moves by the current rate, not the source multiplier'
			)
			r = st.rate
			t += inc
		}
	}
	assert.ok(t > 1200, 'time went on')

	// create(): drives ShaderToyLite.addTime with the per-frame extra.
	let added = 0
	let target = 1
	const clock = Live.create({ toy: { addTime: (s) => (added += s) }, target: () => target })
	clock.frame()
	assert.equal(added, 0, 'rate 1: no extra time')
	target = 0.25
	for (let i = 0; i < 5; i++) clock.frame()
	assert.ok(clock.rate() < 1, 'the rate follows the CG UPDATE value')
})

test('Speed × sends { timeScale }, rewrites nothing; reset / reset-all / save', async () => {
	const ctx = makeCtx()
	const s = await S.open('sh-speed')
	const v0 = await S.view('sh-speed', s)
	const speed = v0.controls.find((c) => c.id === S.SPEED_MACRO)
	assert.ok(speed, 'two iTime multipliers → a Speed × macro')
	assert.equal(speed.factor, 1)
	const source0 = S.sourceOf(s.cfg, 'image')

	const r = await Ops.run('macro', { control: S.SPEED_MACRO, factor: 0.5 }, s, { ctx, id: 'sh-speed' })
	assert.equal(r.timeScale, 0.5)
	assert.ok(!r.items?.length, 'no literal rewrite')
	await apply(ctx, s, r)
	assert.deepEqual(ctx.sent, ['CG 1-3 UPDATE 0 "{\\"timeScale\\":0.5}"'], 'one CG UPDATE, no source')
	assert.equal(S.sourceOf(s.cfg, 'image'), source0, 'source untouched')
	assert.equal(
		(await S.view('sh-speed', s)).controls.find((c) => c.id === S.SPEED_MACRO).factor,
		0.5,
		'the slider shows the ride'
	)
	assert.equal(await S.open('sh-speed'), s, 'a ride keeps the session')

	// Another edit while riding: the pass push carries the rate (a 403 re-host would start at 1).
	ctx.sent.length = 0
	const pushed = await S.pushLive(ctx, 'sh-speed', s, ['image'])
	assert.equal(pushed.errors.length, 0)
	assert.match(ctx.sent[0], /\\"timeScale\\":0\.5/)

	// Save bakes the ride into the literals; the live session keeps its source and rate.
	const out = await Ops.run('save', {}, s, { ctx, id: 'sh-speed' })
	const child = saved.at(-1)
	assert.equal(out.extra?.savedAs || child.id, child.id)
	assert.match(child.passes.image.source, /iTime \* 0\.25\b/)
	assert.match(child.passes.image.source, /iTime \* 0\.35\b/)
	assert.equal(S.sourceOf(s.cfg, 'image'), source0, 'the session copy is not rewritten')
	assert.equal(S.timeScaleOf(s), 0.5)

	ctx.sent.length = 0
	const rr = await Ops.run('reset', { control: S.SPEED_MACRO }, s, { ctx, id: 'sh-speed' })
	assert.equal(rr.timeScale, 1, 'reset Speed → rate 1')
	await apply(ctx, s, rr)
	assert.deepEqual(ctx.sent, ['CG 1-3 UPDATE 0 "{\\"timeScale\\":1}"'])

	s.timeScale = 2
	const ra = await Ops.run('reset', {}, s, { ctx, id: 'sh-speed' })
	assert.equal(ra.timeScale, 1, 'reset all → rate 1')

	const rnd = await Ops.run('randomize', {}, s, { ctx, id: 'sh-speed' })
	assert.ok(rnd.timeScale >= 0.6 - 1e-9 && rnd.timeScale <= 1.7 + 1e-9, 'randomize rides the rate')
	assert.ok(!(rnd.items || []).some((it) => speed.keys.includes(it.p.key)), 'and leaves the time literals alone')
})

test('player.js / ShaderToyLite carry the live clock', () => {
	const player = fs.readFileSync(path.join(ROOT, 'template', 'shaders', 'player.js'), 'utf8')
	assert.match(player, /el\.src = 'player-live\.js'/)
	assert.match(player, /if \(!THUMB_MODE\) initLive\(\)/)
	assert.match(player, /if \(liveClock\) liveClock\.frame\(\)/)
	assert.match(player, /if \(data\.timeScale != null\) timeScale = Number\(data\.timeScale\)/)
	const toy = fs.readFileSync(path.join(ROOT, 'template', 'shaders', 'ShaderToyLite.js'), 'utf8')
	assert.match(toy, /if \(sec\) firstDrawTime -= sec \* 1000;/)
	const route = fs.readFileSync(path.join(ROOT, 'src', 'api', 'routes-shader-live.js'), 'utf8')
	assert.match(route, /if \(r\.timeScale != null\) \{\n\t+s\.timeScale = r\.timeScale/)
	assert.match(route, /await S\.pushTimeScale\(ctx, id, s\)/)
})

// Phase B — the glide: literal-only edits ease through uniforms (one compile, then none while dragging); else the hard path.
const G_SRC =
	'// speed 9.0\nconst float K = 0.5;\nfloat g = 2.0;\n#define AMP 0.3\nvoid mainImage(out vec4 o, in vec2 f) {\n\tconst float L = 4.0;\n\tvec2 p = f * 1.5 + vec2(.25, 1e2);\n\to = vec4(p * AMP, 0.7, 1.0);\n}\n'

test('glide: literals, diff and which may become uniforms', () => {
	const { m, lits } = Live.parse(G_SRC)
	assert.deepEqual(
		lits.map((l) => l.v),
		[0.5, 2.0, 0.3, 4.0, 1.5, 0.25, 100, 0.7, 1.0],
		'floats only: no comment, int, vec2 / vec4 digit'
	)
	const el = lits.map((l) => Live.eligible(m, l))
	assert.deepEqual(
		el,
		[false, false, true, false, true, true, true, true, true],
		'not in a const or a global initialiser; a #define may'
	)
	const MAC = '#define PI 3.14\n#define TAU (2.0 * PI)\n#define GAIN 0.8\n#define AMP2 (GAIN * 1.5)\nconst float T = TAU;\nvoid mainImage(out vec4 o, in vec2 f) { o = vec4(AMP2); }\n'
	const pm = Live.parse(MAC)
	assert.deepEqual(
		pm.lits.map((l) => [l.v, Live.eligible(pm.m, l)]),
		[[3.14, false], [2.0, false], [0.8, true], [1.5, true]],
		'a macro glides only when every use (through other macros) may'
	)
	const d = Live.diff(G_SRC, G_SRC.replace('1.5', '1.75').replace('0.7,', '0.65,'))
	assert.deepEqual(d.changed, [4, 7])
	assert.equal(Live.diff(G_SRC, G_SRC.replace('f * 1.5', 'f / 1.5')), null, 'a structural edit')
	assert.equal(
		Live.diff(G_SRC, G_SRC.replace('speed 9.0', 'speed 3.0')),
		null,
		'a comment edit is not a value (the hard path applies it)'
	)
	const out = Live.build(
		G_SRC,
		lits,
		new Map([
			[4, 0],
			[7, 1],
		]),
		'_hgG_image'
	)
	assert.match(out, /^uniform float _hgG_image\[32\];\n/)
	assert.match(out, /f \* _hgG_image\[0\] \+ vec2\(\.25, 1e2\)/)
	assert.match(out, /vec4\(p \* AMP, _hgG_image\[1\], 1\.0\)/)
})

test('glide: one compile, drags retarget, eases; ineligible / failed compile / overflow → hard', () => {
	const calls = []
	let failVariant = false
	const glides = {}
	const toy = {
		setImage: (c) => calls.push(c.source),
		setCommon: (s) => calls.push('common:' + s),
		setGlide: (n, v) => (v ? (glides[n] = v) : delete glides[n]),
		compiled: () => !(failVariant && /_hgG_/.test(calls[calls.length - 1])),
	}
	const config = { common: '', passes: { image: { source: G_SRC, channels: [] } } }
	const g = Live.createGlide({ toy, config, passConfig: (p) => p })
	const st = () => g.state().image

	g.apply({ passes: { image: { source: G_SRC.replace('1.5', '2.5') } } })
	assert.equal(calls.length, 1, 'one compile')
	assert.match(calls[0], /f \* _hgG_image\[0\]/)
	assert.deepEqual([st().cur[0], st().to[0]], [1.5, 2.5], 'starts at the old value')
	assert.equal(config.passes.image.source, G_SRC.replace('1.5', '2.5'), 'the player keeps the real source')
	for (let i = 0; i < 5; i++) g.frame(0.07) // dt is clamped to 0.1 s per frame
	assert.ok(Math.abs(st().cur[0] - (2.5 - Math.exp(-1))) < 1e-6, '≈63 % after τ')
	g.apply({ passes: { image: { source: G_SRC.replace('1.5', '0.5') } } })
	assert.equal(calls.length, 1, 'a drag on the same literal: no compile')
	assert.equal(st().to[0], 0.5)
	for (let i = 0; i < 300; i++) g.frame(1 / 30)
	assert.ok(Math.abs(st().cur[0] - 0.5) < 1e-6, 'arrives')
	const at = st().cur[0]
	g.apply({ passes: { image: { source: G_SRC.replace('1.5', '0.5').replace('0.7,', '0.2,') } } })
	assert.equal(calls.length, 2, 'another literal: one more compile')
	assert.match(calls[1], /_hgG_image\[0\][\s\S]*_hgG_image\[1\]/)
	assert.deepEqual(
		[st().cur[0], st().cur[1], st().to[1]].map((v) => Math.round(v * 1000) / 1000),
		[at, 0.7, 0.2],
		'slot 0 keeps its value'
	)
	assert.equal(glides._hgG_image, st().cur, 'the toy reads the eased array')

	g.apply({ passes: { image: { source: G_SRC.replace('const float L = 4.0', 'const float L = 5.0') } } })
	assert.equal(calls[2], G_SRC.replace('const float L = 4.0', 'const float L = 5.0'), 'a const → the plain source')
	assert.equal(glides._hgG_image, undefined, 'and no glide')
	failVariant = true
	const next = G_SRC.replace('const float L = 4.0', 'const float L = 5.0').replace('0.7,', '0.9,')
	g.apply({ passes: { image: { source: next } } })
	assert.deepEqual([calls.length, calls[4]], [5, next], 'a failed variant → the plain source')
	failVariant = false
	g.apply({ common: 'float h(float x) { return x * 0.5; }\n' })
	assert.equal(calls.length, 6, 'common without a running source → set as is')
	g.apply({ common: 'float h(float x) { return x * 0.6; }\n' })
	assert.match(calls[6], /^common:uniform float _hgG_common\[32\];/)
	const { lits } = Live.parse(next)
	assert.ok(lits.length < 33)
	const big =
		'void mainImage(out vec4 o, in vec2 f) {\n' +
		Array.from({ length: 40 }, (_, i) => `\to.x += ${i}.5;\n`).join('') +
		'}\n'
	config.passes.image.source = big
	g.apply({ passes: { image: { source: big.replace(/(\d+)\.5/g, '$1.25') } } })
	assert.doesNotMatch(calls[calls.length - 1], /_hgG_/, 'more than 32 changed literals → hard')
})

test('phase B wiring: player.js hands source updates to the glide, ShaderToyLite sets the arrays', () => {
	const player = fs.readFileSync(path.join(ROOT, 'template', 'shaders', 'player.js'), 'utf8')
	assert.match(player, /if \(!\(liveClock && liveClock\.apply\(data\)\)\) applyLiveSourceUpdate\(data\)/)
	assert.match(player, /create\(\{ toy, target: \(\) => timeScale, config, passConfig \}\)/)
	const toy = fs.readFileSync(path.join(ROOT, 'template', 'shaders', 'ShaderToyLite.js'), 'utf8')
	assert.match(toy, /this\.setGlide = \(name, values\) =>/)
	assert.match(toy, /this\.compiled = \(key\) =>/)
	assert.match(toy, /if \(g\[n\]\) gl\.uniform1fv\(g\[n\], glideU\[n\]\);/)
	assert.match(toy, /location\[key\]\["glide"\]\s+= \{\};/)
})
