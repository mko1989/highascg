/**
 * WO-608 — GET /api/project/missing-assets: the open project's clip / template references that this server does not
 * have (web lib/project-media-reconcile.js client fallback, moved to the node — directive D). The references come
 * from the web's pure client/lib/project-media-refs.js; the catalogs are the ones /api/media and /api/templates serve.
 * Matching ignores case and the file extension (Caspar CLS / TLS ids are upper-case and extension-less; the web
 * compare did neither).
 *   → { isClean, missingMedia, missingTemplates, usedMedia, usedTemplates }
 */
'use strict'

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody } = require('./response')

const REFS_LIB = pathToFileURL(path.join(__dirname, '../../client/lib/project-media-refs.js')).href
let _refs = null
const refsLib = () => (_refs ||= import(REFS_LIB))

const norm = (s) =>
	String(s || '')
		.trim()
		.replace(/\\/g, '/')
		.toLowerCase()

/** Catalog ids with and without their extension (Caspar CLS ids carry none). */
function mediaIndex(list) {
	const out = new Set()
	const add = (v) => {
		const n = norm(v)
		if (!n) return
		out.add(n)
		const dot = n.lastIndexOf('.')
		if (dot > n.lastIndexOf('/') + 1) out.add(n.slice(0, dot))
	}
	for (const item of Array.isArray(list) ? list : []) {
		if (item == null) continue
		if (typeof item === 'string') add(item)
		else if (typeof item === 'object' && !item.isDir)
			for (const k of ['id', 'path', 'value', 'clip']) if (item[k]) add(item[k])
	}
	return out
}

function templateIndex(list) {
	const out = new Set()
	for (const item of Array.isArray(list) ? list : []) {
		const raw = typeof item === 'string' ? item : item && (item.id ?? item.label ?? item.name)
		if (raw) out.add(norm(raw).replace(/\.html$/, ''))
	}
	return out
}

/** Web mediaExists: exact, basename, or either side a path suffix of the other. */
function mediaExists(ref, index) {
	const r = norm(ref)
	if (!r || index.has(r)) return true
	const base = r.split('/').pop()
	if (base && index.has(base)) return true
	for (const id of index) if (id.endsWith('/' + r) || r.endsWith('/' + id)) return true
	return false
}

function templateExists(ref, index) {
	const bare = norm(ref).replace(/\.html$/, '')
	if (index.has(bare)) return true
	for (const id of index) if (id.endsWith('/' + bare)) return true
	return false
}

/** @param {object|null} project @param {unknown[]} media @param {unknown[]} templates */
async function report(project, media, templates) {
	const { collectProjectAssetRefs } = await refsLib()
	const refs = collectProjectAssetRefs(project)
	const mi = mediaIndex(media)
	const ti = templateIndex(templates)
	const missingMedia = refs.media.filter((p) => !mediaExists(p, mi))
	const missingTemplates = refs.templates.filter((t) => !templateExists(t, ti))
	return {
		isClean: missingMedia.length === 0 && missingTemplates.length === 0,
		missingMedia,
		missingTemplates,
		usedMedia: refs.media,
		usedTemplates: refs.templates,
	}
}

async function handleGet(p, ctx) {
	if (p !== '/api/project/missing-assets') return null
	const project = await require('./routes-data-project-read').loadProjectMerged(ctx)
	const cat = require('./media-catalog')
	const data = await report(project, cat.getRawMediaCatalog(ctx), cat.getTemplateCatalog(ctx))
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
}

module.exports = { report, mediaExists, templateExists, handleGet }
