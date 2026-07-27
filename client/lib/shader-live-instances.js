/**
 * shader-live-instances.js — every shader currently LIVE on any channel, from scene.live
 * (split out of shader-live-editor.js for the 500-line limit; WO-345 contract unchanged).
 */

const SHADER_VALUE_RE = /(^|\/)shaders\/(sh-[a-z0-9-]+)/i

export function liveShaderInstances(stateStore) {
	const st = stateStore.getState() || {}
	const live = st.scene?.live || st['scene.live'] || {}
	const banks = st.scene?.programLayerBankByChannel || {}
	const cm = st.channelMap || {}
	const prvSet = new Set((cm.previewChannels || []).map(Number))
	const out = []
	for (const chKey of Object.keys(live)) {
		const scene = live[chKey]?.scene
		if (!scene || !Array.isArray(scene.layers)) continue
		for (const layer of scene.layers) {
			const m = SHADER_VALUE_RE.exec(String(layer?.source?.value || ''))
			if (!m) continue
			const ch = parseInt(chKey, 10)
			const logical = Number(layer.layerNumber)
			const bank = prvSet.has(ch) ? 'a' : String(banks[chKey] || 'a')
			const pLayer = bank === 'b' ? logical + 100 : logical
			out.push({
				shaderId: m[2].toLowerCase(),
				/* Full template path for the CG ADD re-host fallback (same string the engine plays). */
				cgName: String(layer.source.value).trim().toLowerCase(),
				channel: ch,
				pLayer,
				isPrv: prvSet.has(ch),
				sceneName: scene.name || scene.id,
			})
		}
	}
	// PGM instances first so auto-select lands on air.
	out.sort((a, b) => Number(a.isPrv) - Number(b.isPrv) || a.channel - b.channel)
	return out
}
