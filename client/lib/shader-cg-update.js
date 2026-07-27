/**
 * shader-cg-update.js — shared CG UPDATE push for Shader Live (editor + wiggle preview).
 * AMCP quoted-string escaping: BACKSLASHES FIRST, then quotes — multi-line GLSL serializes
 * with \n escapes, and without doubling them Caspar unescapes them into real newlines inside
 * a JSON string literal = invalid JSON = silent no-op.
 */

/** @param {object} payload  @returns {string} the escaped inline-JSON argument */
export function cgUpdateJson(payload) {
	return JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Push one payload to a set of instances. Returns per-target errors (403 = not CG-hosted).
 * @param {{ post: Function }} api
 * @param {Array<{ channel: number, pLayer: number }>} targets
 * @param {object} payload
 */
export async function pushCgUpdateTo(api, targets, payload) {
	const json = cgUpdateJson(payload)
	const errors = []
	for (const t of targets) {
		try {
			const r = await api.post('/api/raw', { cmd: `CG ${t.channel}-${t.pLayer} UPDATE 0 "${json}"` })
			if (r?.error) errors.push({ target: t, error: String(r.error) })
		} catch (e) {
			errors.push({ target: t, error: String(e?.message || e) })
		}
	}
	return errors
}

/**
 * todos27: WIGGLE preview — oscillate a param on the PREVIEW instances only for ~1.3s, then
 * restore, so the operator can SEE what the value does before committing to it. Never touches
 * shaderCfg (works on a scratch copy of the pass source) and never rides onto PGM.
 * @param {{ api: object, param: object, source: string, passKey: string,
 *   prvTargets: Array<{channel:number,pLayer:number}>, rewrite: Function }} opts
 */
export async function wiggleParamOnPreview(opts) {
	const { api, param, source, passKey, prvTargets, rewrite } = opts
	if (!prvTargets.length) return { ok: false, reason: 'no_preview_instance' }
	const orig = [...param.values]
	const span = Number.isFinite(param.max) && Number.isFinite(param.min) ? param.max - param.min : 0
	const STEPS = 8
	const push = async (vals) => {
		const src = rewrite(source, param, vals)
		const payload = passKey === 'common' ? { common: src } : { passes: { [passKey]: { source: src } } }
		await pushCgUpdateTo(api, prvTargets, payload)
	}
	try {
		for (let i = 0; i < STEPS; i++) {
			const phase = Math.sin((i / (STEPS - 1)) * Math.PI * 2)
			const vals = orig.map((v) => {
				const amp = span > 0 ? span * 0.12 : Math.max(0.2, Math.abs(v) * 0.5)
				const next = v + amp * phase
				return Number.isFinite(param.min) && Number.isFinite(param.max)
					? Math.min(param.max, Math.max(param.min, next))
					: next
			})
			await push(vals)
			await new Promise((r) => setTimeout(r, 150))
		}
	} finally {
		await push(orig)
	}
	return { ok: true }
}
