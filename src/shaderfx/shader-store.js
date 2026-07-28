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

	/* todos28.07.26 (owner): "when audio reactive is ticked on a shader audio must be chosen in
	 * image iCh0". Ticking the box only set `audio.enabled`; the audio TEXTURE is created by
	 * player.js's `usesAudioChannel()`, which asks whether any pass actually binds 'audio' to a
	 * channel. Tick the box, forget the select, and the shader is silently not reactive at all —
	 * while the library still shows it a ♪ badge. Measured on this box: sh-balatro, sh-console,
	 * sh-test and sh-wavy were all in that state.
	 *
	 * So the flag now MEANS something: if audio is on and nothing binds it, bind it — first free
	 * image channel, iChannel0 first. Deliberately never displaces an existing binding (a buffer
	 * wired to iChannel0 stays), and when every image channel is occupied the config is left
	 * untouched rather than silently rewired. */
	const audioEnabled = payload.audio?.enabled !== false
	if (audioEnabled) {
		const boundSomewhere = Object.values(passes).some((p) => p && p.channels.includes('audio'))
		if (!boundSomewhere) {
			const free = passes.image.channels.findIndex((c) => c == null)
			if (free >= 0) passes.image.channels[free] = 'audio'
		}
	}

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
	const parentId =
		payload.parentId && isValidShaderId(String(payload.parentId)) && String(payload.parentId) !== id
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

/**
 * WO-379 — reconcile the shader store's two halves.
 *
 * A shader lives in TWO files: `data/shaders/<id>.json` (the config, what the library lists) and
 * `template/shaders/<id>.html` (the exported Caspar template, what actually plays). `saveShader`
 * writes both and `deleteShader` unlinks both — but anything that touches only one side (a git
 * checkout, a Syncthing revert, a half-finished copy) leaves an orphan, and each direction fails
 * differently and silently:
 *
 *   JSON without HTML  → the shader IS in the library, and playing/previewing it 404s.
 *   HTML without JSON  → Caspar's template catalog lists it, and `/api/shaders/<id>` 404s.
 *                        (Owner, todos28.07.26: "sh-mirrors shader fails to load with 404.")
 *
 * Measured on this box 28.07: 7 of the first kind, 2 of the second. WO-368's git/Syncthing
 * ownership question is the root cause; this is the repair that stops the symptom regardless of
 * which way the owner settles that.
 *
 * Both directions are recovered, never deleted — this library is single-copy right now (WO-368),
 * so the only safe move is to rebuild the missing half:
 *   - missing HTML → re-export it from the JSON (the exporter is pure and deterministic);
 *   - missing JSON → recover it from the config the exporter EMBEDS in the HTML
 *                    (`window.__SHADERFX_CONFIG__`), then normalise and write it.
 *
 * @returns {Promise<{ exported: string[], recovered: string[] }>}
 */
async function reconcileShaderStore() {
	const exported = []
	const recovered = []
	const listDir = async (dir, suffix) => {
		try {
			return (await fsp.readdir(dir)).filter((n) => n.endsWith(suffix))
		} catch {
			return []
		}
	}

	const dataIds = (await listDir(SHADERS_DATA_DIR, '.json')).map((n) => n.slice(0, -5))
	const tplIds = (await listDir(SHADERS_TEMPLATE_DIR, '.html')).map((n) => n.slice(0, -5))
	const tplSet = new Set(tplIds)
	const dataSet = new Set(dataIds)

	for (const id of dataIds) {
		if (!isValidShaderId(id) || tplSet.has(id)) continue
		try {
			const raw = JSON.parse(await fsp.readFile(dataPath(id), 'utf8'))
			await atomicWriteFile(templatePath(id), buildShaderTemplateHtml(normalizeShaderConfig(raw)))
			exported.push(id)
		} catch {
			/* unreadable/invalid config — leave it alone rather than write a broken template */
		}
	}

	for (const id of tplIds) {
		if (!isValidShaderId(id) || dataSet.has(id)) continue
		try {
			const html = await fsp.readFile(templatePath(id), 'utf8')
			const m = /window\.__SHADERFX_CONFIG__ = (\{[\s\S]*?\})<\/script>/.exec(html)
			if (!m) continue
			// The exporter escapes `</` as `<\/` so shader source can never close the script tag.
			const cfg = JSON.parse(m[1].replace(/<\\\//g, '</'))
			await atomicWriteFile(dataPath(id), JSON.stringify(normalizeShaderConfig(cfg), null, '\t') + '\n')
			recovered.push(id)
		} catch {
			/* not a recoverable template — a 404 is better than a fabricated config */
		}
	}

	return { exported, recovered }
}

/** @returns {Promise<Array<{ id: string, name: string, audio: boolean, alpha: boolean, casparPath: string, updatedAt: string|null }>>} */
async function listShaders() {
	// WO-379: the library read is where a divergence becomes visible, so heal it here.
	try {
		await reconcileShaderStore()
	} catch {
		/* reconciliation is best-effort — never fail the list because of it */
	}
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
	reconcileShaderStore,
	listShaders,
	getShader,
	saveShader,
	deleteShader,
}
