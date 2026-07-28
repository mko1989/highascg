/**
 * WO-266 — Shader FX library: validation + on-disk CRUD.
 *
 * Shaders are Shadertoy-style paste-code configs stored as `data/shaders/<id>.json`. Every save
 * also exports a self-contained Caspar HTML template `template/shaders/<id>.html` (built by
 * `shader-template-export.js`), so shaders appear in Caspar TLS and play through every existing
 * template path (looks drag-drop, CG ADD) — no new play plumbing. Delete removes both files.
 *
 * Config shape (see WO-266 T266.1):
 *   { id: 'sh-<slug>', name, common,
 *     passes: { image: { source, channels: [ch,ch,ch,ch] }, bufferA..bufferD: same | null },
 *     audio: { enabled }, opts: { alpha } }
 * where each channels[i] maps iChannel<i> to 'A'|'B'|'C'|'D'|'audio'|null.
 */

'use strict'

const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { atomicWriteFile } = require('../utils/atomic-file-write')
const { buildShaderTemplateHtml } = require('./shader-template-export')

const SHADERS_DATA_DIR = path.join(REPO_ROOT, 'data', 'shaders')
const SHADERS_TEMPLATE_DIR = path.join(REPO_ROOT, 'template', 'shaders')

const PASS_KEYS = ['image', 'bufferA', 'bufferB', 'bufferC', 'bufferD']
const CHANNEL_VALUES = ['A', 'B', 'C', 'D', 'audio']
const MAX_SOURCE_LEN = 256 * 1024

/** @param {string} name */
function slugFromName(name) {
	const slug = String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
	return slug || 'shader'
}

/** @param {string} id */
function isValidShaderId(id) {
	return /^sh-[a-z0-9][a-z0-9-]{0,62}$/.test(String(id || ''))
}

/**
 * Normalize + validate a shader config payload. Throws Error with a user-readable message.
 * @param {any} input
 * @returns {{ id: string, name: string, common: string, passes: Record<string, {source: string, channels: Array<string|null>}|null>, audio: { enabled: boolean }, opts: { alpha: boolean } }}
 */
function normalizeShaderConfig(input) {
	const payload = input && typeof input === 'object' ? input : {}
	const name = String(payload.name || '').trim()
	if (!name) throw new Error('name is required')
	const id = payload.id ? String(payload.id).trim() : `sh-${slugFromName(name)}`
	if (!isValidShaderId(id)) throw new Error(`invalid shader id "${id}" (expected sh-<slug>)`)

	const common = String(payload.common || '')
	if (common.length > MAX_SOURCE_LEN) throw new Error('common source too large')

	/** @type {Record<string, {source: string, channels: Array<string|null>}|null>} */
	const passes = {}
	const rawPasses = payload.passes && typeof payload.passes === 'object' ? payload.passes : {}
	for (const key of PASS_KEYS) {
		const p = rawPasses[key]
		if (!p || typeof p !== 'object' || !String(p.source || '').trim()) {
			passes[key] = null
			continue
		}
		const source = String(p.source)
		if (source.length > MAX_SOURCE_LEN) throw new Error(`${key} source too large`)
		const rawCh = Array.isArray(p.channels) ? p.channels : []
		const channels = []
		for (let i = 0; i < 4; i++) {
			const c = rawCh[i]
			channels.push(CHANNEL_VALUES.includes(c) ? c : null)
		}
		passes[key] = { source, channels }
	}
	if (!passes.image) throw new Error('image pass source is required')

	/* todos27.07.26: operator-given display names for Shader Live parameters ("decode what each
	 * parameter does"). Keyed by the editor's stable param key; bounded so a hostile payload
	 * cannot bloat the config file. */
	const rawLabels = payload.paramLabels && typeof payload.paramLabels === 'object' ? payload.paramLabels : {}
	/** @type {Record<string, string>} */
	const paramLabels = {}
	for (const [k, v] of Object.entries(rawLabels)) {
		const key = String(k).trim().slice(0, 140)
		const val = String(v).trim().slice(0, 60)
		if (!key || !val) continue
		paramLabels[key] = val
		if (Object.keys(paramLabels).length >= 96) break
	}

	/* todos27.07.26: child shaders — every Shader Live save is a NEW config pointing at the
	 * shader it was derived from. One level: children attach to the root parent. */
	const parentId = payload.parentId && isValidShaderId(String(payload.parentId)) && String(payload.parentId) !== id
		? String(payload.parentId)
		: null

	return {
		id,
		name,
		common,
		passes,
		audio: { enabled: payload.audio?.enabled !== false },
		opts: { alpha: payload.opts?.alpha === true },
		...(Object.keys(paramLabels).length ? { paramLabels } : {}),
		...(parentId ? { parentId } : {}),
	}
}

