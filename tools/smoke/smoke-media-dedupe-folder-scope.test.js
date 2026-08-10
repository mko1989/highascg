'use strict'

/* Regression: the media browser deduped rows on the bare basename, so the same filename in two
 * folders collapsed to one row. On highascg7579 the operator's media existed in BOTH
 * ~/highascg/media/bridge and ~/highascg/media/exfat (something had copied the stick payload onto
 * the bridge disk); `exfat/TALK2.mp4` and `bridge/TALK2.mp4` both keyed to `talk2`, and
 * mergeMediaRows' localeCompare tie-break puts `bridge/` first — so every file under exfat/ was
 * swallowed and the GUI showed an empty exfat folder while the files were plainly on disk.
 *
 * canonicalMediaBasenameKey stays directory-blind on purpose: caspar-cls-id.js and
 * playback-tracker-media.js resolve a bare clip name that carries no path. Only the browser dedupe
 * scopes by folder, via canonicalMediaRowKey. */

const assert = require('assert')
const {
	dedupeMediaList,
	canonicalMediaBasenameKey,
	canonicalMediaRowKey,
} = require('../../src/utils/media-browser-dedupe')

/* The eight files as they exist on the box, identical in both folders. */
const NAMES = [
	'06f - J Lin - Blood-based Methylation Next-Generation Sequencing Technology for Lung Cancer Screening.mp4',
	'Conference Acknowledgements 3.16.2026 rev3.mp4',
	'leader2050_intro_1.mp4',
	'leader2050_intro.mp4',
	'M_czwartek_glowki frn26_28.png',
	'pkg_belka_animowana_1_1920x200_all.mp4',
	'PKG-TypoAnim-Scene01_v5-ambicja_mix.mp4',
	'TALK2.mp4',
]

const rows = [{ id: 'bridge', isDir: true }, { id: 'exfat', isDir: true }]
for (const n of NAMES) {
	rows.push({ id: `bridge/${n}` })
	rows.push({ id: `exfat/${n}` })
}

const out = dedupeMediaList(rows)
const inFolder = (p) => out.filter((r) => r.id.startsWith(p)).length
assert.strictEqual(inFolder('bridge/'), NAMES.length, 'every bridge file survives dedupe')
assert.strictEqual(inFolder('exfat/'), NAMES.length, 'every exfat file survives dedupe')
assert.ok(out.some((r) => r.id === 'exfat' && r.isDir), 'the exfat folder row is still listed')

/* Same name, different folder → different rows. This is the whole bug. */
assert.notStrictEqual(
	canonicalMediaRowKey('exfat/TALK2.mp4'),
	canonicalMediaRowKey('bridge/TALK2.mp4'),
	'a filename in two folders must not collapse to one row',
)

/* Within one folder the intended merges must still happen — Caspar CLS lists clips uppercased and
 * without an extension, and that row has to fold onto the disk-scan row for the same file. */
assert.strictEqual(
	canonicalMediaRowKey('BRIDGE/TALK2'),
	canonicalMediaRowKey('bridge/TALK2.mp4'),
	'CLS casing + missing extension still merges inside a folder',
)
assert.strictEqual(
	canonicalMediaRowKey('bridge/clip_h265.mp4'),
	canonicalMediaRowKey('bridge/clip.mp4'),
	'encoding-tag variants still merge inside a folder',
)
assert.strictEqual(dedupeMediaList([{ id: 'bridge/TALK2' }, { id: 'bridge/TALK2.mp4' }]).length, 1)

/* Root-level files keep working, and a root file does not merge with a same-named nested one. */
assert.strictEqual(canonicalMediaRowKey('TALK2.mp4'), 'talk2')
assert.notStrictEqual(canonicalMediaRowKey('TALK2.mp4'), canonicalMediaRowKey('bridge/TALK2.mp4'))

/* Nested folders are scoped by their full path, not just the leaf. */
assert.notStrictEqual(
	canonicalMediaRowKey('projects/a/clip.mp4'),
	canonicalMediaRowKey('projects/b/clip.mp4'),
)

/* Backslashes and duplicate separators normalise the same way as the loose key. */
assert.strictEqual(canonicalMediaRowKey('bridge\\\\TALK2.mp4'), 'bridge/talk2')
assert.strictEqual(canonicalMediaRowKey('bridge//TALK2.mp4'), 'bridge/talk2')
assert.strictEqual(canonicalMediaRowKey(''), '')
assert.strictEqual(canonicalMediaRowKey(null), '')

/* The loose key MUST stay directory-blind — cls-id and playback-tracker match bare names. */
assert.strictEqual(canonicalMediaBasenameKey('exfat/TALK2.mp4'), 'talk2')
assert.strictEqual(canonicalMediaBasenameKey('bridge/TALK2.mp4'), 'talk2')

console.log('smoke-media-dedupe-folder-scope: ok')
