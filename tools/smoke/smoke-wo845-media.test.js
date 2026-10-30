'use strict'

/**
 * WO-845 smoke — media / thumbnail defects from the 29.10 sweep (REPORT §5 "Media and thumbnails"):
 *  - custom thumbnail upload truncated ch-N.png to 0 bytes (the server had already consumed the body)
 *  - PRINT capture matched "the newest PNG" across channels (two channels capturing together swapped pictures)
 *  - inode relink after a delete re-pointed every reference at an unrelated new file that reused the inode
 *  - the ffprobe cache was never invalidated when a file was replaced
 * All paths are temp dirs; PRINT is a mock that drops files like Caspar does. No Caspar, no live state.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `wo845-${p}-`))
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const fakePng = (fill, n = 6000) => Buffer.concat([PNG_HEAD, Buffer.alloc(n, fill)])

test('WO-845: custom thumbnail upload writes the real bytes (and refuses what it cannot read)', async () => {
	const { handleLiveThumbnailUploadPost } = require('../../src/media/live-thumbnail-cache-handlers')
	const cache = tmp('cache')
	try {
		const ctx = { config: { live_thumbnail_cache_path: cache } }
		const png = fakePng(7, 5000)
		const res = await handleLiveThumbnailUploadPost(Readable.from([png.subarray(0, 100), png.subarray(100)]), { channel: '3' }, ctx)
		assert.equal(res.status, 200)
		const out = fs.readFileSync(path.join(cache, 'ch-3.png'))
		assert.equal(out.length, png.length, 'real bytes, not 0')
		assert.ok(out.equals(png))
		const meta = JSON.parse(fs.readFileSync(path.join(cache, 'ch-3.json'), 'utf8'))
		assert.equal(meta.isCustom, true)
		assert.equal(fs.existsSync(path.join(cache, 'ch-3.png.tmp')), false)

		// non-PNG: refused, previous thumbnail intact
		const bad = await handleLiveThumbnailUploadPost(Readable.from([Buffer.from('<html>nope</html>')]), { channel: '3' }, ctx)
		assert.equal(bad.status, 415)
		assert.ok(fs.readFileSync(path.join(cache, 'ch-3.png')).equals(png))

		// body already consumed by the server (the old failure mode): refuse, do NOT truncate the cache
		const used = Readable.from([png])
		await new Promise((r) => used.on('data', () => {}).on('end', r))
		const gone = await handleLiveThumbnailUploadPost(used, { channel: '3' }, ctx)
		assert.equal(gone.status, 409)
		assert.ok(fs.readFileSync(path.join(cache, 'ch-3.png')).equals(png), 'cache not wiped')
	} finally {
		fs.rmSync(cache, { recursive: true, force: true })
	}
})

test('WO-845: concurrent PRINT captures on two channels each get their own picture', async () => {
	const { captureLiveThumbnailToCache } = require('../../src/media/live-thumbnail-cache-capture')
	const media = tmp('media')
	const cache = tmp('cache')
	try {
		const cfg = { local_media_path: media, live_thumbnail_cache_path: cache, live_thumbnail_ttl_ms: 0 }
		// Caspar's PRINT reply names no file; a timestamp-named PNG appears shortly after (ch2's later than ch1's).
		const print = (ch) =>
			new Promise((resolve) => {
				setTimeout(() => fs.writeFileSync(path.join(media, `20260101T00000${ch}.png`), fakePng(ch)), 20 * ch)
				resolve({ ok: true, data: '202 PRINT OK' })
			})
		const ctx = { config: cfg, amcp: { basic: { print } } }
		const [a, b] = await Promise.all([
			captureLiveThumbnailToCache(ctx, 1, { force: true }),
			captureLiveThumbnailToCache(ctx, 2, { force: true }),
		])
		assert.equal(a.ok, true, JSON.stringify(a))
		assert.equal(b.ok, true, JSON.stringify(b))
		assert.equal(fs.readFileSync(path.join(cache, 'ch-1.png'))[PNG_HEAD.length], 1, 'ch1 shows ch1\'s picture')
		assert.equal(fs.readFileSync(path.join(cache, 'ch-2.png'))[PNG_HEAD.length], 2, 'ch2 shows ch2\'s picture')
		assert.equal(fs.existsSync(path.join(cache, 'ch-1.png.tmp')), false)
		assert.deepEqual(fs.readdirSync(media), [], 'PRINT scratch stills cleaned up')
	} finally {
		fs.rmSync(media, { recursive: true, force: true })
		fs.rmSync(cache, { recursive: true, force: true })
	}
})

test('WO-845: inode relink needs size + mtime agreement (a reused inode is not the same clip)', () => {
	const { reconcileRegistry } = require('../../src/media/media-library-registry')
	const mk = () => ({
		items: { A: { id: 'A', path: 'old/a.mp4', dev: 1, ino: 77, size: 1000, mtimeMs: 5000 } },
	})
	// clip A deleted; a DIFFERENT file B reused inode 77
	let reg = mk()
	let r = reconcileRegistry(reg, [{ path: 'new/b.mp4', dev: 1, ino: 77, size: 4321, mtimeMs: 9000 }])
	assert.deepEqual(r.relinked, [], 'no relink onto an unrelated file')
	assert.equal(r.added, 1)
	assert.equal(reg.items.A.path, 'old/a.mp4', 'A keeps its own path (reported missing, not re-pointed)')
	// a genuine move keeps ino, size and mtime
	reg = mk()
	r = reconcileRegistry(reg, [{ path: 'moved/a.mp4', dev: 1, ino: 77, size: 1000, mtimeMs: 5000 }])
	assert.equal(r.relinked.length, 1)
	assert.equal(reg.items.A.path, 'moved/a.mp4')
})

test('WO-845: the ffprobe cache is dropped when the file size or mtime changes', async () => {
	const { statStamp, recordProbeStamp, dropStaleProbeEntries } = require('../../src/media/probe-cache')
	const { enrichMediaListForHttp } = require('../../src/api/media-catalog')
	const base = tmp('probe')
	try {
		const fp = path.join(base, 'clip.mov')
		fs.writeFileSync(fp, 'v1')
		const ctx = { config: { local_media_path: base }, _mediaProbeCache: {}, _mediaProbeTried: new Set() }
		ctx._mediaProbeCache['clip.mov'] = { durationMs: 1000, resolution: '1920×1080', fps: 25 }
		ctx._mediaProbeTried.add('clip.mov')
		recordProbeStamp(ctx, 'clip.mov', await statStamp(fp))

		// unchanged: stays cached
		assert.deepEqual(await dropStaleProbeEntries(ctx, ['clip.mov'], () => fp), [])
		assert.equal(ctx._mediaProbeCache['clip.mov'].durationMs, 1000)

		// replaced with a different file (size changes)
		fs.writeFileSync(fp, 'version-two-is-longer')
		assert.deepEqual(await dropStaleProbeEntries(ctx, ['clip.mov'], () => fp), ['clip.mov'])
		assert.equal(ctx._mediaProbeCache['clip.mov'], undefined)
		assert.equal(ctx._mediaProbeTried.has('clip.mov'), false, 'will be probed again')

		// same size, newer mtime (re-encode to identical length)
		recordProbeStamp(ctx, 'clip.mov', await statStamp(fp))
		ctx._mediaProbeCache['clip.mov'] = { durationMs: 2000 }
		const later = new Date(Date.now() + 60_000)
		fs.utimesSync(fp, later, later)
		assert.deepEqual(await dropStaleProbeEntries(ctx, ['clip.mov'], () => fp), ['clip.mov'])

		// end to end through the /api/media enrichment: a stale entry no longer wins over fresh data
		const ctx2 = { config: { local_media_path: base }, _mediaProbeCache: {}, _mediaProbeTried: new Set() }
		ctx2._mediaProbeCache['clip.mov'] = { durationMs: 99999, resolution: '1×1', fps: 1 }
		ctx2._mediaProbeTried.add('clip.mov')
		recordProbeStamp(ctx2, 'clip.mov', '3:1') // a stamp that cannot match the real file
		const list = await enrichMediaListForHttp(ctx2, [{ id: 'clip.mov', label: 'clip.mov' }])
		assert.notEqual(list[0].durationMs, 99999, 'stale probe data dropped')
	} finally {
		fs.rmSync(base, { recursive: true, force: true })
	}
})
