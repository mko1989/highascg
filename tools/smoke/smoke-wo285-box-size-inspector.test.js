'use strict'

/**
 * WO-285: box-size controls + studio inspector consistency.
 *
 * Two halves:
 *  1. The registry gained boxWidth/boxHeight/boxScale and BOTH engine copies actually honour them.
 *     This is exercised behaviourally: each engine is evaluated in a node:vm against a minimal fake
 *     DOM that records every style write, so we can prove both that the override works AND that the
 *     default payload writes nothing at all to the box (on-air geometry unchanged).
 *  2. The studio inspector emits the main client's inspector DOM vocabulary
 *     (.inspector-group / .inspector-group__title / .inspector-field__key / __input / __select)
 *     rather than its own fieldset/legend markup, driven by the shared registry.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const REPO = path.join(__dirname, '../..')
const registry = require('../../src/cg-studio/lt-param-registry.js')

const BOX_KEYS = ['boxWidth', 'boxHeight', 'boxScale']
const ENGINES = ['template/lower-thirds/lt-engine.js', 'template/lower-thirds/lt-engine-styles.js']

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

/* ── minimal recording DOM ──────────────────────────────────────────────── */

function makeElement(tag) {
	const writes = []
	const raw = {}
	const style = new Proxy(raw, {
		set(t, k, v) {
			writes.push([String(k), v])
			t[k] = v
			return true
		},
	})
	const el = {
		tagName: String(tag).toUpperCase(),
		style,
		writes,
		dataset: {},
		children: [],
		id: '',
		textContent: '',
		innerHTML: '',
		appendChild(child) {
			el.children.push(child)
			return child
		},
		querySelector() {
			return null
		},
	}
	/** Keys of style properties written at least once. */
	el.writtenProps = () => writes.map((w) => w[0])
	el.lastWrite = (prop) => {
		for (let i = writes.length - 1; i >= 0; i--) if (writes[i][0] === prop) return writes[i][1]
		return undefined
	}
	return el
}

/**
 * @param {string} containerSel
 * @returns {{ context: object, container: object, box: object }}
 */
function makeDom(containerSel) {
	const container = makeElement('main')
	const box = makeElement('div')
	const title = makeElement('h1')
	const subtitle = makeElement('p')
	container.querySelector = (sel) => (sel === 'h1' ? title : subtitle)

	const nodes = new Map([
		[containerSel, container],
		[containerSel + ' .graphic', box],
	])
	const head = makeElement('head')
	const body = makeElement('body')

	const document = {
		head,
		body,
		documentElement: makeElement('html'),
		createElement: makeElement,
		querySelector: (sel) => nodes.get(sel) || null,
		getElementById: (id) => head.children.find((c) => c.id === id) || null,
	}
	const window = {
		document,
		location: { search: '' },
		getComputedStyle: () => ({ getPropertyValue: () => '0px', fontSize: '10px' }),
	}
	window.window = window
	const context = vm.createContext({
		window,
		document,
		URLSearchParams,
		console,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		JSON,
		Number,
		Object,
		Array,
		Promise,
		String,
		Math,
		fetch: () => Promise.reject(new Error('no network')),
	})
	return { context, container, box }
}

/**
 * Apply a style payload through one engine and return the recorded DOM.
 * @param {string} rel engine source path
 * @param {object} style
 */
function applyStyleVia(rel, style) {
	const containerSel = '.lt-classic-box'
	const { context, container, box } = makeDom(containerSel)
	const cfg = { containerSel, titleSel: 'h1', subtitleSel: 'p' }

	if (rel.endsWith('lt-engine-styles.js')) {
		vm.runInContext(src(rel), context, { filename: rel })
		const S = context.window.LTEngineStyles
		assert.ok(S, 'LTEngineStyles must be exported')
		S.setContext({
			cfg,
			data: [{ title: 'Name', subtitle: 'Title' }],
			activeStep: 0,
			style: { ...style },
			handleError: (e) => {
				throw e
			},
		})
		S.applyStyles()
	} else {
		vm.runInContext(src(rel) + '\n;globalThis.__LTEngine = LTEngine;', context, { filename: rel })
		const engine = context.__LTEngine
		assert.ok(engine, 'LTEngine must be exported')
		engine.init(cfg)
		context.window.update(JSON.stringify({ data: { title: 'Name', subtitle: 'Title' }, style }))
	}
	return { container, box }
}

