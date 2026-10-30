'use strict'

/**
 * WO-825 — the GDTF Share library on this box: every fixture's description XML (newest revision) plus a small
 * re-encoded thumbnail, so any fixture patches / outputs DMX / shows in the programmer offline. Built BY THE BOX from
 * its own GDTF Share account (gdtf-library-build.js) — never shipped in the ISO or git (Share terms §9: no copying /
 * redistribution / commercial use of the content without a licence; see work-orders/825).
 *
 *   ~/.highascg/cache/gdtf-library/            (cache/ is excluded from eggs ISOs and outside the synced repo)
 *     index.json        { version, builtAt, entries: [entry] }
 *     x/<rid>.xml.br    description.xml, brotli
 *     t/<rid>.webp      thumbnail, 128 px max, WebP
 *     full/<rid>.gdtf   the opt-in "full model library" (gdtf-share-full.js)
 *     pending.json      type ids whose full file could not be fetched yet (offline) — retried
 *
 * entry = { key, rid, uuid, manufacturer, fixture, revision, uploader, lastModified, filesize, modes: [{ name,
 *   footprint }], xml: bytes, thumb: bytes (0 = none) }. `key` = "maker|fixture" lower-cased: one entry per fixture.
 * Using a library fixture in a project (useType) imports the XML as a description-only type under a STABLE id
 * (typeIdFor: a hash of the key), later upgraded in place to the full .gdtf — the patch keeps pointing at it.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const JSZip = require('jszip')
const share = require('./gdtf-share')
const store = require('./gdtf-store')

const dir = () => path.join(share.home(), 'cache', 'gdtf-library')
const indexFile = () => path.join(dir(), 'index.json')
const xmlFile = (rid) => path.join(dir(), 'x', `${Number(rid)}.xml.br`)
const thumbFile = (rid) => path.join(dir(), 't', `${Number(rid)}.webp`)
const fullFile = (rid) => path.join(dir(), 'full', `${Number(rid)}.gdtf`)

const keyOf = (maker, fixture) => `${String(maker || '').trim().toLowerCase()}|${String(fixture || '').trim().toLowerCase()}`

/** The stable type-store id of a library fixture (same across revisions: the key, not the rid). */
function typeIdFor(entryOrKey) {
	const key = typeof entryOrKey === 'string' ? entryOrKey : entryOrKey.key
	return crypto.createHash('sha1').update(`gdtf-share|${key}`).digest('hex').slice(0, 12)
}

let _idx = null // { mtimeMs, entries, byRid, byType }

function writeIndex(entries, builtAt = new Date().toISOString()) {
	fs.mkdirSync(dir(), { recursive: true })
	const tmp = `${indexFile()}.tmp`
	fs.writeFileSync(tmp, JSON.stringify({ version: 1, builtAt, entries }))
	fs.renameSync(tmp, indexFile())
	_idx = null
}

/** The index (re-read when the file changed), or { builtAt: null, entries: [] } before the first build. */
function index() {
	try {
		const st = fs.statSync(indexFile())
		if (_idx && _idx.mtimeMs === st.mtimeMs) return _idx
		const j = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
		const entries = Array.isArray(j?.entries) ? j.entries : []
		_idx = { mtimeMs: st.mtimeMs, builtAt: j?.builtAt || null, entries, byRid: new Map(entries.map((e) => [e.rid, e])),
			byType: new Map(entries.map((e) => [typeIdFor(e), e])) }
		return _idx
	} catch {
		return { builtAt: null, entries: [], byRid: new Map(), byType: new Map() }
	}
}

const byRid = (rid) => index().byRid.get(Number(rid)) || null
const byTypeId = (id) => index().byType.get(String(id)) || null

/** Words of the query must all be in "maker fixture revision", case-insensitive. @returns {object[]} */
function search(q, limit = 50) {
	const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean)
	const out = []
	for (const e of index().entries) {
		const hay = `${e.manufacturer} ${e.fixture} ${e.revision || ''}`.toLowerCase()
		if (words.every((w) => hay.includes(w))) out.push(e)
	}
	out.sort((a, b) => `${a.manufacturer} ${a.fixture}`.localeCompare(`${b.manufacturer} ${b.fixture}`))
	return out.slice(0, Math.max(1, Math.min(500, Number(limit) || 50)))
}

/** description.xml of a library fixture, or null. */
function xml(rid) {
	try {
		return zlib.brotliDecompressSync(fs.readFileSync(xmlFile(rid)))
	} catch {
		return null
	}
}

/** The thumbnail's bytes (WebP), or null. */
function thumb(rid) {
	try {
		return fs.readFileSync(thumbFile(rid))
	} catch {
		return null
	}
}

/** 'none' | 'stub' (description only) | 'full' — how far this library fixture is in the type store. */
function installed(entry) {
	const rec = store.record(typeIdFor(entry))
	return !rec ? 'none' : rec.share?.full ? 'full' : 'stub'
}

/**
 * Put a library fixture into the type store as a description-only .gdtf (no models: the previs draws the generic
 * body) under its stable id. Already stored (stub or full) → left as is. null when the XML is not in the library.
 * @returns {Promise<object | null>} the type summary
 */
async function useType(entry) {
	const id = typeIdFor(entry)
	const have = store.info(id)
	if (have) return have
	const xmlBuf = xml(entry.rid)
	if (!xmlBuf) return null
	const buf = await new JSZip().file('description.xml', xmlBuf).generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
	return store.importGdtf(buf, `${entry.manufacturer}@${entry.fixture}@rid${entry.rid}.stub.gdtf`, { id, share: { rid: entry.rid, full: false } })
}

/** Space the library takes: { files, bytes } by walking its directory. */
function usage() {
	let files = 0
	let bytes = 0
	const walk = (d) => {
		for (const f of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
			const p = path.join(d, f.name)
			if (f.isDirectory()) walk(p)
			else {
				files++
				bytes += fs.statSync(p).size
			}
		}
	}
	walk(dir())
	return { files, bytes }
}

module.exports = { dir, indexFile, xmlFile, thumbFile, fullFile, keyOf, typeIdFor, index, writeIndex, byRid, byTypeId, search,
	xml, thumb, installed, useType, usage }