/** @param {string} id */
function dataPath(id) {
	return path.join(SHADERS_DATA_DIR, `${id}.json`)
}

/** @param {string} id */
function templatePath(id) {
	return path.join(SHADERS_TEMPLATE_DIR, `${id}.html`)
}

/** @returns {Promise<Array<{ id: string, name: string, audio: boolean, alpha: boolean, casparPath: string, updatedAt: string|null }>>} */
async function listShaders() {
	let names
	try {
		names = await fsp.readdir(SHADERS_DATA_DIR)
	} catch {
		return []
	}
	const out = []
	for (const f of names.filter((n) => n.endsWith('.json')).sort()) {
		try {
			const raw = JSON.parse(await fsp.readFile(path.join(SHADERS_DATA_DIR, f), 'utf8'))
			const st = await fsp.stat(path.join(SHADERS_DATA_DIR, f))
			out.push({
				id: raw.id,
				name: raw.name,
				audio: !!raw.audio?.enabled,
				alpha: !!raw.opts?.alpha,
				casparPath: `shaders/${raw.id}`,
				updatedAt: st.mtime ? st.mtime.toISOString() : null,
			})
		} catch {
			/* skip unreadable entries — surfaced by the missing row, not a 500 */
		}
	}
	return out
}

/**
 * @param {string} id
 * @returns {Promise<any|null>}
 */
async function getShader(id) {
	if (!isValidShaderId(id)) return null
	try {
		return JSON.parse(await fsp.readFile(dataPath(id), 'utf8'))
	} catch {
		return null
	}
}

/**
 * Normalize, persist and export. Returns the saved config + Caspar path.
 * @param {any} input
 */
async function saveShader(input) {
	const config = normalizeShaderConfig(input)
	if (!fs.existsSync(SHADERS_DATA_DIR)) await fsp.mkdir(SHADERS_DATA_DIR, { recursive: true })
	if (!fs.existsSync(SHADERS_TEMPLATE_DIR)) await fsp.mkdir(SHADERS_TEMPLATE_DIR, { recursive: true })
	await atomicWriteFile(dataPath(config.id), JSON.stringify(config, null, '\t') + '\n')
	await atomicWriteFile(templatePath(config.id), buildShaderTemplateHtml(config))
	return { config, casparPath: `shaders/${config.id}` }
}

/**
 * @param {string} id
 * @returns {Promise<boolean>} true when the shader existed
 */
async function deleteShader(id) {
	if (!isValidShaderId(id)) return false
	let existed = false
	for (const p of [dataPath(id), templatePath(id)]) {
		try {
			await fsp.unlink(p)
			existed = true
		} catch {
			/* already gone */
		}
	}
	return existed
}

module.exports = {
	SHADERS_DATA_DIR,
	SHADERS_TEMPLATE_DIR,
	PASS_KEYS,
	CHANNEL_VALUES,
	isValidShaderId,
	slugFromName,
	normalizeShaderConfig,
	listShaders,
	getShader,
	saveShader,
	deleteShader,
}
