'use strict'

/**
 * WO-1089 — Stage Salad's presenter avatar is a TWIN of the previs avatar (godot/client/features/previs/tracking/
 * person_avatar.gd + person_avatar_model.gd, WO-1086): this smoke reads the Godot text and checks the three.js table
 * (modules/stage-salad/client/avatar-body.js) — the unit frame constants, every `_part(…)` of the figure (position and
 * size, both sides), the capsule sizes, the fixed colours, the neutral look, shoes / blush rules, and (when the Godot
 * file has them) the smile arc and the self-light. A change on either side without the other fails here.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { ROOT, shared } = require('./lib/salad-fixtures')

const B = shared().body
const DIR = path.join(ROOT, 'godot', 'client', 'features', 'previs', 'tracking')
const GD = fs.readFileSync(path.join(DIR, 'person_avatar.gd'), 'utf8')
const MODEL = fs.readFileSync(path.join(DIR, 'person_avatar_model.gd'), 'utf8')
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

/** `const NAME := <number>` of the .gd text. */
function constNum(name) {
	const m = GD.match(new RegExp(`^const ${name} := (-?[\\d.]+)`, 'm'))
	return m ? Number(m[1]) : null
}
const CONSTS = { UNIT_TOP: constNum('UNIT_TOP'), HIP_Y: constNum('HIP_Y'), HEAD_Y: constNum('HEAD_Y'), HEAD_R: constNum('HEAD_R') }

/** A tiny evaluator for the .gd's literal arithmetic: numbers, + − × ÷, the named constants, `side`, SHOULDER.x/.y. */
function evalExpr(src, side) {
	const s = src
		.replace(/SHOULDER\.x/g, String(B.SHOULDER[0]))
		.replace(/SHOULDER\.y/g, String(B.SHOULDER[1]))
		.replace(/\bside\b/g, `(${side})`)
		.replace(/\b(UNIT_TOP|HIP_Y|HEAD_Y|HEAD_R)\b/g, (k) => String(CONSTS[k]))
	assert.match(s, /^[\d.\s+\-*/()]+$/, `literal arithmetic only: ${src}`)
	const tok = s.match(/\d+\.?\d*|\.\d+|[+\-*/()]/g)
	let i = 0
	const atom = () => {
		const t = tok[i++]
		if (t === '(') {
			const v = sum()
			i++
			return v
		}
		if (t === '-') return -atom()
		return Number(t)
	}
	const prod = () => {
		let v = atom()
		while (tok[i] === '*' || tok[i] === '/') v = tok[i++] === '*' ? v * atom() : v / atom()
		return v
	}
	const sum = () => {
		let v = prod()
		while (tok[i] === '+' || tok[i] === '-') v = tok[i++] === '+' ? v + prod() : v - prod()
		return v
	}
	return sum()
}

/** Split `a, b, c` at top-level commas. */
function args(src) {
	const out = []
	let depth = 0
	let cur = ''
	for (const ch of src) {
		if (ch === ',' && depth === 0) (out.push(cur.trim()), (cur = ''))
		else {
			if (ch === '(') depth++
			if (ch === ')') depth--
			cur += ch
		}
	}
	if (cur.trim()) out.push(cur.trim())
	return out
}
function vec(src, side) {
	if (src === 'Vector3.ZERO') return [0, 0, 0]
	let m = src.match(/^Vector3\.ONE \* (.+)$/)
	if (m) return [0, 0, 0].map(() => evalExpr(m[1], side))
	m = src.match(/^Vector3\((.*)\)$/)
	assert.ok(m, `a Vector3: ${src}`)
	return args(m[1]).map((a) => evalExpr(a, side))
}

test('unit frame constants match', () => {
	for (const k of ['UNIT_TOP', 'HIP_Y', 'HEAD_Y', 'HEAD_R', 'POS_RATE']) assert.equal(B[k], constNum(k), k)
	const sh = GD.match(/^const SHOULDER := Vector3\(([^)]*)\)/m)
	assert.deepEqual(args(sh[1]).map(Number), B.SHOULDER)
	const sl = constNum('SELF_LIGHT')
	if (sl != null) assert.equal(B.SELF_LIGHT, sl, 'SELF_LIGHT')
	const vw = constNum('VEL_WINDOW')
	assert.equal(vw, 0.6, 'the walking-speed baseline the server copies (salad-presenters VEL_WINDOW)')
})