/** What the studio actually sends: buildUpdateJson drops empty-string/null style keys. */
function studioStyleFor(templateId) {
	const style = { ...registry.getDefaultPayload(templateId).style }
	for (const k of Object.keys(style)) {
		if (style[k] === '' || style[k] == null) delete style[k]
	}
	return style
}

/* ── registry / engine vocabulary ───────────────────────────────────────── */

describe('WO-285: box-size keys exist across registry and both engines', () => {
	it('registry exposes the box size fields in the layout group', () => {
		const keys = registry.LAYOUT_FIELDS.map((f) => f.key)
		for (const k of BOX_KEYS) assert.ok(keys.includes(k), `LAYOUT_FIELDS missing ${k}`)
	})

	it('registry defaults leave every box size field empty (opt-in)', () => {
		for (const k of BOX_KEYS) {
			assert.equal(registry.DEFAULT_STYLE[k], '', `DEFAULT_STYLE.${k} must default to ''`)
		}
		const templateIds = ['lt-classic-box', 'lt-frosted-glass', 'lt-gradient-wave', 'lt-split-color', undefined]
		for (const id of templateIds) {
			const style = registry.getDefaultPayload(id).style
			for (const k of BOX_KEYS) {
				assert.equal(style[k], '', `getDefaultPayload(${id}).style.${k} must stay empty`)
			}
		}
	})

	for (const rel of ENGINES) {
		it(`${path.basename(rel)}: STYLE_KEYS carries the box size keys and applies them`, () => {
			const s = src(rel)
			const m = s.match(/STYLE_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
			assert.ok(m, 'STYLE_KEYS literal not found')
			for (const k of BOX_KEYS) assert.ok(m[1].includes(`'${k}'`), `STYLE_KEYS missing ${k}`)
			// a style key the engine ignores is worse than no control
			assert.match(s, /applyBoxSizeOverride\(\)/, 'applyStyles must call applyBoxSizeOverride')
		})
	}
})

/* ── behaviour: the engine honours the keys ─────────────────────────────── */

for (const rel of ENGINES) {
	const name = path.basename(rel)

	describe(`WO-285: ${name} box sizing behaviour`, () => {
		it('applies boxWidth to the graphic box and releases the template min/max clamps', () => {
			const { box } = applyStyleVia(rel, { boxWidth: 500 })
			assert.equal(box.lastWrite('width'), '500px')
			assert.equal(box.lastWrite('minWidth'), '0')
			assert.equal(box.lastWrite('maxWidth'), 'none')
			assert.equal(box.dataset.ltBoxSized, '1')
		})

		it('applies boxHeight', () => {
			const { box } = applyStyleVia(rel, { boxHeight: 240 })
			assert.equal(box.lastWrite('height'), '240px')
			assert.equal(box.lastWrite('maxHeight'), 'none')
		})

		it('applies boxScale on the container, anchored to the position corner', () => {
			const left = applyStyleVia(rel, { boxScale: 1.5, position: 'left' })
			assert.equal(left.container.lastWrite('transform'), 'scale(1.5)')
			assert.equal(left.container.lastWrite('transformOrigin'), 'left bottom')
			assert.equal(left.container.dataset.ltBoxScaled, '1')

			const right = applyStyleVia(rel, { boxScale: 0.75, position: 'right' })
			assert.equal(right.container.lastWrite('transform'), 'scale(0.75)')
			assert.equal(right.container.lastWrite('transformOrigin'), 'right bottom')

			const center = applyStyleVia(rel, { boxScale: 2, position: 'center' })
			assert.equal(center.container.lastWrite('transformOrigin'), 'center bottom')
		})

		it('boxScale of exactly 1 is a no-op, not an identity transform', () => {
			const { container } = applyStyleVia(rel, { boxScale: 1 })
			assert.ok(!container.writtenProps().includes('transform'), 'scale 1 must not write transform')
		})

		it('non-numeric / out-of-range values are ignored rather than emitting garbage CSS', () => {
			for (const bad of ['abc', 0, -20, '']) {
				const { box, container } = applyStyleVia(rel, { boxWidth: bad, boxScale: bad })
				assert.ok(!box.writtenProps().includes('width'), `boxWidth ${JSON.stringify(bad)} must be ignored`)
				assert.ok(
					!container.writtenProps().includes('transform'),
					`boxScale ${JSON.stringify(bad)} must be ignored`,
				)
			}
		})

		it('DEFAULTS UNCHANGED: the studio default payload writes nothing to the box', () => {
			for (const id of ['lt-classic-box', 'lt-frosted-glass', 'lt-gradient-wave', undefined]) {
				const { box, container } = applyStyleVia(rel, studioStyleFor(id))
				assert.deepEqual(box.writtenProps(), [], `${id}: box must be untouched by default`)
				assert.equal(box.dataset.ltBoxSized, undefined)
				assert.ok(!container.writtenProps().includes('transform'), `${id}: no container transform by default`)
				assert.ok(!container.writtenProps().includes('transformOrigin'), `${id}: no transform-origin by default`)
				assert.equal(container.dataset.ltBoxScaled, undefined)
			}
		})
	})
}

/* ── studio inspector structure ─────────────────────────────────────────── */

describe('WO-285: studio inspector uses the client inspector vocabulary', () => {
	const app = src('src/cg-studio/public/app.js')

	it('groups render as .inspector-group with .inspector-group__title', () => {
		assert.match(app, /grp\.className = 'inspector-group'/)
		assert.match(app, /title\.className = 'inspector-group__title'/)
	})

	it('the old bespoke fieldset/legend markup is gone', () => {
		assert.ok(!/createElement\('fieldset'\)/.test(app), 'fieldset markup must be replaced')
		assert.ok(!/<legend>/.test(app), 'legend markup must be replaced')
		const css = src('src/cg-studio/public/studio.css')
		assert.ok(!/#inspector-form fieldset/.test(css), 'fieldset CSS must be replaced')
		assert.match(css, /#inspector-form \.inspector-group\b/)
		assert.match(css, /#inspector-form \.inspector-group__title/)
	})

	it('fields use the client field classes', () => {
		for (const cls of [
			'inspector-field__label',
			'inspector-field__key',
			'inspector-field__input',
			'inspector-field__select',
		]) {
			assert.ok(app.includes(cls), `app.js must emit .${cls}`)
		}
	})

	it('drag-overlay inspector sync (data-field-*) survived the restructure', () => {
		assert.match(app, /input\.dataset\.fieldSection = section/)
		assert.match(app, /input\.dataset\.fieldKey = field\.key/)
		assert.match(app, /\[data-field-section="\$\{section\}"\]\[data-field-key="\$\{key\}"\]/)
	})

	it('group order is registry-driven and matches getFieldsForTemplate', () => {
		const m = app.match(/const FIELD_GROUPS = \[([\s\S]*?)\n\]/)
		assert.ok(m, 'FIELD_GROUPS not found')
		const order = [...m[1].matchAll(/key: '([^']+)'/g)].map((x) => x[1])
		const registryGroups = Object.keys(registry.getFieldsForTemplate('lt-classic-box'))
		assert.deepEqual(
			order.slice().sort(),
			registryGroups.slice().sort(),
			'every registry group must have an inspector group and vice versa',
		)
	})

	it('the class vocabulary is the shareable contract: the client inspector is ESM, the studio is not', () => {
		// Evidence for the "structural consistency, not literal component reuse" decision.
		assert.match(src('client/components/inspector-common.js'), /^import .* from '\.\.\/lib\/math-input\.js'/m)
		assert.match(src('src/cg-studio/public/index.html'), /<script src="app\.js"><\/script>/)
		assert.ok(
			!/type="module"/.test(src('src/cg-studio/public/index.html')),
			'cg-studio index.html loads plain scripts — no module graph to import client components from',
		)
	})
})
