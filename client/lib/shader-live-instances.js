/**
 * shader-live-instances.js — every shader currently LIVE on any channel, from scene.live
 * (split out of shader-live-editor.js for the 500-line limit; WO-345 contract unchanged).
 *
 * issues 01.08: scene.live is the scene AS AUTHORED — a playlist layer keeps its original
 * source.value across hops (the engine PLAYs the next item without touching live state), so the
 * editor listed (and CG-ADD re-hosted!) the first shader while another was on air. Playlist
 * layers are therefore resolved through `playlistNow` — the currently-active item per live
 * playlist layer, polled from GET /api/playlist/state by {@link createPlaylistNowTracker}.
 */

const SHADER_VALUE_RE = /(^|\/)shaders\/(sh-[a-z0-9-]+)/i

/**
 * @param {object} stateStore
 * @param {Record<string, string>} [playlistNow] `<channel>-<layerNumber>` → active item value
 */
export function liveShaderInstances(stateStore, playlistNow) {
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
			const ch = parseInt(chKey, 10)
			const isPlaylist = layer?.sourceMode === 'list' && Array.isArray(layer?.playlist) && layer.playlist.length > 0
			const nowValue = isPlaylist ? playlistNow?.[`${ch}-${Number(layer.layerNumber)}`] : null
			const m = SHADER_VALUE_RE.exec(String(nowValue ?? layer?.source?.value ?? ''))
			if (!m) continue
			const logical = Number(layer.layerNumber)
			const bank = prvSet.has(ch) ? 'a' : String(banks[chKey] || 'a')
			const pLayer = bank === 'b' ? logical + 100 : logical
			out.push({
				shaderId: m[2].toLowerCase(),
				/* Full template path for the CG ADD re-host fallback (same string the engine plays). */
				cgName: String(nowValue ?? layer.source.value).trim().toLowerCase(),
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

/**
 * Polls GET /api/playlist/state while started and keeps a `<channel>-<layerNumber>` → active item
 * value map for {@link liveShaderInstances}. The engine advances playlists server-side without a
 * client-visible state tick, so a poll (same as the Playlists footer panel) is the only signal.
 * @param {{ get: (path: string) => Promise<any> }} api
 * @param {() => void} [onChange] fired when the map actually changed (a hop happened)
 */
export function createPlaylistNowTracker(api, onChange) {
	let timer = null
	let map = {}
	async function tick() {
		try {
			const r = await api.get('/api/playlist/state')
			const next = {}
			for (const p of r?.playlists || []) {
				if (!p?.live || p.channel == null) continue
				const it = p.items?.[Number(p.activeIndex) || 0]
				if (it?.value) next[`${p.channel}-${Number(p.layerNumber)}`] = String(it.value)
			}
			const changed = JSON.stringify(next) !== JSON.stringify(map)
			map = next
			if (changed) onChange?.()
		} catch {
			/* poll is advisory — a missed tick just delays the follow */
		}
	}
	return {
		start() {
			if (timer) return
			void tick()
			timer = setInterval(() => void tick(), 1000)
		},
		stop() {
			if (timer) clearInterval(timer)
			timer = null
			map = {}
		},
		now() {
			return map
		},
	}
}