test('every _part of the Godot figure is in the twin\'s table (position + size, both sides) and vice versa', () => {
	const flat = []
	for (const [name, at] of Object.entries(B.MESH.pivots)) {
		const limb = B.MESH.limbs[name.split('_')[0]]
		for (const p of limb) flat.push({ parent: name.split('_')[0], at: p.at, s: p.s || [1, 1, 1], kind: p.kind, used: false, pivot: at })
	}
	for (const p of B.MESH.body) if (p.kind !== 'smile') flat.push({ parent: 'body', at: p.at, s: p.s || [1, 1, 1], kind: p.kind, used: false })
	let seen = 0
	for (const line of GD.split('\n')) {
		const m = line.match(/_part\((\w+), s\.(\w+), [\w.]+, (.*)\)\s*(#.*)?$/)
		if (!m || m[3].startsWith('smile_point') || m[2] === 'smile') continue
		const parent = m[1] === '_body' || m[1].startsWith('hair') ? 'body' : m[1]
		const a = args(m[3])
		for (const side of /\bside\b/.test(m[3]) ? [1, -1] : [1]) {
			const at = vec(a[0], side)
			const size = a[1] ? vec(a[1], side) : [1, 1, 1]
			const hit = flat.find((f) => f.parent === parent && f.at.every((v, j) => near(v, at[j])) && f.s.every((v, j) => near(v, size[j])))
			assert.ok(hit, `${line.trim()} (side ${side}) → at ${at} size ${size} missing in MESH`)
			hit.used = true
			seen++
		}
	}
	assert.ok(seen >= 15, `${seen} parts read`)
	const unused = flat.filter((f) => !f.used && f.parent === 'body')
	assert.deepEqual(unused.map((f) => f.at), [], 'nothing in the twin that the previs does not have')
	for (const [k, side] of [['leg_l', 1], ['leg_r', -1]]) assert.ok(new RegExp(`_pivot\\("${k.slice(0, 3)}_l" if side > 0 else "${k.slice(0, 3)}_r", Vector3\\(0\\.065 \\* side, HIP_Y, 0\\.0\\)\\)`).test(GD) && near(B.MESH.pivots[k][0], 0.065 * side))
})

test('capsules, fixed colours, neutral look, shoes and blush rules match', () => {
	const caps = Object.fromEntries([...GD.matchAll(/"(\w+)": _capsule\(([\d.]+), ([\d.]+)\)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]))
	assert.deepEqual(caps.leg, [B.MESH.limbs.leg[0].r, B.MESH.limbs.leg[0].h])
	assert.deepEqual(caps.arm, [B.MESH.limbs.arm[0].r, B.MESH.limbs.arm[0].h])
	const torso = B.MESH.body.find((p) => p.kind === 'cap' && p.mat === 'top')
	const long = B.MESH.body.find((p) => p.kind === 'cap' && p.hair === 'long')
	assert.deepEqual(caps.torso, [torso.r, torso.h])
	assert.deepEqual(caps.long, [long.r, long.h])
	for (const name of ['eye', 'mouth', 'glint']) {
		const m = GD.match(new RegExp(`${name}\\.albedo_color = Color\\(([^)]*)\\)`))
		if (!m && name === 'glint') continue
		assert.deepEqual(args(m[1]).map(Number), B.MESH.fixed[name], name)
	}
	const neutral = Object.fromEntries([...MODEL.match(/const NEUTRAL := \{([\s\S]*?)\}/)[1].matchAll(/"(\w+)": Color\(([^)]*)\)/g)].map((m) => [m[1], args(m[2]).map(Number)]))
	for (const k of ['top', 'bottom', 'skin', 'hair']) assert.deepEqual(B.NEUTRAL[k], neutral[k], `NEUTRAL.${k}`)
	assert.match(MODEL, /out\["shoes"\] = \(out\.bottom as Color\)\.darkened\(0\.55\)/)
	assert.match(GD, /\(look\.skin as Color\)\.lerp\(Color\(1\.0, 0\.45, 0\.5\), 0\.45\)/)
	const lk = B.lookFrom({ bottom: [100, 100, 100], skin: [200, 150, 100] })
	assert.ok(near(lk.shoes[0], (100 / 255) * 0.45))
	assert.ok(near(lk.blush[1], (150 / 255) + (0.45 - 150 / 255) * 0.45))
})

test('the smile arc (when the previs has one) matches', (t) => {
	const m = GD.match(/^const SMILE := \{([^}]*)\}/m)
	if (!m) return t.skip('this person_avatar.gd has no SMILE constant')
	const g = Object.fromEntries([...m[1].matchAll(/"(\w+)": (-?[\d.]+)/g)].map((x) => [x[1], Number(x[2])]))
	assert.deepEqual(g, { ...B.SMILE })
	const p = B.smilePoint(B.SMILE.from)
	assert.ok(near(Math.hypot(p[0], p[1] - B.HEAD_Y, p[2]), B.HEAD_R + 0.002, 1e-3), 'laid on the face')
})
