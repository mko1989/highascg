'use strict'

/**
 * Modal backdrops paint nothing (f1d8fd3, owner: "should be nothing, 100% alpha bg"), so the PANEL
 * is the only thing providing contrast. caspar-config-modal.js shipped `class="modal-shell ..."`,
 * a class defined in no stylesheet, so that modal had no background, border, shadow or max-height.
 * Harmless while the scrim existed; unreadable the moment the scrim was removed.
 *
 * Rule enforced here: the element immediately inside a `.modal-overlay` must carry at least one
 * class that a stylesheet actually gives a background to.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const COMPONENTS = path.join(ROOT, 'client', 'components')
const STYLES = path.join(ROOT, 'client', 'styles')

const CSS = fs
	.readdirSync(STYLES)
	.filter((f) => f.endsWith('.css'))
	.map((f) => fs.readFileSync(path.join(STYLES, f), 'utf8'))
	.join('\n')
	.replace(/\/\*[\s\S]*?\*\//g, '')

/** True when some rule whose selector mentions `.cls` sets a background. */
function classPaintsBackground(cls) {
	const rule = new RegExp(`\\.${cls}\\b[^{}]*\\{([^}]*)\\}`, 'g')
	for (const m of CSS.matchAll(rule)) {
		if (/(^|;)\s*background(-color)?\s*:/.test(m[1])) return true
	}
	return false
}

test('every modal panel carries a class that paints a background', () => {
	const offenders = []

	for (const file of fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.js'))) {
		const src = fs.readFileSync(path.join(COMPONENTS, file), 'utf8')
		/* The overlay is declared either as markup (class="modal-overlay") or imperatively
		 * (el.className = 'modal-overlay'), so match the bare token rather than one spelling —
		 * anchoring on `class="` alone silently checked NOTHING for the imperative components. */
		let idx = src.indexOf('modal-overlay')
		while (idx !== -1) {
			// The next class attribute after the overlay is the panel root.
			const next = /class="([^"]+)"/.exec(src.slice(idx + 'modal-overlay'.length))
			if (next) {
				const classes = next[1].trim().split(/\s+/)
				if (!classes.some(classPaintsBackground)) {
					offenders.push(`${file}: <div class="${next[1]}">`)
				}
			}
			idx = src.indexOf('modal-overlay', idx + 1)
		}
	}

	assert.deepEqual(
		offenders,
		[],
		'these modal panels carry no class that any stylesheet gives a background to — with the ' +
			'backdrop painting nothing, their content renders straight over the live UI',
	)
})

test('the shared modal panel class actually paints a background', () => {
	assert.ok(classPaintsBackground('modal-content'), '.modal-content must set a background')
})
