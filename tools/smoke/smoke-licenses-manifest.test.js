'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const manifestPath = path.join(ROOT, 'licenses', 'manifest.json')
const compliancePath = path.join(ROOT, 'licenses', 'COMPLIANCE-ISO.md')

// `licenses/` is a tracked symlink to the generated /usr/share/doc/highascg/licenses tree
// (tools/release/collect-third-party-licenses.sh). It only exists on a provisioned box, never on a
// clean checkout / CI runner, so the checks are about that host artifact and skip when it is absent.
const TREE_PRESENT = fs.existsSync(manifestPath)
const SKIP = TREE_PRESENT
	? false
	: 'generated licenses/ tree absent (symlink to /usr/share/doc/highascg/licenses; produced by tools/release/collect-third-party-licenses.sh on the box, not in a clean checkout)'

describe('third-party licenses manifest', { skip: SKIP }, () => {
	it('manifest.json exists and has required components', () => {
		assert.ok(fs.existsSync(manifestPath), 'run tools/release/collect-third-party-licenses.sh')
		const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
		assert.equal(data.schemaVersion, 1)
		assert.ok(data.generatedAt)
		assert.ok(Array.isArray(data.components) && data.components.length >= 1)
		const ids = new Set(data.components.map((c) => c.id))
		assert.ok(ids.has('highascg'))
		for (const c of data.components) {
			assert.ok(c.licenseFile, `${c.id} missing licenseFile`)
			const file = path.join(ROOT, 'licenses', c.licenseFile)
			assert.ok(fs.existsSync(file), `missing ${c.licenseFile}`)
		}
	})

	it('COMPLIANCE-ISO.md covers NVIDIA, NDI, and Blackmagic', () => {
		const text = fs.readFileSync(compliancePath, 'utf8')
		assert.match(text, /NVIDIA/i)
		assert.match(text, /NDI/i)
		assert.match(text, /Blackmagic/i)
		assert.match(text, /blackmagic-desktopvideo-EULA/i)
	})

	it('Blackmagic EULA file exists when in manifest', () => {
		const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
		const bmd = data.components.find((c) => c.id === 'blackmagic-desktopvideo')
		if (!bmd) return
		const eula = path.join(ROOT, 'licenses', bmd.licenseFile)
		assert.ok(fs.existsSync(eula), 'blackmagic EULA missing — run collect script')
		assert.match(fs.readFileSync(eula, 'utf8'), /Blackmagic Design License Agreement/i)
	})
})
