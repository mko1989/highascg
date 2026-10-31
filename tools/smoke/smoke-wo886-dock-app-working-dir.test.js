'use strict'

/**
 * WO-886 — the operator dock started MagicQ and nothing opened: runmagicq.sh exits ("The current directory must be set to
 * the same location as this script") unless it runs in /opt/magicq, the entry's `Path=`, which the launch ignored. And the
 * dock's focus-or-launch looked for a window of class `runmagicq.sh`, which never exists (the window is mqqt / MagicQ).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const parse = require('../../src/utils/desktop-app-catalog-parse')

const MAGICQ = parse.parseDesktopEntry(['[Desktop Entry]', 'Type=Application', 'Name=MagicQ', 'Exec=/opt/magicq/runmagicq.sh',
	'Path=/opt/magicq/', 'Categories=AudioVideo;Qt'].join('\n'))

test('Path= is the working directory: absolute only, no .. segments', () => {
	assert.equal(parse.workingDir(MAGICQ), '/opt/magicq/')
	assert.equal(parse.workingDir({}), null, 'no Path → the server cwd as before')
	assert.equal(parse.workingDir({ Path: 'relative/dir' }), null)
	assert.equal(parse.workingDir({ Path: '/opt/../etc' }), null)
})

test('a .sh launcher also looks for the window under its first Name word (MagicQ, not runmagicq.sh)', () => {
	assert.deepEqual(parse.deriveWindowClasses(MAGICQ), ['runmagicq.sh', 'MagicQ'])
	const multi = { ...MAGICQ, Name: 'MagicQ MultiWindows', Exec: '/opt/magicq/runmagicq.sh multiwin' }
	assert.deepEqual(parse.deriveWindowClasses(multi), ['runmagicq.sh', 'MagicQ'])
	assert.deepEqual(parse.deriveWindowClasses({ Name: 'Thunar', Exec: 'thunar %F' }), ['thunar'], 'binaries unchanged')
})

test('the catalog carries cwd and spawnGuiDetached passes it to spawn', () => {
	const cat = fs.readFileSync(path.join(__dirname, '../../src/utils/desktop-app-catalog.js'), 'utf8')
	assert.match(cat, /cwd: parse\.workingDir\(entry\)/)
	assert.match(cat, /return \{ bin, args, entry, cwd: entry\.cwd \}/)
	const gui = fs.readFileSync(path.join(__dirname, '../../src/api/system-hardware-gui.js'), 'utf8')
	assert.match(gui, /cwd = launch\.cwd \|\| undefined/)
	assert.match(gui, /spawn\(bin, args, \{\n\t\tenv,\n\t\tcwd,/)
})
