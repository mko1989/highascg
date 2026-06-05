#!/usr/bin/env node
/**
 * Validates that eggs exclude fragments and bootstrap artefacts cover the WO-47 split layout.
 */
import assert from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(import.meta.url)
const root = join(dirname(here), '../..')

const fragmentPath = join(root, 'tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list')
const embedFragmentPath = join(root, 'tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list')
const isoCasparPath = join(root, 'config/casparcg.config.iso')
const excludesPath = join(root, 'config/bootstrap-rsync-excludes.txt')

/** @param {string} filePath @param {string[]} needles */
function mustContain(filePath, needles) {
	const text = readFileSync(filePath, 'utf8')
	for (const n of needles) {
		assert.ok(text.includes(n), `${filePath}: missing line containing: ${n}`)
	}
}

const eggsNeedles = [
	'home/casparcg/highascg/src',
	'home/casparcg/highascg/tools',
	'home/casparcg/highascg/client',
	'home/casparcg/highascg/index.js',
	'home/casparcg/highascg/package.json',
]

const rsyncNeedles = ['config/casparcg.config', 'lib/', 'node_modules/']

mustContain(fragmentPath, eggsNeedles)

const embedMustOmit = [
	'home/casparcg/highascg/package.json',
	'home/casparcg/highascg/index.js',
	'home/casparcg/highascg/src',
]
const embedText = readFileSync(embedFragmentPath, 'utf8')
for (const n of embedMustOmit) {
	assert.ok(!embedText.includes(n), `${embedFragmentPath}: must not exclude ${n}`)
}
mustContain(embedFragmentPath, [
	'home/casparcg/highascg/client',
	'home/casparcg/highascg/dist-web',
	'tools/eggs',
])

const isoCaspar = readFileSync(isoCasparPath, 'utf8')
assert.ok(isoCaspar.includes('720p5000'), 'casparcg.config.iso: 720p5000')
assert.ok(isoCaspar.includes('<borderless>true</borderless>'), 'casparcg.config.iso: borderless')
assert.ok(isoCaspar.includes('<windowed>true</windowed>'), 'casparcg.config.iso: windowed')

mustContain(excludesPath, rsyncNeedles)
assert.ok(existsSync(join(root, 'scripts/highascg-exfat-bootstrap.sh')))
assert.ok(existsSync(join(root, 'tools/eggs/live-usb/install-iso-defaults.sh')))
assert.ok(existsSync(join(root, 'docs/WO47_ISO_VS_EXFAT.md')))
assert.ok(existsSync(join(root, 'tools/release/make-github-release-launcher.sh')))

const archiveCommon = readFileSync(join(root, 'scripts/archive-common.sh'), 'utf8')
assert.ok(archiveCommon.includes('archive_common_server_tar_excludes'), 'archive-common: server tar excludes UI')

console.log('wo47 manifest: OK')
