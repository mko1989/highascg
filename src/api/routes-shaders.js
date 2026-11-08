/**
 * WO-266 — Shader FX library routes.
 *   GET    /api/shaders          → { shaders: [meta], gpu: { running, setting } } (WO-661: Caspar HTML GPU)
 *   GET    /api/shaders/:id      → full config
 *   POST   /api/shaders          → create/update (normalizes, persists, exports Caspar template)
 *   DELETE /api/shaders/:id      → remove config + exported template
 *   POST   /api/shaders/import   → WO-380: paste a Shadertoy share link, get the code layers back
 *                                   WO-999: a FragCoord link is license-gated, converted and SAVED (native dialect)
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const store = require('../shaderfx/shader-store')
const { htmlGpuState } = require('../shaderfx/caspar-html-gpu')
const { liveShaderInstances } = require('../shaderfx/shader-live-instances')
const { pushPayload } = require('../shaderfx/shader-live-session')
const { shadertoyIdFromInput, shadertoyConfigFromApiJson, fetchShadertoyShader } = require('../shaderfx/shadertoy-import')
const { isFragcoordInput, importFragcoordShader } = require('../shaderfx/fragcoord-import')

/**
 * @param {string} p
 * @param {any} [ctx]
 */
async function handleGet(p, ctx) {
	if (p === '/api/shaders') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ shaders: await store.listShaders(), gpu: htmlGpuState(ctx) }) }
	}
	const m = p.match(/^\/api\/shaders\/([^/]+)$/)
	if (!m) return null
	const config = await store.getShader(decodeURIComponent(m[1]))
	if (!config) return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Shader not found' }) }
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(config) }
}

/**
 * @param {string} p
 * @param {string} body
 * @param {{ log?: Function }} [ctx]
 */
async function handlePost(p, body, ctx) {
	/* WO-380 — import from a Shadertoy share link. Returns the CONFIG only; the operator reviews it
	 * in the modal and presses save, so a paste can never silently overwrite a shader. */
	if (p === '/api/shaders/import') {
		try {
			const b = parseBody(body) || {}
			if (isFragcoordInput(b.url || b.link)) return await importFragcoord(b, ctx)
			const id = shadertoyIdFromInput(b.url || b.link || b.id)
			if (!id) return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'not a Shadertoy share link or id' }) }
			const key = String(ctx?.config?.shadertoyApiKey || process.env.SHADERTOY_API_KEY || '')
			const json = await fetchShadertoyShader(id, key)
			const config = shadertoyConfigFromApiJson(json)
			if (ctx && typeof ctx.log === 'function') {
				ctx.log('info', `[shaderfx] imported shadertoy ${id} ("${config.name}")`)
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, config }) }
		} catch (e) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: String(e?.message || e) }) }
		}
	}
	if (p !== '/api/shaders') return null
	try {
		const { config, casparPath } = await store.saveShader(parseBody(body))
		if (ctx && typeof ctx.log === 'function') ctx.log('info', `[shaderfx] saved "${config.id}" → template ${casparPath}`)
		const live = await pushBeatKnobs(ctx, config)
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, id: config.id, casparPath, ...(live ? { live } : {}) }) }
	} catch (e) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: String(e?.message || e) }) }
	}
}

/**
 * WO-999 — a FragCoord link: fetched, license-gated (none → refused, NC → only with `allowNonCommercial`), golf passes
 * converted, then saved straight away. Unlike a Shadertoy import there is nothing to review in the web modal (it edits
 * Shadertoy passes only); the Visuals run the shader in its own dialect. A re-import of the same link overwrites it.
 */
async function importFragcoord(b, ctx) {
	try {
		const { skipped, licenseKind, shareAlike, ...config } = await importFragcoordShader(b.url || b.link, {
			allowNonCommercial: b.allowNonCommercial === true,
		})
		const saved = await store.saveShader(config)
		const warnings = [
			...(skipped.length ? [`passes beyond 8 not imported: ${skipped.join(', ')}`] : []),
			...(licenseKind === 'nc' ? [`${config.source.license}: non-commercial use only`] : []),
			...(shareAlike ? [`${config.source.license}: share-alike — derivatives keep this license`] : []),
		]
		if (ctx && typeof ctx.log === 'function') {
			ctx.log('info', `[shaderfx] imported fragcoord ${config.source.slug} ("${config.name}", ${config.source.license}) → ${saved.config.id}`)
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, saved: saved.config.id, config: saved.config, warnings }) }
	} catch (e) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: String(e?.message || e) }) }
	}
}

/**
 * WO-662 — the beat knobs are uniforms, so a save reaches every instance already on air (CG UPDATE `{ beat }`,
 * no recompile, no reload). Source edits still need a re-take or Shader Live, as before.
 * @returns {Promise<{ targets: number, errors: string[] } | null>}
 */
async function pushBeatKnobs(ctx, config) {
	if (!ctx?.amcp || !config.audio?.enabled) return null
	try {
		const targets = liveShaderInstances(ctx).filter((i) => i.shaderId === config.id)
		if (!targets.length) return null
		const beat = config.audio.beat || { flash: 0, bump: 0, kick: 0 }
		return { targets: targets.length, errors: await pushPayload(ctx, targets, { beat }) }
	} catch (e) {
		// The save itself succeeded — a failed live push must not turn it into a 400.
		return { targets: 0, errors: [String(e?.message || e)] }
	}
}

/**
 * @param {string} p
 */
async function handleDelete(p) {
	const m = p.match(/^\/api\/shaders\/([^/]+)$/)
	if (!m) return null
	const existed = await store.deleteShader(decodeURIComponent(m[1]))
	if (!existed) return { status: 404, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'Shader not found' }) }
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
}

module.exports = { handleGet, handlePost, handleDelete }
