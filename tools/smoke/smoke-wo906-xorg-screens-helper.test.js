'use strict'
/**
 * WO-906 — tools/runtime/highascg-xorg-screens-apply.sh, the root helper that installs the two-screen X layout: a valid
 * layout installs / turns off / restores in a temp dir (HIGHASCG_XORG_DIR, honoured only for non-root), and everything
 * that could load code, read paths or inject shell is refused before anything is written.
 */
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SCRIPT = path.join(__dirname, '../runtime/highascg-xorg-screens-apply.sh')
const GOOD = `# WO-906 generated
Section "ServerLayout"
    Identifier "HighAsCG"
    Screen 0 "Operator" 0 0
    Screen 1 "Playout" RightOf "Operator"
    Option "Xinerama" "0"
EndSection
Section "Device"
    Identifier "GPU0-Operator"
    Driver "nvidia"
    BusID "PCI:1:0:0"
    Screen 0
EndSection
Section "Device"
    Identifier "GPU0-Playout"
    Driver "nvidia"
    BusID "PCI:1:0:0"
    Screen 1
EndSection
Section "Screen"
    Identifier "Operator"
    Device "GPU0-Operator"
    Option "metamodes" "DP-4: 1920x1080 +0+0, DP-6: 1920x1080 +1920+0"
    SubSection "Display"
        Depth 24
    EndSubSection
EndSection
Section "Screen"
    Identifier "Playout"
    Device "GPU0-Playout"
    Option "metamodes" "DP-0: 3840x1792 +0+0"
EndSection
`
const LAYOUT = 'Section "ServerLayout"\n Identifier "x"\nEndSection\n'

let dir, xorg
const run = (...args) =>
	spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, HIGHASCG_XORG_DIR: xorg } })
const file = (name, text) => {
	const p = path.join(dir, name)
	fs.writeFileSync(p, text)
	return p
}

describe('WO-906 xorg screens helper', { skip: process.getuid && process.getuid() === 0 }, () => {
	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo906-'))
		xorg = path.join(dir, 'xorg.conf.d')
	})
	after(() => fs.rmSync(dir, { recursive: true, force: true }))

	it('a two-screen layout validates, installs, turns off and restores', () => {
		const good = file('good.conf', GOOD)
		assert.equal(run('check', good).status, 0)
		assert.equal(run('install', good).status, 0)
		const dst = path.join(xorg, '98-highascg-screens.conf')
		assert.equal(fs.readFileSync(dst, 'utf8'), GOOD)
		assert.equal(run('off').status, 0)
		assert.ok(!fs.existsSync(dst) && fs.existsSync(dst + '.prev'), 'off keeps the layout as .prev (X never loads it)')
		assert.equal(run('restore').status, 0)
		assert.equal(fs.readFileSync(dst, 'utf8'), GOOD)
	})

	it('refuses anything outside the allowed sections, keywords and options — before writing', () => {
		const cases = {
			files: 'Section "Files"\n ModulePath "/tmp/x"\nEndSection\n' + LAYOUT,
			module: 'Section "Module"\n Load "x"\nEndSection\n' + LAYOUT,
			driver: 'Section "Device"\n Driver "modesetting"\nEndSection\n' + LAYOUT,
			option: 'Section "Device"\n Option "ModulePath" "/tmp"\nEndSection\n' + LAYOUT,
			busid: 'Section "Device"\n BusID "PCI:1:0:0; rm -rf /"\nEndSection\n' + LAYOUT,
			shell: 'Section "ServerLayout"\n Identifier "x" $(id)\nEndSection\n',
			unclosed: 'Section "ServerLayout"\n Identifier "x"\n',
			nolayout: 'Section "Device"\n Identifier "x"\nEndSection\n',
			defaultDevice: 'Section "Device"\n Identifier "NVIDIA Default Device"\nEndSection\n' + LAYOUT,
		}
		const before = fs.readFileSync(path.join(xorg, '98-highascg-screens.conf'), 'utf8')
		for (const [name, text] of Object.entries(cases)) {
			const r = run('install', file(name + '.conf', text))
			assert.equal(r.status, 2, name + ': ' + r.stderr)
		}
		assert.equal(fs.readFileSync(path.join(xorg, '98-highascg-screens.conf'), 'utf8'), before, 'the installed layout is untouched')
		assert.deepEqual(fs.readdirSync(xorg).filter((f) => f.startsWith('.')), [], 'no temp file left behind')
	})

	it('a symlink is refused (the helper copies content, never a path the caller controls)', () => {
		const link = path.join(dir, 'link.conf')
		fs.symlinkSync(file('real.conf', GOOD), link)
		assert.equal(run('check', link).status, 2)
	})

	it('the installer ships the helper and one sudoers line for it', () => {
		const inst = fs.readFileSync(path.join(__dirname, '../../scripts/runtime/install-xorg-screens-apply.sh'), 'utf8')
		assert.match(inst, /DST=\/usr\/local\/lib\/highascg\/highascg-xorg-screens-apply\.sh/)
		assert.match(inst, /\$\{USER_CASPAR\} ALL=\(root\) NOPASSWD: \$\{DST\}/)
		assert.match(inst, /visudo -cf "\$SUDOERS"/)
	})
})
