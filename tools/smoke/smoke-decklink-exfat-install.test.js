'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const LIB = path.join(ROOT, 'scripts/lib/decklink-install-lib.sh')

function bashEval(script) {
	return execFileSync('bash', ['-c', script], {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, ROOT },
	})
}

test('decklink_deb_version_from_basename parses version suffixes', () => {
	const out = bashEval(`
		source "${LIB}"
		decklink_deb_version_from_basename "desktopvideo_16.0.1a2_amd64.deb"
		echo "---"
		decklink_deb_version_from_basename "desktopvideo-gui_15.3.1_amd64.deb"
	`)
	const [main, gui] = out.trim().split('\n---\n')
	assert.equal(main, '16.0.1a2')
	assert.equal(gui, '15.3.1')
})

test('decklink_find_newest_vendor_pair picks newest matching gui deb', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decklink-vendor-'))
	const deck = path.join(tmp, 'decklink')
	fs.mkdirSync(deck)
	fs.writeFileSync(path.join(deck, 'desktopvideo_15.0.0_amd64.deb'), '')
	fs.writeFileSync(path.join(deck, 'desktopvideo-gui_15.0.0_amd64.deb'), '')
	fs.writeFileSync(path.join(deck, 'desktopvideo_16.0.1a2_amd64.deb'), '')
	fs.writeFileSync(path.join(deck, 'desktopvideo-gui_16.0.1a2_amd64.deb'), '')

	const out = bashEval(`
		source "${LIB}"
		decklink_vendor_search_dirs() { echo "${deck}"; }
		decklink_find_newest_vendor_pair || exit 1
		echo "$DECKLINK_VENDOR_VERSION"
		echo "$DECKLINK_VENDOR_MAIN_DEB"
	`)
	const lines = out.trim().split('\n')
	assert.equal(lines[0], '16.0.1a2')
	assert.match(lines[1], /desktopvideo_16\.0\.1a2_amd64\.deb$/)
})

test('decklink_find_newest_vendor_pair accepts main-only when gui deb omitted', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decklink-main-'))
	const deck = path.join(tmp, 'decklink')
	fs.mkdirSync(deck)
	fs.writeFileSync(path.join(deck, 'desktopvideo_16.0.1a2_amd64.deb'), '')

	const out = bashEval(`
		source "${LIB}"
		decklink_vendor_search_dirs() { echo "${deck}"; }
		decklink_find_newest_vendor_pair || exit 1
		echo "$DECKLINK_VENDOR_VERSION"
		echo "$DECKLINK_VENDOR_GUI_DEB"
	`)
	const lines = out.trim().split('\n')
	assert.equal(lines[0], '16.0.1a2')
	assert.ok(lines.length >= 1)
	assert.ok(!lines[1] || lines[1] === '')
})

test('decklink_needs_install_from_vendor skips when dpkg reports installed version', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decklink-skip-'))
	const deck = path.join(tmp, 'decklink')
	fs.mkdirSync(deck)
	fs.writeFileSync(path.join(deck, 'desktopvideo_16.0.1a2_amd64.deb'), '')
	fs.writeFileSync(path.join(deck, 'desktopvideo-gui_16.0.1a2_amd64.deb'), '')

	const out = bashEval(`
		source "${LIB}"
		decklink_vendor_search_dirs() { echo "${deck}"; }
		decklink_pkg_installed_version() {
			case "$1" in
				desktopvideo|desktopvideo-gui) echo "16.0.1a2" ;;
				*) return 1 ;;
			esac
		}
		reason=""
		if decklink_needs_install_from_vendor reason; then
			echo "NEEDS_INSTALL:$reason"
		else
			echo "SKIP:$reason"
		fi
	`)
	assert.match(out.trim(), /^SKIP:already installed/)
})

test('decklink_needs_install_from_vendor wants install when vendor is newer', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decklink-up-'))
	const deck = path.join(tmp, 'decklink')
	fs.mkdirSync(deck)
	fs.writeFileSync(path.join(deck, 'desktopvideo_16.1.0_amd64.deb'), '')
	fs.writeFileSync(path.join(deck, 'desktopvideo-gui_16.1.0_amd64.deb'), '')

	const out = bashEval(`
		source "${LIB}"
		decklink_vendor_search_dirs() { echo "${deck}"; }
		decklink_pkg_installed_version() {
			case "$1" in
				desktopvideo|desktopvideo-gui) echo "16.0.1a2" ;;
				*) return 1 ;;
			esac
		}
		reason=""
		if decklink_needs_install_from_vendor reason; then
			echo "NEEDS_INSTALL:$reason"
		else
			echo "SKIP:$reason"
		fi
	`)
	assert.match(out.trim(), /^NEEDS_INSTALL:install or upgrade/)
})
