/**
 * Gather ▸ Copy: copy a clip next to the project without ever showing a half file. Streams to a temp name in the
 * destination folder, fsyncs, renames; any failure removes the temp. Plain byte copy — no ownership/mode
 * preservation, so exFAT targets work (chown there is EPERM).
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { pipeline } = require('stream/promises')

/** Files that travel with a clip (same folder). Thumbnails / waveforms are caches keyed by id and regenerate. */
const SIDECAR_EXTS = ['.meta', '.json', '.srt', '.vtt', '.thumb', '.waveform']

/** Bytes free on the volume holding `dir` (nearest existing parent). */
async function freeBytes(dir) {
	let d = path.resolve(dir)
	while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d)
	const s = await fs.promises.statfs(d)
	return Number(s.bavail) * Number(s.bsize)
}

/** Existing sidecar paths of `src` (`clip.mov.meta`, `clip.meta`, …). */
function sidecarsOf(src) {
	const dir = path.dirname(src)
	const base = path.basename(src)
	const stem = base.slice(0, base.length - path.extname(base).length)
	const out = []
	for (const ext of SIDECAR_EXTS) {
		for (const name of new Set([base + ext, stem + ext])) {
			const p = path.join(dir, name)
			if (p !== src && fs.existsSync(p) && fs.statSync(p).isFile()) out.push(p)
		}
	}
	return out
}

/** True when `dir` already holds `name`, compared case-insensitively (Caspar ids are). */
function existsCaseInsensitive(dir, name) {
	const want = name.normalize('NFC').toLowerCase()
	try {
		return fs.readdirSync(dir).some((n) => n.normalize('NFC').toLowerCase() === want)
	} catch {
		return false
	}
}

let tmpSeq = 0

/** Copy one file to `dest` atomically. Throws on failure; the temp is gone either way. */
async function copyFileAtomic(src, dest) {
	const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.${++tmpSeq}.part`)
	try {
		await pipeline(fs.createReadStream(src), fs.createWriteStream(tmp, { flags: 'wx' }))
		const fh = await fs.promises.open(tmp, 'r+')
		try {
			await fh.sync() // on disk before the rename makes it visible
		} finally {
			await fh.close()
		}
		await fs.promises.rename(tmp, dest)
	} catch (e) {
		await fs.promises.unlink(tmp).catch(() => {})
		throw e
	}
}

const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`)

module.exports = { freeBytes, sidecarsOf, existsCaseInsensitive, copyFileAtomic, fmtBytes }
