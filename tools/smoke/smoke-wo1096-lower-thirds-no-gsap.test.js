'use strict'

/**
 * WO-1096 — the lower thirds no longer ship GSAP (GreenSock's proprietary "standard license" cannot be redistributed
 * inside the AGPL project / the ISO). The templates run on our own template/lower-thirds/lt-tween.js.
 *  - no vendored gsap file anywhere under template/, no `gsap` reference in the templates or src/ (the boot-time
 *    upgrade of old studio exports is the one file that has to name it);
 *  - lt-tween.js loads in node: its eases and timeline maths are pinned here (GSAP-era values the templates were
 *    tuned with — the default ease is power1.out, a timeline `duration` is a lead-in);
 *  - the legacy-export upgrade is textual and idempotent.
 * Visual parity (every template, old GSAP vs LTTween, frame by frame) was checked in a headless browser; see WO-1096.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const LT_DIR = path.join(ROOT, 'template', 'lower-thirds')
const T = require(path.join(LT_DIR, 'lt-tween.js'))
const { migrateLegacyTweenHtml } = require(path.join(ROOT, 'src', 'cg-studio', 'legacy-tween-migrate.js'))

const GSAP_WORD = /(^|[^a-z])gsap/i
const MIGRATOR = path.join('src', 'cg-studio', 'legacy-tween-migrate.js')

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
		const fp = path.join(dir, ent.name)
		if (ent.isDirectory()) walk(fp, out)
		else out.push(fp)
	}
	return out
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`)

test('WO-1096: no vendored GSAP file under template/', () => {
	assert.equal(fs.existsSync(path.join(LT_DIR, 'vendor', 'gsap.min.js')), false)
	const hits = walk(path.join(ROOT, 'template')).filter((f) => /gsap/i.test(path.basename(f)))
	assert.deepEqual(hits, [])
})

test('WO-1096: no gsap reference in the lower thirds, studio templates or src/', () => {
	const files = [
		...walk(LT_DIR),
		...walk(path.join(ROOT, 'template', 'studio')),
		...walk(path.join(ROOT, 'src')),
	].filter((f) => /\.(js|html?|md|json|css)$/i.test(f))
	const hits = files
		.filter((f) => path.relative(ROOT, f) !== MIGRATOR)
		.filter((f) => GSAP_WORD.test(fs.readFileSync(f, 'utf8')))
		.map((f) => path.relative(ROOT, f))
	assert.deepEqual(hits, [])
})

test('WO-1096: every lt-*.html loads lt-tween.js before the engine', () => {
	const names = fs.readdirSync(LT_DIR).filter((n) => /^lt-.*\.html$/.test(n))
	assert.ok(names.length >= 10, names.join(','))
	for (const n of names) {
		const html = fs.readFileSync(path.join(LT_DIR, n), 'utf8')
		const tween = html.indexOf('<script src="lt-tween.js"></script>')
		assert.ok(tween > 0, `${n} loads lt-tween.js`)
		assert.ok(tween < html.indexOf('<script src="lt-engine.js"></script>'), `${n}: lt-tween.js before lt-engine.js`)
		assert.doesNotMatch(html, /vendor\//, n)
		assert.match(html, /LTTween\.timeline\(/, n)
	}
	const thumb = fs.readFileSync(path.join(ROOT, 'src', 'media', 'cg-look-thumb-render.js'), 'utf8')
	assert.match(thumb, /window\.LTTween\?\.isActive\?\.\(\)/, 'thumbnail settle waits on LTTween')
})

test('WO-1096: eases', () => {
	const e = (name, p) => T.parseEase(name)(p)
	close(e('power1.out', 0.5), 0.75, 'power1.out')
	close(e('power1', 0.5), 0.75, 'no suffix = out')
	close(e('quad.out', 0.5), 0.75, 'quad = power1')
	close(e('power2.in', 0.5), 0.125, 'power2.in')
	close(e('power2.out', 0.5), 0.875, 'power2.out')
	close(e('power2.inOut', 0.25), 0.0625, 'power2.inOut')
	close(e('power2.inOut', 0.75), 0.9375, 'power2.inOut')
	close(e('power3.out', 0.5), 0.9375, 'power3.out')
	close(e('power1.inOut', 0.5), 0.5, 'power1.inOut')
	close(e('none', 0.3), 0.3, 'none')
	close(e('linear', 0.3), 0.3, 'linear')
	close(e('back.out(2.2)', 0.5), 1.15, 'back.out(2.2)') // the confetti title pop overshoots
	close(e('back.out(2.2)', 0.25), 0.8875, 'back.out(2.2)')
	close(e('back.in', 0.5), 0.5 * 0.5 * (2.70158 * 0.5 - 1.70158), 'back.in default 1.70158')
	close(e('sine.out', 0.5), Math.sin(Math.PI / 4), 'sine.out')
	close(e('expo.in', 0.5), Math.pow(2, -5), 'expo.in')
	close(e('circ.out', 0.5), Math.sqrt(0.75), 'circ.out')
	close(e('bounce.out', 0.5), 0.765625, 'bounce.out')
	for (const n of [
		'power0',
		'power4.inOut',
		'expo.out',
		'circ.inOut',
		'back.inOut(1.2)',
		'elastic.out(1, 0.3)',
		'elastic.in',
		'bounce.in',
		'sine.inOut',
	]) {
		close(e(n, 0), 0, `${n}(0)`)
		close(e(n, 1), 1, `${n}(1)`)
	}
	assert.ok(e('elastic.out(1, 0.3)', 0.15) > 1, 'elastic overshoots')
	assert.equal(T.parseEase('power2.out'), T.parseEase('power2.out'), 'cached')
	const warn = console.warn
	console.warn = () => {}
	try {
		assert.equal(T.parseEase('wobble.out'), T.parseEase('power1.out'), 'unknown → power1.out')
	} finally {
		console.warn = warn
	}
})

test('WO-1096: timeline positions, defaults, stagger, labels, lead-in', () => {
	const a = { v: 0 }
	const b = { v: 0 }
	const c = { v: 0 }
	let done = 0
	// the classic-box shape: a set at 1 s, a 1.5 s draw, then '-=1' / '-=.9' from the end
	const tl = T.timeline({ onComplete: () => done++ })
	tl.set(a, { v: 0 }, 1).to(a, { v: 10, duration: 1.5 }).to(b, { v: 1 }, '-=1').to(c, { v: 1 }, '-=.9')
	assert.deepEqual(
		tl.children.map((k) => k.start),
		[1, 1, 1.5, 1.6]
	)
	close(tl.duration(), 2.5, 'duration')
	assert.ok(T.isActive())
	T.step(1250) // 0.25 s into the 1.5 s draw, default ease power1.out
	close(a.v, 10 * (1 - Math.pow(1 - 0.25 / 1.5, 2)), 'a mid-draw')
	assert.equal(b.v, 0, 'b not started')
	T.step(2000)
	assert.deepEqual([a.v, b.v, c.v, done], [10, 1, 1, 1])
	assert.equal(T.isActive(), false)

	// a `duration` var is a lead-in (what pre-WO-1096 exports were timed with); stagger; labels; '<'; defaults
	const objs = [{ s: 0 }, { s: 0 }, { s: 0 }]
	const tl2 = T.timeline({ duration: 1, defaults: { ease: 'none', duration: 0.4 } })
	tl2.to(objs, { s: 1, stagger: 0.1 }).addLabel('reveal').to(a, { v: 0 }, 'reveal+=0.2').to(b, { v: 0 }, '<')
	assert.deepEqual(
		tl2.children.map((k) => +k.start.toFixed(6)),
		[1, 1.1, 1.2, 1.8, 1.8]
	)
	T.step(1150)
	close(objs[0].s, 0.15 / 0.4, 'stagger 0, linear')
	close(objs[1].s, 0.05 / 0.4, 'stagger 1')
	assert.equal(objs[2].s, 0)
	T.step(2000)
	assert.equal(T.isActive(), false)
})

test('WO-1096: speed, kill, onUpdate, call, a tween started by a callback shares that tick', () => {
	const o = { t: 0 }
	let updates = 0
	assert.equal(T.timeScale(), 1)
	T.timeScale(2)
	const tw = T.to(o, { t: 4, duration: 4, ease: 'none', onUpdate: () => updates++ })
	T.step(500)
	close(o.t, 1, 'speed 2: 0.5 s of clock = 1 s of tween')
	assert.equal(updates, 1)
	tw.kill()
	T.step(500)
	close(o.t, 1, 'killed tween stays put')
	assert.equal(T.timeScale('bogus'), 1, 'bad speed → 1')

	// the confetti rule: a burst started by a timeline callback counts from the same tick, so the studio
	// hold-in (1000x) lands on its end frame instead of playing confetti afterwards
	const clock = { t: 0 }
	let cleared = false
	T.timeScale(1000)
	const tl = T.timeline({})
	tl.call(() => T.to(clock, { t: 4.4, duration: 4.4, ease: 'none', onComplete: () => (cleared = true) }), null, 0.12)
	T.step(20)
	T.timeScale(1)
	assert.equal(cleared, true)
	close(clock.t, 4.4, 'burst finished in the hold-in tick')
	assert.equal(T.isActive(), false)
})

test('WO-1096: legacy studio exports upgrade to lt-tween.js (idempotent)', () => {
	const legacy = [
		'<script src="../lower-thirds/vendor/gsap.min.js"></script>',
		'<script src="../lower-thirds/lt-engine.js"></script>',
		"var tl = new gsap.timeline({ duration: 1, ease: 'power1.out', onComplete: resolve });",
		'gsap.set(el, { opacity: 0 }); gsap.to(o, { t: 1 }); gsap.globalTimeline.timeScale(2);',
	].join('\n')
	const { html, changed } = migrateLegacyTweenHtml(legacy)
	assert.equal(changed, true)
	assert.match(html, /<script src="\.\.\/lower-thirds\/lt-tween\.js"><\/script>/)
	assert.match(html, /new LTTween\.timeline\(\{ duration: 1,/)
	assert.match(html, /LTTween\.set\(el.*LTTween\.to\(o.*LTTween\.timeScale\(2\)/)
	assert.doesNotMatch(html, GSAP_WORD)
	assert.deepEqual(migrateLegacyTweenHtml(html), { html, changed: false })
	const plain = '<script src="lt-tween.js"></script> // mentions gsap in a comment only'
	assert.deepEqual(migrateLegacyTweenHtml(plain), { html: plain, changed: false }, 'only files that load the old script')
	const reg = fs.readFileSync(path.join(ROOT, 'src', 'cg-studio', 'register.js'), 'utf8')
	assert.match(reg, /migrateLegacyTweenDir\(context\.getStudioDir\(\)\)/, 'runs at boot')
})
