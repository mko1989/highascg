'use strict'
// alsamixer is a console program: the GUI launch must host it in a terminal window, not spawn it bare
// (the Launch alsamixer button opened nothing). Source-text pin plus the argv the wrap produces.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { terminalArgv } = require('../../src/utils/desktop-app-catalog')

const SRC = fs.readFileSync(path.join(__dirname, '../../src/api/system-hardware-gui.js'), 'utf8')

test('alsamixer launch goes through the terminal emulator', () => {
	const branch = SRC.slice(SRC.indexOf("action === 'alsamixer'"), SRC.indexOf("action === 'firefox'"))
	assert.match(branch, /resolveTerminalEmulator\(\)/)
	assert.match(branch, /terminalArgv\(term, 'highascg-alsamixer'/)
	assert.match(branch, /No terminal emulator installed/)
})

test('xterm-style emulator: class, title, then -e with the alsamixer card', () => {
	const argv = terminalArgv('/usr/bin/lxterm', 'highascg-alsamixer', 'ALSA mixer', ['/usr/bin/alsamixer', '-c', '1'])
	assert.deepEqual(argv, ['-class', 'highascg-alsamixer', '-title', 'ALSA mixer', '-e', '/usr/bin/alsamixer', '-c', '1'])
})

test('gnome-style emulator gets --class and --title', () => {
	const argv = terminalArgv('/usr/bin/gnome-terminal', 'highascg-alsamixer', 'ALSA mixer', ['alsamixer'])
	assert.deepEqual(argv, ['--class=highascg-alsamixer', '--title=ALSA mixer', '--', 'alsamixer'])
})
