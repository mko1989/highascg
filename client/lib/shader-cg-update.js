/**
 * shader-cg-update.js — shared live push for Shader Live (editor + wiggle preview).
 * WO-598 directive D: the node composes the CG UPDATE (AMCP escaping, 403 → CG ADD re-host) —
 * POST /api/shader-live/push lands the payload on every live instance of the shader.
 */

/**
 * Push one payload to every live instance of a shader (or only its PRV instances).
 * @param {{ post: Function }} api
 * @param {string} shaderId
 * @param {object} payload  { common } | { passes: { key: { source } } }
 * @param {boolean} [prvOnly]
 * @returns {Promise<string[]>} per-target errors
 */
export async function pushShaderPayload(api, shaderId, payload, prvOnly = false) {
	try {
		const r = await api.post('/api/shader-live/push', { shaderId, payload, prvOnly })
		return Array.isArray(r?.errors) ? r.errors : r?.error ? [String(r.error)] : []
	} catch (e) {
		return [String(e?.message || e)]
	}
}

/**
 * todos27: WIGGLE preview — oscillate a param on the PREVIEW instances only for ~1.3s, then
 * restore, so the operator can SEE what the value does before committing to it. Never touches
 * shaderCfg (works on a scratch copy of the pass source) and never rides onto PGM.
 * @param {{ api: object, param: object, source: string, passKey: string, shaderId: string,
 *   prvTargets: Array<{channel:number,pLayer:number}>, rewrite: Function }} opts
 */
export async function wiggleParamOnPreview(opts) {
	const { api, param, source, passKey, shaderId, prvTargets, rewrite } = opts
	if (!prvTargets.length) return { ok: false, reason: 'no_preview_instance' }
	const orig = [...param.values]
	const span = Number.isFinite(param.max) && Number.isFinite(param.min) ? param.max - param.min : 0
	const STEPS = 8
	const push = async (vals) => {
		const src = rewrite(source, param, vals)
		const payload = passKey === 'common' ? { common: src } : { passes: { [passKey]: { source: src } } }
		await pushShaderPayload(api, shaderId, payload, true)
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
