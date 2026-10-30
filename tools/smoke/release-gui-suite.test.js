'use strict'

/**
 * WO-836 part 3 — hermetic tests of the GUI release suite's plumbing (the suite itself needs Godot + Xvfb + a Caspar
 * binary and is not CI): the combined report, the throwaway-Caspar sandbox config, and the runner's argument checks.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const E2E = path.resolve(__dirname, '../e2e')
const { combinedReport } = require(path.join(E2E, 'release-report'))
const { airSandboxConfig, MODE } = require(path.join(E2E, 'air-fixture'))

test('combined report counts both phases, lists failures and the kept PRINT frames', () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-gui-'))
	const dir = path.join(out, 'air')
	fs.mkdirSync(path.join(dir, 'shots'), { recursive: true })
	fs.writeFileSync(path.join(dir, 'shots', 'print_pgm_taken_ch1_2.png'), 'x')
	const step = (scenario, step, ok, why = '') => ({ scenario, step, ok, skipped: false, why, ms: 5, shot: path.join(dir, 'shots', '01.png') })
	const phases = [
		{ id: 'sim', title: 'sim', status: 'pass', dir: path.join(out, 'sim'), ms: 1000, res: { server: 'http://x', passed: 2, failed: 0, skipped: 0, steps: [step('01_a', 'one', true), step('01_a', 'two', true)] } },
		{ id: 'air', title: 'air', status: 'FAIL', dir, ms: 2000, res: { server: 'http://y', passed: 1, failed: 1, skipped: 1, steps: [step('12_air_print', 'probe', true), step('12_air_print', 'ftb | black', false, 'not black'), { ...step('12_air_print', 'later', false), skipped: true }] } },
		{ id: 'xr', title: 'skipped phase', status: 'skipped', dir: path.join(out, 'xr') },
	]
	const r = combinedReport(out, phases)
	assert.equal(r.passed, 3)
	assert.equal(r.failed, 1)
	assert.equal(r.skipped, 1)
	assert.equal(r.total, 4)
	assert.match(r.markdown, /3\/4 steps passed\*\*, \*\*1 FAILED/)
	assert.match(r.markdown, /ftb \\\| black \| 5 \| not black/, 'a pipe in a step name is escaped, the reason is shown')
	assert.match(r.markdown, /print_pgm_taken_ch1_2\.png/)
	assert.match(r.markdown, /\| xr — skipped phase \| skipped/)
	fs.rmSync(out, { recursive: true, force: true })
})

test('a phase with no results.json is a FAIL row, not a silent pass', () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-gui-'))
	const r = combinedReport(out, [{ id: 'air', title: 'air', status: 'FAIL', dir: path.join(out, 'air'), exit: 98, ms: 10 }])
	assert.match(r.markdown, /FAIL \(no results, exit 98\)/)
	fs.rmSync(out, { recursive: true, force: true })
})

test('the throwaway Caspar and the sandbox destination agree on one PGM/PRV screen and the video mode', () => {
	const cfg = airSandboxConfig('/tmp/root')
	const dest = cfg.screenDestinations.destinations
	assert.equal(dest.length, 1)
	assert.equal(dest[0].mode, 'pgm_prv')
	assert.equal(dest[0].videoMode, MODE.name)
	assert.equal(dest[0].width, MODE.width)
	assert.equal(dest[0].height, MODE.height)
	assert.equal(dest[0].fps, MODE.fps)
	assert.equal(cfg.casparServer.screen_1_mode, MODE.name)
})

test('the runner refuses an unknown phase (exit 2) before starting anything', () => {
	const r = spawnSync(process.execPath, [path.join(E2E, 'run-release-gui.js'), '--only=nope'], { encoding: 'utf8' })
	assert.equal(r.status, 2)
	assert.match(r.stderr, /unknown phase/)
})

test('the e2e scenario list the runner builds leaves out the agent driver, the XR walk and the air scenario', () => {
	const src = fs.readFileSync(path.join(E2E, 'run-release-gui.js'), 'utf8')
	assert.match(src, /!f\.startsWith\('99_'\) && !f\.startsWith\('12_'\) && !f\.startsWith\('06_'\)/)
	const names = fs.readdirSync(path.resolve(__dirname, '../../godot/client/e2e/scenarios')).filter((f) => f.endsWith('.gd'))
	assert.ok(names.includes('12_air_print.gd') && names.includes('01_new_project.gd'))
})
