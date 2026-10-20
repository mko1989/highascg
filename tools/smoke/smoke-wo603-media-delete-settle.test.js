'use strict'

/**
 * WO-603 slice 9b — a deleted media folder's nested clip stayed in the library (box 20.10: the Godot folder delete
 * left "WO603DEL/SUB/DEL_TWO" listed until a manual refresh). Caspar's scanner forgets deleted clips ~1–2 s after the
 * unlink, so the rescan the delete triggers at once can still re-list them; handleMediaDelete now rescans again once
 * that has settled (DELETE_SETTLE_MS).
 */

const { describe, it, mock, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const registry = require('../../src/media/media-library-registry')
const versions = require('../../src/media/media-versions')
const { handleMediaDelete } = require('../../src/api/routes-media')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo603-del-'))
registry._setRegistryDirForTests(path.join(tmp, 'registry'))
versions._setVersionsRootForTests(path.join(tmp, 'versions'))
after(() => {
	registry._setRegistryDirForTests(null)
	versions._setVersionsRootForTests(null)
	fs.rmSync(tmp, { recursive: true, force: true })
})

describe('WO-603 media delete → settled rescan', () => {
	it('a folder delete removes it on disk, rescans at once and again after the settle delay', async () => {
		const media = path.join(tmp, 'media')
		fs.mkdirSync(path.join(media, 'del', 'sub'), { recursive: true })
		fs.writeFileSync(path.join(media, 'del', 'sub', 'two.png'), 'x')
		let rescans = 0
		const ctx = { config: { local_media_path: media }, log: () => {}, runMediaLibraryQueryCycle: () => rescans++ }
		mock.timers.enable({ apis: ['setTimeout'] })
		try {
			const r = await handleMediaDelete(JSON.stringify({ id: 'del' }), ctx)
			assert.equal(r.status, 200, String(r.body))
			assert.equal(fs.existsSync(path.join(media, 'del')), false)
			assert.equal(rescans, 1, 'immediate rescan')
			mock.timers.tick(2999)
			assert.equal(rescans, 1)
			mock.timers.tick(1)
			assert.equal(rescans, 2, 'settle rescan clears what Caspar still listed')
		} finally {
			mock.timers.reset()
		}
	})
})
