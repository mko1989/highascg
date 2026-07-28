'use strict'

/**
 * WO-380 — paste a Shadertoy share link, get the code layers filled in.
 *
 * Owner, todos28.07.26:
 *   "i noticed there is a share link on shader toy. it should be easy to be able to paste that
 *    link and it will fill in all the code layers. example link
 *    https://www.shadertoy.com/view/lldcR8"
 *
 * The fetch has ONE viable route — see the WO for the measurements:
 * `www.shadertoy.com` sits behind Cloudflare and answers **403 "Just a moment…"** to a plain
 * server request, to the unauthenticated `api/v1` path, and to the site's own internal
 * `POST /shadertoy` endpoint. Headless Chrome gets the same interstitial. The sanctioned route is
 * the public API with a free app key: `GET /api/v1/shaders/<id>?key=<KEY>`.
 *
 * This module is deliberately split so the part that can be proven offline is proven offline:
 *   - `shadertoyIdFromInput()` and `shadertoyConfigFromApiJson()` are pure, and fully tested;
 *   - `fetchShadertoyShader()` is the thin network edge that needs the owner's key.
 */

const SHADERTOY_ID_RE = /^[A-Za-z0-9]{6,}$/

/**
 * Accepts a share link, an embed link, or a bare id.
 *   https://www.shadertoy.com/view/lldcR8      → lldcR8
 *   https://www.shadertoy.com/embed/lldcR8?... → lldcR8
 *   lldcR8                                     → lldcR8
 * @param {unknown} raw
 * @returns {string|null}
 */
function shadertoyIdFromInput(raw) {
	const s = String(raw ?? '').trim()
	if (!s) return null
	const m = /shadertoy\.com\/(?:view|embed)\/([A-Za-z0-9]+)/i.exec(s)
	const id = m ? m[1] : s.replace(/^\/+|\/+$/g, '')
	return SHADERTOY_ID_RE.test(id) ? id : null
}

/* Shadertoy pass types → our pass keys. `sound`/`cubemap` passes have no equivalent here and are
 * dropped rather than mangled into an image pass. */
const PASS_BY_TYPE = { image: 'image', buffer: null }
const BUFFER_KEYS = ['bufferA', 'bufferB', 'bufferC', 'bufferD']

/**
 * Map a Shadertoy `api/v1/shaders/<id>` response onto a shader-store config.
 *
 * Their shape: `{ Shader: { info: { id, name, ... }, renderpass: [ { type, name, outputs, inputs,
 * code }, ... ] } }`. Buffer passes are identified by their OUTPUT id, and channel wiring lives on
 * `inputs[].channel` + `inputs[].id` (the id of the buffer's output) — so buffers are matched by
 * output id, not by name, which is free text.
 *
 * @param {any} json raw API response (or the inner `Shader` object)
 * @returns {{ id: string, name: string, common: string, passes: object, audio: { enabled: boolean },
 *            opts: { alpha: boolean }, skipped: string[] }}
 */
function shadertoyConfigFromApiJson(json) {
	const shader = json?.Shader || json
	const info = shader?.info || {}
	const renderpass = Array.isArray(shader?.renderpass) ? shader.renderpass : []
	if (!renderpass.length) throw new Error('no renderpass in the Shadertoy response')

	const skipped = []
	/** output id → our buffer key, assigned in the order the buffers appear */
	const bufferKeyByOutputId = new Map()
	let nextBuffer = 0
	for (const p of renderpass) {
		if (String(p?.type || '').toLowerCase() !== 'buffer') continue
		const outId = String(p?.outputs?.[0]?.id ?? '')
		if (!outId || bufferKeyByOutputId.has(outId)) continue
		if (nextBuffer >= BUFFER_KEYS.length) {
			skipped.push(`buffer ${p?.name || outId} (only 4 buffers supported)`)
			continue
		}
		bufferKeyByOutputId.set(outId, BUFFER_KEYS[nextBuffer++])
	}

	/** @param {any} pass */
	const channelsOf = (pass) => {
		const channels = [null, null, null, null]
		for (const input of Array.isArray(pass?.inputs) ? pass.inputs : []) {
			const idx = Number(input?.channel)
			if (!Number.isInteger(idx) || idx < 0 || idx > 3) continue
			const type = String(input?.ctype || input?.type || '').toLowerCase()
			if (type === 'music' || type === 'musicstream' || type === 'mic') {
				channels[idx] = 'audio'
				continue
			}
			if (type === 'webcam') {
				channels[idx] = 'camera'
				continue
			}
			if (type === 'buffer') {
				const key = bufferKeyByOutputId.get(String(input?.id ?? ''))
				// Our channel vocabulary names buffers 'A'..'D'.
				if (key) channels[idx] = key.replace('buffer', '')
				continue
			}
			// texture / cubemap / volume / keyboard: no equivalent — leave the channel unbound.
			if (type) skipped.push(`${pass?.name || pass?.type} iChannel${idx} (${type})`)
		}
		return channels
	}

	let common = ''
	const passes = {}
	let usesAudio = false
	for (const p of renderpass) {
		const type = String(p?.type || '').toLowerCase()
		const code = String(p?.code || '')
		if (type === 'common') {
			common = code
			continue
		}
		if (type === 'buffer') {
			const key = bufferKeyByOutputId.get(String(p?.outputs?.[0]?.id ?? ''))
			if (key) passes[key] = { source: code, channels: channelsOf(p) }
			continue
		}
		if (PASS_BY_TYPE[type] === 'image') {
			passes.image = { source: code, channels: channelsOf(p) }
			continue
		}
		skipped.push(`${type} pass (unsupported)`)
	}
	if (!passes.image) throw new Error('the Shadertoy shader has no image pass')

	for (const p of Object.values(passes)) {
		if (p && p.channels.includes('audio')) usesAudio = true
	}

	const name = String(info?.name || 'shadertoy import').trim().slice(0, 80)
	return {
		name,
		common,
		passes,
		// Only claim audio-reactive when a channel actually wants it (WO-375's rule).
		audio: { enabled: usesAudio },
		opts: { alpha: false },
		skipped,
		source: { site: 'shadertoy', id: String(info?.id || ''), username: String(info?.username || '') },
	}
}

/**
 * @param {string} id
 * @param {string} apiKey
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<any>} raw API JSON
 */
async function fetchShadertoyShader(id, apiKey, opts = {}) {
	const shaderId = shadertoyIdFromInput(id)
	if (!shaderId) throw new Error('not a Shadertoy share link or id')
	const key = String(apiKey || '').trim()
	if (!key) {
		throw new Error(
			'No Shadertoy API key configured. www.shadertoy.com is behind Cloudflare and refuses ' +
				'server-side requests without one — get a free key at shadertoy.com/howto#q2 and save it in Settings.',
		)
	}
	const doFetch = opts.fetchImpl || fetch
	const url = `https://www.shadertoy.com/api/v1/shaders/${encodeURIComponent(shaderId)}?key=${encodeURIComponent(key)}`
	const res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs || 15000) })
	if (!res.ok) throw new Error(`Shadertoy API HTTP ${res.status}`)
	const json = await res.json()
	if (json?.Error) throw new Error(`Shadertoy: ${json.Error}`)
	return json
}

module.exports = {
	shadertoyIdFromInput,
	shadertoyConfigFromApiJson,
	fetchShadertoyShader,
}
