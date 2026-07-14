'use strict'

/**
 * WO-168 T168.7 — exercises tools/eggs/live-usb/write-iso-default-config.js
 * against a fixture tree (HIGHASCG_ROOT override, same knob the script already
 * supports) to prove: projects/_trash/ + stray project clutter purged, config
 * backups (*.bak*, "casparcg copy.config") purged, PRESERVE_JSON + non-JSON
 * operator files left untouched, root drop-update stamp leftovers cleared,
 * and BUILD_STAMP / .highascg-build-stamp NOT touched (runtime consumers).
 *
 * Runs the script as a real child process (not a require()) so this exercises
 * the exact CLI entry point used by build-highascg-egg.sh / reset-iso-operator-config.sh.
 */

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '../..')
const RESET_SCRIPT = path.join(REPO_ROOT, 'tools/eggs/live-usb/write-iso-default-config.js')

describe('WO-168 factory reset: trash/backup purge + preserve set (fixture tree)', () => {
	let fixtureDir

	before(() => {
		fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo168-factory-reset-'))

		const configDir = path.join(fixtureDir, 'config')
		const projectsDir = path.join(fixtureDir, 'projects')
		fs.mkdirSync(configDir, { recursive: true })
		fs.mkdirSync(path.join(projectsDir, '_trash', 'tomb1'), { recursive: true })
		fs.mkdirSync(path.join(projectsDir, '_autosave'), { recursive: true })

		// config/: preserve set + junk + backups + operator non-JSON
		fs.writeFileSync(path.join(configDir, 'exfat-sync.json'), '{"keep":true}')
		fs.writeFileSync(path.join(configDir, 'stale_operator.json'), '{"junk":true}')
		fs.writeFileSync(path.join(configDir, 'casparcg.config.bak.1234567890'), 'bak-content')
		fs.writeFileSync(path.join(configDir, 'casparcg copy.config'), 'copy-content')
		fs.writeFileSync(path.join(configDir, 'casparcg.config'), 'operator-server-config')

		// projects/: _trash tombstone, stray non-.json clutter, old .json, old autosave
		fs.writeFileSync(path.join(projectsDir, '_trash', 'tomb1', 'project.json'), '{}')
		fs.writeFileSync(path.join(projectsDir, 'old_project.json'), '{}')
		fs.writeFileSync(path.join(projectsDir, 'stray.json.sync-conflict-20260703'), '{}')
		fs.writeFileSync(path.join(projectsDir, '_autosave', 'old_project.json'), '{}')

		// root: operator state files, stray drop-update stamps, real runtime stamps
		fs.writeFileSync(path.join(fixtureDir, 'highascg.config.json'), '{"junk":true}')
		fs.writeFileSync(path.join(fixtureDir, '.highascg-state.json'), '{"junk":true}')
		fs.writeFileSync(path.join(fixtureDir, '.module-state.json'), '{"junk":true}')
		fs.writeFileSync(path.join(fixtureDir, 'autosave.json'), '{"junk":true}')
		fs.writeFileSync(path.join(fixtureDir, '.applied-at'), '2026-01-01T00:00:00Z')
		fs.writeFileSync(path.join(fixtureDir, '.applied-stamp'), 'stale-stamp')
		fs.writeFileSync(path.join(fixtureDir, 'BUILD_STAMP'), '2026-07-13T000000Z')
		fs.writeFileSync(path.join(fixtureDir, '.highascg-build-stamp'), '2026-07-13T000000Z')

		execFileSync(process.execPath, [RESET_SCRIPT], {
			env: { ...process.env, HIGHASCG_ROOT: fixtureDir },
			stdio: 'pipe',
		})
	})

	after(() => {
		if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true })
	})

	it('purges projects/_trash/ entirely', () => {
		assert.equal(fs.existsSync(path.join(fixtureDir, 'projects', '_trash')), false)
	})

	it('purges stray non-.json/non-_autosave project entries', () => {
		assert.equal(fs.existsSync(path.join(fixtureDir, 'projects', 'old_project.json')), false)
		assert.equal(fs.existsSync(path.join(fixtureDir, 'projects', 'stray.json.sync-conflict-20260703')), false)
	})

	it('writes exactly the starter project + its autosave', () => {
		const projectsDir = path.join(fixtureDir, 'projects')
		const entries = fs.readdirSync(projectsDir).sort()
		assert.deepEqual(entries, ['_autosave', 'new_project_1.json'])
		const autosaveEntries = fs.readdirSync(path.join(projectsDir, '_autosave'))
		assert.deepEqual(autosaveEntries, ['new_project_1.json'])
	})

	it('removes config backups (*.bak.* + "copy.config" patterns)', () => {
		const configDir = path.join(fixtureDir, 'config')
		assert.equal(fs.existsSync(path.join(configDir, 'casparcg.config.bak.1234567890')), false)
		assert.equal(fs.existsSync(path.join(configDir, 'casparcg copy.config')), false)
	})

	it('removes stale non-preserved config JSON', () => {
		assert.equal(fs.existsSync(path.join(fixtureDir, 'config', 'stale_operator.json')), false)
	})

	it('preserves PRESERVE_JSON entries untouched', () => {
		const p = path.join(fixtureDir, 'config', 'exfat-sync.json')
		assert.equal(fs.readFileSync(p, 'utf8'), '{"keep":true}')
	})

	it('preserves non-JSON, non-backup config entries untouched (operator casparcg.config)', () => {
		const p = path.join(fixtureDir, 'config', 'casparcg.config')
		assert.equal(fs.readFileSync(p, 'utf8'), 'operator-server-config')
	})

	it('writes factory modular config/*.json', () => {
		const configDir = path.join(fixtureDir, 'config')
		const jsonFiles = fs.readdirSync(configDir).filter((f) => f.endsWith('.json'))
		assert.ok(jsonFiles.length > 1, `expected multiple factory config/*.json files, got: ${jsonFiles.join(', ')}`)
	})

	it('clears root operator state files and regenerates .highascg-state.json fresh', () => {
		assert.equal(fs.existsSync(path.join(fixtureDir, 'highascg.config.json')), false)
		assert.equal(fs.existsSync(path.join(fixtureDir, '.module-state.json')), false)
		assert.equal(fs.existsSync(path.join(fixtureDir, 'autosave.json')), false)
		const state = JSON.parse(fs.readFileSync(path.join(fixtureDir, '.highascg-state.json'), 'utf8'))
		assert.equal(state.web_project_active_slug, 'new_project_1')
	})

	it('clears stray root drop-update stamps with no runtime consumer', () => {
		assert.equal(fs.existsSync(path.join(fixtureDir, '.applied-at')), false)
		assert.equal(fs.existsSync(path.join(fixtureDir, '.applied-stamp')), false)
	})

	it('does NOT touch BUILD_STAMP / .highascg-build-stamp (runtime version reporting)', () => {
		assert.equal(fs.readFileSync(path.join(fixtureDir, 'BUILD_STAMP'), 'utf8'), '2026-07-13T000000Z')
		assert.equal(fs.readFileSync(path.join(fixtureDir, '.highascg-build-stamp'), 'utf8'), '2026-07-13T000000Z')
	})
})
