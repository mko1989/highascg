'use strict'

/**
 * WO-267: studio Play replay, engine margin/context repairs, canvas fit math, drag overlay wiring.
 * Offline-only — placement math is required directly (UMD); engines and studio app are asserted
 * at source level (plain browser scripts).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.join(__dirname, '../..')
const P = require('../../src/cg-studio/public/placement-math.js')

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

const ENGINES = ['template/lower-thirds/lt-engine.js', 'template/lower-thirds/lt-engine-core.js']

describe('WO-267 T267.4: placement math (pure)', () => {
	it('fitStage centers the 1920×1080 stage in any box', () => {
		const wide = P.fitStage({ width: 960, height: 540 })
		assert.equal(wide.scale, 0.5)
		assert.equal(wide.ox, 0)
		assert.equal(wide.oy, 0)
		const tall = P.fitStage({ width: 960, height: 700 })
		assert.equal(tall.scale, 0.5)
		assert.equal(tall.ox, 0)
		assert.equal(tall.oy, (700 - 540) / 2)
	})

	it('stageFromOverlay inverts the fit transform', () => {
		const view = { scale: 0.5, ox: 10, oy: 80 }
		assert.deepEqual(P.stageFromOverlay({ x: 970, y: 350 }, view), { x: 1920, y: 540 })
	})

	it('placementFromDrag snaps anchor by center third and measures from the anchored edge', () => {
		const left = P.placementFromDrag({ left: 100, top: 900, width: 400, height: 120 })
		assert.deepEqual(left, { position: 'left', marginX: 100, marginY: 60 })
		const right = P.placementFromDrag({ left: 1400, top: 900, width: 400, height: 120 })
		assert.deepEqual(right, { position: 'right', marginX: 120, marginY: 60 })
		const center = P.placementFromDrag({ left: 760, top: 1000, width: 400, height: 120 })
		assert.equal(center.position, 'center')
		assert.equal(center.marginX, 0)
		const clamped = P.placementFromDrag({ left: -50, top: 1100, width: 400, height: 120 })
		assert.equal(clamped.marginX, 0)
		assert.equal(clamped.marginY, 0)
	})
})

describe('WO-267 T267.1/T267.2: engine repairs (source asserts, both engines)', () => {
	for (const rel of ENGINES) {
		const engine = rel.endsWith('lt-engine.js')
			? src(rel) + src('template/lower-thirds/lt-engine-controls.js')
			: src(rel)
		const name = path.basename(rel)
		const gateLiteral = rel.endsWith('lt-engine.js') ? 'if (CORE.isStudioMode()) {' : 'if (isStudioMode()) {'

		it(`${name}: studio helpers registered under isStudioMode only`, () => {
			for (const fn of ['studioReplay', 'studioGetPlacement', 'studioSetPlacement', 'studioGetFontSizes']) {
				assert.match(engine, new RegExp(`window\\['${fn}'\\] = ${fn}`))
			}
			const gate = engine.indexOf(gateLiteral)
			assert.ok(gate > 0 && engine.indexOf("window['studioReplay']") > gate, 'registration must sit inside the studio gate')
		})

		it(`${name}: margin shorthand no longer stomps position anchors`, () => {
			assert.ok(!/style\.margin = my/.test(engine), 'margin shorthand must be gone')
		})
	}

	it('anchor-aware individual margins present where margins are applied', () => {
		// lt-engine.js applies margins inline; lt-engine-core.js delegates to lt-engine-styles.js.
		for (const rel of ['template/lower-thirds/lt-engine.js', 'template/lower-thirds/lt-engine-styles.js']) {
			const s = src(rel)
			assert.match(s, /marginBottom = my \+ 'px'/, `${rel} must apply marginBottom individually`)
			assert.ok(!/style\.margin = my/.test(s), `${rel} must not use the margin shorthand`)
		}
	})

	it('lt-engine-styles.js: C().style DOM corruption repaired', () => {
		const styles = src('template/lower-thirds/lt-engine-styles.js')
		assert.ok(!styles.includes('.C().style'), 'no DOM chain may go through C() (past rename corruption)')
		assert.ok(!styles.includes("createElement('C().style')"), 'createElement must create <style>')
		assert.ok(!styles.includes('lt-custom-font-C().style'), 'font style-element id must be repaired')
	})

	it('lt-engine-core.js: styles context uses live getters, not a snapshot', () => {
		const core = src('template/lower-thirds/lt-engine-core.js')
		assert.match(core, /get data\(\) \{ return data; \}/)
		assert.match(core, /get style\(\) \{ return style; \}/)
		assert.match(core, /get activeStep\(\) \{ return activeStep; \}/)
	})
})

describe('WO-267 T267.1/T267.3/T267.4: studio app wiring (source asserts)', () => {
	const app = src('src/cg-studio/public/app.js')

	it('Play prefers studioReplay', () => {
		assert.match(app, /typeof win\.studioReplay === 'function'\) win\.studioReplay\(\)/)
	})

	it('preview fit centers via fitStage and feeds the overlay view', () => {
		assert.match(app, /StudioPlacement\.fitStage/)
		assert.match(app, /translate\(\$\{previewView\.ox\}px, \$\{previewView\.oy\}px\) scale\(\$\{previewView\.scale\}\)/)
	})

	it('drag overlay + inspector sync are wired', () => {
		assert.match(app, /canvas-overlay/)
		assert.match(app, /StudioPlacement\.placementFromDrag/)
		assert.match(app, /data-field-section/)
		assert.match(app, /setInspectorValue\('style', 'marginX'/)
	})

	it('index.html loads placement math before the app', () => {
		const html = src('src/cg-studio/public/index.html')
		const pm = html.indexOf('placement-math.js')
		const a = html.indexOf('"app.js"')
		assert.ok(pm > 0 && a > pm)
	})

	it('round 2: stage top-aligned, buttons read Play in / Play out', () => {
		const css = src('src/cg-studio/public/studio.css')
		assert.match(css, /\.preview-pane \{[^}]*justify-content: flex-start/s)
		const html = src('src/cg-studio/public/index.html')
		assert.match(html, />Play in</)
		assert.match(html, />Play out</)
	})
})
