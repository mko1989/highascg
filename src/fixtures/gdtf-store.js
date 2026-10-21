'use strict'

/**
 * WO-615 T2 — imported GDTF fixture types: projects/_gdtf/<id>.gdtf + <id>.json (id = content hash, so a re-import is
 * the same type). The JSON is the full gdtf-parse.js result — a pixel tube with 165 modes is several MB — so callers
 * get a summary or one mode at a time; the DMX engine reads `type(id)` (parsed once, cached).
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const unzipper = require('unzipper')
const { projectsRoot } = require('../engine/projects-root')
const { parseGdtf } = require('./gdtf-parse')

const ID = /^[0-9a-f]{12}$/
const _types = new Map() // id → parsed record (the engine's working set)

function dir() {
	return path.join(projectsRoot(), '_gdtf')
}

function fileOf(id, ext) {
	if (!ID.test(String(id))) return null
	return path.join(dir(), `${id}${ext}`)
}

/** Offsets two channels of one mode both claim (a fault in the file, e.g. Elation Pulse Panel 60CH offset 12). */
function modeWarnings(mode) {
	const seen = new Map()
	const clash = new Set()
	for (const c of mode.channels) for (const o of c.offsets) seen.has(o) ? clash.add(o) : seen.set(o, c)
	return clash.size ? [`channels share offset ${[...clash].sort((a, b) => a - b).join(', ')} (as written in the file)`] : []
}

function summary(rec) {
	const t = rec.type
	return {
		id: rec.id, name: t.name, shortName: t.shortName, manufacturer: t.manufacturer, fixtureTypeId: t.fixtureTypeId,
		file: rec.file, importedAt: rec.importedAt, bytes: rec.bytes,
		modes: t.modes.map((m) => ({ name: m.name, footprint: m.footprint, channels: m.channels.length, breaks: m.breaks,
			warnings: modeWarnings(m) })),
	}
}

/** @returns {Promise<object>} the summary */
async function importGdtf(buf, name) {
	const type = await parseGdtf(buf)
	const id = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
	fs.mkdirSync(dir(), { recursive: true })
	fs.writeFileSync(fileOf(id, '.gdtf'), buf)
	const rec = { id, file: String(name || `${type.manufacturer}@${type.name}.gdtf`).slice(0, 160),
		importedAt: new Date().toISOString(), bytes: buf.length, type }
	fs.writeFileSync(fileOf(id, '.json'), JSON.stringify(rec))
	_types.set(id, rec)
	return summary(rec)
}

/** The full stored record (parsed type included), or null. */
function record(id) {
	if (_types.has(id)) return _types.get(id)
	const f = fileOf(id, '.json')
	if (!f || !fs.existsSync(f)) return null
	const rec = JSON.parse(fs.readFileSync(f, 'utf8'))
	_types.set(id, rec)
	return rec
}

function list() {
	if (!fs.existsSync(dir())) return []
	return fs.readdirSync(dir()).filter((f) => /^[0-9a-f]{12}\.json$/.test(f)).map((f) => {
		try {
			return summary(record(f.slice(0, 12)))
		} catch {
			return null
		}
	}).filter(Boolean).sort((a, b) => `${a.manufacturer} ${a.name}`.localeCompare(`${b.manufacturer} ${b.name}`))
}

/** Summary + what the previs draws (geometry tree, models, wheels, attribute names) — no channel lists. */
function describe(id) {
	const rec = record(id)
	if (!rec) return null
	const { geometry, models, wheels, attributes, files, dataVersion } = rec.type
	return { ...summary(rec), dataVersion, geometry, models, wheels, attributes, files }
}

/** One DMX mode with its channels, or null. */
function mode(id, name) {
	const rec = record(id)
	const m = rec?.type.modes.find((x) => x.name === name) || null
	return m ? { ...m, warnings: modeWarnings(m) } : null
}

/** A member of the stored archive (wheel image, model) as bytes, or null. */
async function member(id, file) {
	const f = fileOf(id, '.gdtf')
	if (!f || !fs.existsSync(f) || !file) return null
	const zip = await unzipper.Open.file(f)
	const hit = zip.files.find((m) => m.path === file || m.path.toLowerCase() === String(file).toLowerCase())
	return hit ? hit.buffer() : null
}

function remove(id) {
	const files = [fileOf(id, '.json'), fileOf(id, '.gdtf')].filter((f) => f && fs.existsSync(f))
	for (const f of files) fs.unlinkSync(f)
	_types.delete(id)
	return files.length > 0
}

module.exports = { importGdtf, record, list, describe, mode, member, remove, modeWarnings }
