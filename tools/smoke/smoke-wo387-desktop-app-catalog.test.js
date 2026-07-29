'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * WO-387: the operator "Open window" menu lists what is INSTALLED, not a hard-coded five.
 *
 * These pin the vocabulary the whole feature rests on:
 *   - Exec parsing, because a stray field code becomes an argument the app tries to open;
 *   - window-class derivation, because the class is the ONLY handle the helper watchdog has on a
 *     helper window — get it wrong and the kiosk can never be restored (WO-283's failure mode);
 *   - the action gate, because it is what keeps the API "installed applications" and not "any
 *     command the client asks for".
 */

const parse = require('../../src/utils/desktop-app-catalog-parse')
const catalog = require('../../src/utils/desktop-app-catalog')

/* ───────────────────────────────────────────────────────────────────────────── */
/* PARSING */
/* ───────────────────────────────────────────────────────────────────────────── */

test('parseDesktopEntry reads only the [Desktop Entry] group', () => {
	const e = parse.parseDesktopEntry(
		['[Desktop Entry]', 'Name=Zoom Workplace', 'Exec=/usr/bin/zoom %U', '', '[Desktop Action New]', 'Name=Other'].join('\n'),
	)
	assert.equal(e.Name, 'Zoom Workplace')
	assert.equal(e.Exec, '/usr/bin/zoom %U')
})

test('parseDesktopEntry ignores comments and localised keys', () => {
	const e = parse.parseDesktopEntry(['[Desktop Entry]', '# a comment', 'Name=XTerm', 'Name[de]=XTerm DE'].join('\n'))
	assert.equal(e.Name, 'XTerm', 'a locale variant must not overwrite the unlocalised value')
})

test('splitExec drops field codes and keeps a literal %%', () => {
	assert.deepEqual(parse.splitExec('/usr/bin/zoom %U'), ['/usr/bin/zoom'])
	assert.deepEqual(parse.splitExec('thunar %U'), ['thunar'])
	assert.deepEqual(parse.splitExec('foo --pct 100%% bar'), ['foo', '--pct', '100%', 'bar'])
})

test('splitExec honours the spec quoting rules', () => {
	assert.deepEqual(parse.splitExec('handler --template "https://x/@<LAT>,<LON>" %u'), [
		'handler',
		'--template',
		'https://x/@<LAT>,<LON>',
	])
	assert.deepEqual(parse.splitExec('app "a b" c'), ['app', 'a b', 'c'], 'a quoted space must not split, nor become a %')
})

test('stripFieldCodes leaves a lone percent alone', () => {
	assert.equal(parse.stripFieldCodes('100%'), '100%')
	assert.equal(parse.stripFieldCodes('%U'), '')
	assert.equal(parse.stripFieldCodes('%%'), '%')
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* WINDOW CLASS — the handle the helper watchdog needs */
/* ───────────────────────────────────────────────────────────────────────────── */

test('StartupWMClass wins, exec basename is the fallback', () => {
	assert.deepEqual(parse.deriveWindowClasses({ Exec: '/usr/bin/zoom %U', StartupWMClass: 'zoom' }), ['zoom'])
	assert.deepEqual(parse.deriveWindowClasses({ Exec: 'thunar %U' }), ['thunar'], 'no StartupWMClass -> binary basename')
	assert.deepEqual(parse.deriveWindowClasses({ Exec: 'firefox-esr %u', StartupWMClass: 'firefox-esr-esr140' }), [
		'firefox-esr-esr140',
		'firefox-esr',
	])
})

test('a console app is identified by the private class its terminal is started under, ALONE', () => {
	const classes = parse.deriveWindowClasses(
		{ Exec: 'mc', Terminal: 'true' },
		{ terminalBin: '/usr/bin/lxterm', terminalClass: 'highascg-mc' },
	)
	// The candidate list is OR-searched: adding the emulator's generic class back would let a park
	// of "Midnight Commander" grab an unrelated terminal window.
	assert.deepEqual(classes, ['highascg-mc'])
})

test('without a class flag a console app falls back to the emulator class, xterm wrappers resolved', () => {
	assert.deepEqual(parse.deriveWindowClasses({ Exec: 'mc', Terminal: 'true' }, { terminalBin: '/usr/bin/konsole' }), [
		'konsole',
	])
	// lxterm/uxterm are wrapper scripts: the window they map reports res_class `xterm` (verified live).
	assert.deepEqual(parse.deriveWindowClasses({ Exec: 'mc', Terminal: 'true' }, { terminalBin: '/usr/bin/lxterm' }), [
		'xterm',
	])
})

test('escapeWindowClass keeps a derived class literal in xdotool regex', () => {
	assert.equal(parse.escapeWindowClass('python3.12'), 'python3\\.12')
	assert.equal(parse.escapeWindowClass('gtk+'), 'gtk\\+')
})

test('terminalArgv sets the private class per emulator family', () => {
	assert.deepEqual(catalog.terminalArgv('/usr/bin/lxterm', 'highascg-mc', 'MC', ['/usr/bin/mc']), [
		'-class',
		'highascg-mc',
		'-title',
		'MC',
		'-e',
		'/usr/bin/mc',
	])
	assert.deepEqual(catalog.terminalArgv('/usr/bin/konsole', 'highascg-mc', 'MC', ['/usr/bin/mc']), ['-e', '/usr/bin/mc'])
	assert.equal(catalog.terminalSupportsClass('/usr/bin/konsole'), false)
	assert.equal(catalog.terminalSupportsClass('/usr/bin/xterm'), true)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* WHAT MAY APPEAR, AND WHAT MAY LAUNCH */
/* ───────────────────────────────────────────────────────────────────────────── */

test('isMenuEntry applies the spec flags only — not a curated allow-list', () => {
	assert.equal(parse.isMenuEntry({ Type: 'Application', Exec: 'zoom' }), true)
	assert.equal(parse.isMenuEntry({ Type: 'Application', Exec: 'zoom', NoDisplay: 'true' }), false)
	assert.equal(parse.isMenuEntry({ Type: 'Application', Exec: 'zoom', Hidden: 'true' }), false)
	assert.equal(parse.isMenuEntry({ Type: 'Link', Exec: 'zoom' }), false)
	assert.equal(parse.isMenuEntry({ Type: 'Application' }), false, 'no Exec = nothing to launch')
	assert.equal(parse.isMenuEntry({ Type: 'Application', Exec: 'k', OnlyShowIn: 'KDE;' }), false)
	assert.equal(parse.isMenuEntry({ Type: 'Application', Exec: 'k', OnlyShowIn: 'KDE;' }, { currentDesktop: 'KDE' }), true)
})

test('parseAppAction refuses anything that is not a plain desktop id', () => {
	assert.equal(parse.parseAppAction('app:Zoom'), 'Zoom')
	assert.equal(parse.parseAppAction('app:org.freedesktop.IBus.Setup'), 'org.freedesktop.IBus.Setup')
	assert.equal(parse.parseAppAction('firefox'), null, 'a pinned action is not an app action')
	assert.equal(parse.parseAppAction('app:../../etc/passwd'), null)
	assert.equal(parse.parseAppAction('app:a b'), null)
	assert.equal(parse.parseAppAction('app:'), null)
	assert.equal(parse.parseAppAction('app:/usr/bin/sh'), null)
})

test('an app whose binary IS a pinned tool routes to the pinned action', () => {
	// firefox-esr.desktop launched raw would open the DEFAULT profile — the one the kiosk holds —
	// and produce the "Close Firefox" profile-lock modal instead of a browser window.
	assert.equal(parse.pinnedActionFor({ Exec: 'firefox-esr %u' }), 'firefox')
	assert.equal(parse.pinnedActionFor({ Exec: 'thunar %U' }), 'file-manager')
	assert.equal(parse.pinnedActionFor({ Exec: 'thunar --bulk-rename %F' }), null, 'a different tool, same binary')
	assert.equal(parse.pinnedActionFor({ Exec: '/usr/bin/zoom %U' }), null)
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* SCAN — against a fixture tree, so the test does not depend on what is installed */
/* ───────────────────────────────────────────────────────────────────────────── */

/** @returns {string} a temp applications dir */
function fixtureDir(entries) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo387-'))
	for (const [file, body] of Object.entries(entries)) fs.writeFileSync(path.join(dir, file), body)
	return dir
}

test('scanDesktopApps keeps launchable entries and drops the rest', () => {
	const dir = fixtureDir({
		'Good.desktop': '[Desktop Entry]\nType=Application\nName=Good\nExec=/bin/sh\nStartupWMClass=good\n',
		'Hidden.desktop': '[Desktop Entry]\nType=Application\nName=Hidden\nExec=/bin/sh\nNoDisplay=true\n',
		'Gone.desktop': '[Desktop Entry]\nType=Application\nName=Gone\nExec=/nonexistent/binary\n',
		'Stale.desktop': '[Desktop Entry]\nType=Application\nName=Stale\nExec=/bin/sh\nTryExec=/nonexistent/binary\n',
		'notes.txt': 'ignored',
	})
	const apps = catalog.scanDesktopApps({ dirs: [dir], currentDesktop: '', terminalBin: null })
	assert.deepEqual(
		apps.map((a) => a.id),
		['Good'],
		'a .desktop file whose package was removed must not be offered',
	)
	assert.equal(apps[0].action, 'app:Good')
	assert.deepEqual(apps[0].windowClasses, ['good', 'sh'], 'declared class first, exec basename as the fallback')
	fs.rmSync(dir, { recursive: true, force: true })
})

test('a higher-precedence directory shadows the same id rather than duplicating it', () => {
	const high = fixtureDir({ 'App.desktop': '[Desktop Entry]\nType=Application\nName=Mine\nExec=/bin/sh\n' })
	const low = fixtureDir({ 'App.desktop': '[Desktop Entry]\nType=Application\nName=System\nExec=/bin/sh\n' })
	const apps = catalog.scanDesktopApps({ dirs: [high, low], currentDesktop: '', terminalBin: null })
	assert.equal(apps.length, 1)
	assert.equal(apps[0].name, 'Mine')
	fs.rmSync(high, { recursive: true, force: true })
	fs.rmSync(low, { recursive: true, force: true })
})

test('a console entry is dropped when no terminal emulator exists to host it', () => {
	const dir = fixtureDir({ 'Con.desktop': '[Desktop Entry]\nType=Application\nName=Con\nExec=/bin/sh\nTerminal=true\n' })
	assert.equal(catalog.scanDesktopApps({ dirs: [dir], currentDesktop: '', terminalBin: null }).length, 0)
	assert.equal(catalog.scanDesktopApps({ dirs: [dir], currentDesktop: '', terminalBin: '/usr/bin/xterm' }).length, 1)
	fs.rmSync(dir, { recursive: true, force: true })
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* THE GATE */
/* ───────────────────────────────────────────────────────────────────────────── */

test('an action that is not an installed app is refused', () => {
	const { isHelperAction, HELPER_ACTIONS } = require('../../src/system/operator-helper-window')
	for (const a of HELPER_ACTIONS) assert.equal(isHelperAction(a), true, `${a} is a pinned action`)
	assert.equal(isHelperAction('app:definitely-not-installed-xyz'), false)
	assert.equal(isHelperAction('app:../../bin/sh'), false)
	assert.equal(isHelperAction('/bin/sh'), false)
	assert.equal(isHelperAction(''), false)
	// The launch resolver is the second gate: no entry, no command. It NEVER takes a command line
	// from the request — that is the whole security model of WO-387.
	assert.equal(catalog.resolveAppLaunch('app:definitely-not-installed-xyz'), null)
})

test('window classes for an unknown app action are empty, not thrown', () => {
	const { windowClassesFor } = require('../../src/utils/x-display-session-gui-windows')
	assert.deepEqual(windowClassesFor('app:definitely-not-installed-xyz'), [])
	assert.deepEqual(windowClassesFor('nope'), [])
	assert.deepEqual(windowClassesFor('nvidia-settings'), ['nvidia-settings'], 'pinned tools keep their curated class')
	assert.deepEqual(windowClassesFor('firefox'), ['Navigator', 'Firefox'])
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* MORE THAN ONE WINDOW AT A TIME (owner report, 29.07) */
/* ───────────────────────────────────────────────────────────────────────────── */

test('the single WO-283 session can be yielded so a second helper may open', async () => {
	const {
		openOperatorHelperWindow,
		closeOperatorHelperWindow,
		yieldOperatorHelperSession,
		getOperatorHelperState,
		STATE,
	} = require('../../src/system/operator-helper-window')
	const deps = {
		findGuiWindowIds: async () => [],
		spawnGuiDetached: () => '/usr/bin/fake-helper',
		promoteGuiWindowsAboveKiosk: async () => true,
		setKioskTopAssert: () => {},
		raiseOperatorGuiBrowser: async () => ({ ok: true }),
		watchdogIntervalMs: 10_000, // never fires inside the test
	}
	const opts = { log: () => {}, deps }
	try {
		assert.equal(yieldOperatorHelperSession('nothing to yield'), false, 'an idle session yields nothing')

		const first = await openOperatorHelperWindow('app:definitely-not-installed-xyz', {}, opts)
		assert.equal(first.ok, false, 'an uninstalled app is still refused — yielding does not widen the vocabulary')

		assert.equal((await openOperatorHelperWindow('firefox', {}, opts)).ok, true)
		// The WO-283 refusal itself is UNCHANGED: with the taskbar off, one helper at a time.
		const second = await openOperatorHelperWindow('nvidia-settings', {}, opts)
		assert.equal(second.ok, false)
		assert.match(second.reason, /^busy_/)

		// ...and this is what the taskbar coordinator does instead of inheriting that refusal.
		assert.equal(yieldOperatorHelperSession('taskbar launching nvidia-settings'), true)
		assert.equal(getOperatorHelperState().state, STATE.IDLE, 'yield leaves the session free, not restoring')
		assert.equal((await openOperatorHelperWindow('nvidia-settings', {}, opts)).ok, true)
	} finally {
		await closeOperatorHelperWindow({}, opts).catch(() => {})
	}
})

test('the taskbar launch path yields the single session before delegating', () => {
	// Source-text guard: the delegation in operator-helper-live.js is the ONLY reason a second
	// window could not open, and it has no offline test of its own (every branch needs a live X).
	const src = fs.readFileSync(path.join(__dirname, '../../src/system/operator-helper-live.js'), 'utf8')
	assert.match(src, /yieldOperatorHelperSession\(/, 'launchHelper must yield before openOperatorHelperWindow')
	const yieldAt = src.indexOf('yieldOperatorHelperSession(`')
	const openAt = src.indexOf('await openOperatorHelperWindow(')
	assert.ok(yieldAt > 0 && openAt > yieldAt, 'the yield must come BEFORE the delegated open')
})

/* ───────────────────────────────────────────────────────────────────────────── */
/* ICONS */
/* ───────────────────────────────────────────────────────────────────────────── */

test('icon lookup never follows a name out of the icon roots', () => {
	const { iconCandidates } = require('../../src/api/operator-helper-icon')
	assert.deepEqual(iconCandidates('../../etc/passwd'), [])
	assert.deepEqual(iconCandidates('/etc/passwd'), [])
	assert.deepEqual(iconCandidates('/etc/shadow.png'), [], 'absolute paths outside the icon roots are refused')
	assert.equal(iconCandidates('/usr/share/pixmaps/Zoom.png').length, 1, 'inside a root, an absolute path is allowed')
	const c = iconCandidates('Zoom')
	assert.ok(c.length > 0)
	assert.ok(
		c.every((f) => f.endsWith('.png') || f.endsWith('.svg')),
		'only browser-renderable formats — an <img> pointing at an XPM shows nothing',
	)
})

test('the five pinned tools keep their exact hard-coded icon paths', () => {
	const { HELPER_ICON_CANDIDATES, candidatesForAction } = require('../../src/api/operator-helper-icon')
	for (const action of Object.keys(HELPER_ICON_CANDIDATES)) {
		assert.deepEqual(candidatesForAction(action), HELPER_ICON_CANDIDATES[action])
	}
})
