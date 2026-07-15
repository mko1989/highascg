'use strict'

/**
 * WO-232 static/offline smoke: vendored Mario HTML producer (template/mario/).
 *
 * Runs in the curated offline gate (tools/ci/run-offline-tests.js) — no browser, no CasparCG,
 * no network. Confirms:
 *   - the entry page + patched files exist
 *   - the WO-232 transparency patch markers are present in the patched source
 *   - no vendored game file references an http(s):// URL (fully local/offline — this box has
 *     no runtime internet access; template pages are served raw to CEF)
 *   - the vendor stays within the ~2MB size budget from the work order
 *
 * See tools/smoke/smoke-wo232-mario-transparent.live.test.js for the real-browser pixel-alpha
 * verification (not part of this gate — launches headless Chrome, run manually).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { REPO_ROOT } = require('../../src/repo-paths')

const MARIO_DIR = path.join(REPO_ROOT, 'template', 'mario')
const INDEX_HTML = path.join(MARIO_DIR, 'index.html')
const GAME_JS = path.join(MARIO_DIR, 'js', 'game.js')
const GAME_CSS = path.join(MARIO_DIR, 'css', 'game.css')

const SIZE_BUDGET_BYTES = 2 * 1024 * 1024

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFilesRecursive(dir) {
	const out = []
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) out.push(...listFilesRecursive(full))
		else out.push(full)
	}
	return out
}

test('WO-232: template/mario/index.html exists (CasparCG [html] producer entry point)', () => {
	assert.ok(fs.existsSync(INDEX_HTML), `missing ${INDEX_HTML}`)
});

test('WO-232: index.html documents provenance and does not reference http(s):// assets', () => {
	const html = fs.readFileSync(INDEX_HTML, 'utf8')
	assert.match(html, /WO-232/, 'index.html should mention WO-232 in its provenance comment')
	assert.doesNotMatch(html, /https?:\/\//i, 'index.html must not reference any http(s):// URL (offline box)')
})

test('WO-232: sky fillRect is removed/commented out of the render loop', () => {
	const js = fs.readFileSync(GAME_JS, 'utf8')
	assert.match(js, /WO-232/, 'game.js should carry a WO-232 patch marker')
	assert.match(
		js,
		/WO-232:\s*sky fill removed/i,
		'game.js should document the removed sky fillRect via a WO-232 comment',
	)
	// The real fillRect(level.background) call must be gone from the active render() body — only
	// allowed to appear inside a comment describing what was removed.
	const activeLines = js
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
		.join('\n')
	assert.doesNotMatch(
		activeLines,
		/ctx\.fillStyle\s*=\s*level\.background/,
		'sky fillStyle/fillRect assignment must not remain active in game.js',
	)
})

test('WO-232: canvas 2d context is created with an explicit alpha channel', () => {
	const js = fs.readFileSync(GAME_JS, 'utf8')
	assert.match(js, /getContext\(\s*'2d'\s*,\s*\{\s*alpha:\s*true\s*\}\s*\)/, 'canvas context should request { alpha: true }')
})

test('WO-232: canvas/html/body are patched transparent in CSS', () => {
	const css = fs.readFileSync(GAME_CSS, 'utf8')
	assert.match(css, /WO-232/, 'game.css should carry a WO-232 patch marker')
	assert.doesNotMatch(css, /background-color:\s*blue/i, 'opaque canvas background-color:blue must be removed')
	assert.match(
		css,
		/html,\s*body\s*\{[^}]*background:\s*transparent\s*!important/s,
		'html,body must be forced transparent with !important',
	)
})

test('WO-232: no vendored game file references an http(s):// URL', () => {
	const files = listFilesRecursive(MARIO_DIR).filter((f) => /\.(js|html|css|json|txt)$/i.test(f))
	assert.ok(files.length > 5, 'expected several vendored game source files')
	const offenders = []
	for (const f of files) {
		const content = fs.readFileSync(f, 'utf8')
		if (/https?:\/\//i.test(content)) offenders.push(path.relative(MARIO_DIR, f))
	}
	assert.deepEqual(offenders, [], `these vendored files reference http(s):// URLs: ${offenders.join(', ')}`)
})

test('WO-232: vendored template/mario/ stays within the ~2MB size budget', () => {
	const files = listFilesRecursive(MARIO_DIR)
	const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0)
	assert.ok(
		totalBytes <= SIZE_BUDGET_BYTES,
		`template/mario/ is ${(totalBytes / 1024 / 1024).toFixed(2)}MB, over the ${(SIZE_BUDGET_BYTES / 1024 / 1024).toFixed(0)}MB budget`,
	)
})

test('WO-232: LICENSE is vendored alongside the game', () => {
	assert.ok(fs.existsSync(path.join(MARIO_DIR, 'LICENSE')), 'expected template/mario/LICENSE (MIT, upstream reruns/mario)')
})
