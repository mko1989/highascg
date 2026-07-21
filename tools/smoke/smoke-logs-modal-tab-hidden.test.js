'use strict'

/**
 * The logs modal hides its inactive tab pane with the `hidden` ATTRIBUTE, but `[hidden]{display:none}`
 * comes from the user-agent stylesheet, so any author `display:` rule on the same element wins.
 * `.logs-modal__body { display: flex }` did exactly that: both panes rendered, the shortcuts sat
 * permanently under the logs, and the tab buttons appeared dead.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const CSS = fs.readFileSync(path.join(ROOT, 'client', 'styles', '08a-modals-logs.css'), 'utf8')
const JS = fs.readFileSync(path.join(ROOT, 'client', 'components', 'logs-modal.js'), 'utf8')

/** Strip comments so prose can never satisfy an assertion. */
function code(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

test('the tab panes are still hidden via the hidden attribute', () => {
	const js = code(JS)
	assert.match(js, /id="logs-tab-shortcuts"[^>]*\shidden/, 'shortcuts pane starts hidden')
	assert.match(js, /\.hidden\s*=\s*(true|false)/, 'tab switching still toggles .hidden')
})

test('an author display rule on a pane class is neutralised for [hidden]', () => {
	const css = code(CSS)

	/* Every class that (a) styles a tab pane and (b) sets display must have a [hidden] override,
	 * or the hidden attribute silently stops working again. */
	const paneClasses = ['logs-modal__body']
	for (const cls of paneClasses) {
		const setsDisplay = new RegExp(`\\.${cls}\\s*\\{[^}]*display\\s*:`, 's').test(css)
		if (!setsDisplay) continue
		assert.match(
			css,
			new RegExp(`\\.${cls}\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none`, 's'),
			`.${cls} sets display, so it must also set display:none for [hidden] — otherwise the ` +
				'UA [hidden] rule loses and both tab panes render at once',
		)
	}
})
