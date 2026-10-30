'use strict'

/**
 * WO-825 — build the box-local GDTF Share library (gdtf-library.js layout) from the box's own account: for the newest
 * revision of every fixture, download the .gdtf once, keep description.xml (brotli) and a 128 px WebP of its thumbnail,
 * drop the rest (models, wheel images — fetched per fixture when used, or by the opt-in full download). Resumable (an
 * entry whose files are on disk is skipped; the index is saved every SAVE_EVERY entries), polite (gdtf-share-job.js).
 * ~10.5 k fixtures: ~60 MB of XML + a few tens of MB of thumbnails, from ~12 GB of downloads (WO-825 numbers).
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { spawn } = require('child_process')
const unzipper = require('unzipper')
const share = require('./gdtf-share')
const lib = require('./gdtf-library')
const { run } = require('./gdtf-share-job')

const SAVE_EVERY = 50
const THUMB_PX = 128

/**
 * The newest revision of every fixture (manufacturer + name; newest = latest lastModified, then rid) from a Share
 * list, in a stable pseudo-random order — so `--limit N` is a spread sample, not "all the A's".
 */
function newestPerFixture(list) {
	const best = new Map()
	for (const e of list || []) {
		if (!e || !Number.isFinite(Number(e.rid)) || !e.fixture) continue
		const key = lib.keyOf(e.manufacturer, e.fixture)
		const cur = best.get(key)
		if (!cur || Number(e.lastModified) > Number(cur.lastModified) || (Number(e.lastModified) === Number(cur.lastModified) && e.rid > cur.rid)) best.set(key, e)
	}
	const h = (e) => crypto.createHash('sha1').update(`${e.rid}`).digest('hex')
	return [...best.entries()].map(([key, e]) => ({ key, ...e })).sort((a, b) => h(a).localeCompare(h(b)))
}

/** description.xml + the best thumbnail PNG of a .gdtf buffer. @returns {Promise<{ xml: Buffer, png: Buffer | null }>} */
async function extractParts(buf) {
	const zip = await unzipper.Open.buffer(buf)
	const find = (re) => zip.files.find((f) => f.type === 'File' && re.test(f.path))
	const desc = find(/^description\.xml$/i)
	if (!desc) throw new Error('no description.xml in the archive')
	const xml = await desc.buffer()
	const named = /<FixtureType\b[^>]*\sThumbnail="([^"]+)"/.exec(xml.subarray(0, 8192).toString('utf8'))?.[1]
	let t = named ? find(new RegExp(`^${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.png$`, 'i')) : null
	t = t || find(/^[^/]*thumbnail[^/]*\.png$/i) || find(/^[^/]*\.png$/i) // SVG-only thumbnails are left out
	return { xml, png: t ? await t.buffer() : null }
}

/** PNG → WebP, longest side ≤ THUMB_PX (never enlarged), via ffmpeg. Rejects when ffmpeg fails (caller drops the thumb). */
function encodeThumb(png) {
	return new Promise((resolve, reject) => {
		const vf = `scale='if(gt(iw,ih),min(${THUMB_PX},iw),-1)':'if(gt(iw,ih),-1,min(${THUMB_PX},ih))'`
		const p = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '55',
			'-compression_level', '6', '-f', 'webp', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
		const out = []
		let err = ''
		p.stdout.on('data', (d) => out.push(d))
		p.stderr.on('data', (d) => (err += d))
		p.on('error', reject)
		p.stdin.on('error', () => {}) // ffmpeg may exit before reading it all; the exit code says why
		p.on('close', (code) => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg thumbnail: ${err.trim().slice(0, 200) || code}`))))
		p.stdin.end(png)
	})
}

const atomic = (file, data) => {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(`${file}.tmp`, data)
	fs.renameSync(`${file}.tmp`, file)
}

/** Index entry from a Share list row (+ sizes once written). */
const entryOf = (e, xml, thumb) => ({ key: e.key || lib.keyOf(e.manufacturer, e.fixture), rid: Number(e.rid), uuid: e.uuid || '',
	manufacturer: String(e.manufacturer || ''), fixture: String(e.fixture), revision: e.revision || '', uploader: e.uploader || '',
	lastModified: Number(e.lastModified) || 0, filesize: Number(e.filesize) || 0,
	modes: (Array.isArray(e.modes) ? e.modes : []).map((m) => ({ name: String(m.name), footprint: Number(m.dmxfootprint ?? m.footprint) || 0 })),
	xml, thumb })

/** Download one fixture, write its XML + thumbnail. @returns {Promise<object>} the index entry */
async function ingest(f, e, deps = {}) {
	const buf = await (deps.download || share.download)(f, e.rid)
	const { xml, png } = await extractParts(buf)
	const x = zlib.brotliCompressSync(xml, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
	let t = null
	if (png) t = await (deps.encode || encodeThumb)(png).catch(() => null)
	atomic(lib.xmlFile(e.rid), x)
	if (t) atomic(lib.thumbFile(e.rid), t)
	return { entry: entryOf(e, x.length, t ? t.length : 0), downloaded: buf.length }
}

/**
 * Build / resume the library. deps: { fetch, now, limit, delayMs, retryUnit, download, encode, log }.
 * `job` (gdtf-share-job.js) carries progress and is cancellable; returns it.
 */
async function build(job, deps = {}) {
	const f = deps.fetch || fetch
	const { list: all } = await share.list(f, deps.now)
	let targets = newestPerFixture(all)
	if (deps.limit > 0) targets = targets.slice(0, deps.limit)
	job.total = targets.length
	const have = new Map(lib.index().entries.map((e) => [e.key, e]))
	const keep = new Map(have)
	const dropped = []
	let sinceSave = 0
	const save = (final = false) => lib.writeIndex([...keep.values()], final || !lib.index().builtAt ? undefined : lib.index().builtAt)
	const step = async (t) => {
		const cur = have.get(t.key)
		if (cur && cur.rid === t.rid && fs.existsSync(lib.xmlFile(t.rid))) return 'skip'
		const { entry, downloaded } = await ingest(f, t, deps)
		if (cur && cur.rid !== t.rid) dropped.push(cur.rid) // a newer revision replaced it
		keep.set(t.key, entry)
		if (++sinceSave >= SAVE_EVERY) {
			sinceSave = 0
			save()
		}
		return downloaded
	}
	await run(job, targets, step, { delayMs: deps.delayMs ?? 300, retryUnit: deps.retryUnit, label: (t) => `${t.manufacturer} ${t.fixture}` })
	save(job.state === 'done')
	for (const rid of dropped) for (const p of [lib.xmlFile(rid), lib.thumbFile(rid)]) fs.rmSync(p, { force: true })
	return job
}

module.exports = { build, newestPerFixture, extractParts, encodeThumb, ingest, THUMB_PX }
