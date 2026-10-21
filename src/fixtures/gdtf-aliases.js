'use strict'

/**
 * WO-633 — "use this GDTF instead of that one", box-level: projects/_gdtf/aliases.json
 *   { "<from id>": { to: "<id>", modes: { "<from mode>": "<to mode>" }, maker, name } }
 * Made for MVR placeholders (Capture embeds stub GDTFs: no model, DimmerN channels; other exporters "Dummy - <type>"):
 * the operator imports the real file once and every later MVR patch of that rig uses it. Looked up by the from-type's
 * id, then by its maker + name (another revision of the same placeholder). An alias whose target is gone is ignored.
 */

const fs = require('fs')
const path = require('path')
const { projectsRoot } = require('../engine/projects-root')

const ID = /^[0-9a-f]{12}$/

function file() {
	return path.join(projectsRoot(), '_gdtf', 'aliases.json')
}

function readAll() {
	try {
		const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
		return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
	} catch {
		return {}
	}
}

function writeAll(all) {
	fs.mkdirSync(path.dirname(file()), { recursive: true })
	fs.writeFileSync(file(), JSON.stringify(all, null, '\t'))
}

const key = (maker, name) => `${String(maker || '').trim().toLowerCase()}|${String(name || '').trim().toLowerCase()}`

/**
 * The alias for a stored type (its summary: id, manufacturer, name), or null.
 * @param {{ id: string, manufacturer?: string, name?: string }} from
 * @param {(id: string) => boolean} exists  whether the target type is still stored
 * @param {boolean} [byName]  also match another revision by maker + name (placeholders only: a real type of the same
 *   maker + name is a different file, not a stand-in)
 */
function aliasFor(from, exists, byName = false) {
	const all = readAll()
	let a = all[from?.id]
	if (!a && byName) a = Object.values(all).find((x) => key(x?.maker, x?.name) === key(from?.manufacturer, from?.name)) || null
	return a && ID.test(String(a.to)) && a.to !== from?.id && exists(a.to) ? { to: a.to, modes: { ...(a.modes || {}) } } : null
}

/** Store (or replace) the alias of a type. `from` = its summary (id, manufacturer, name). */
function setAlias(from, to, modes) {
	const all = readAll()
	all[from.id] = { to, modes: { ...modes }, maker: from.manufacturer || '', name: from.name || '' }
	writeAll(all)
	return all[from.id]
}

function clearAlias(id) {
	const all = readAll()
	if (!all[id]) return false
	delete all[id]
	writeAll(all)
	return true
}

/** A placeholder GDTF: "Dummy - <type>" (MVR 1.5 exporters), or nothing to draw and no Axis / Beam (Capture). */
function isPlaceholder(type) {
	if (/^\s*dummy\b/i.test(String(type?.name || ''))) return true
	const drawable = Object.values(type?.models || {}).some((m) => m?.file || (Array.isArray(m?.size) && m.size.some((v) => Number(v) > 0)))
	const walk = (list) => (Array.isArray(list) ? list : []).some((g) => g?.type !== 'Geometry' || walk(g.children))
	return !drawable && !walk(type?.geometry)
}

module.exports = { aliasFor, setAlias, clearAlias, isPlaceholder, readAll }
