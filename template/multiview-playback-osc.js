/**
 * OSC layer selection for multiview timers / active-source labels.
 * Ignores full-screen chrome (LED test, global border, multiview CG) on high layers.
 */
;(function (global) {
	const MV_OSC_IGNORE_LAYER = new Set([996, 998, 999])
	const MV_OSC_IGNORE_NAME_RE =
		/(?:^|[/\\])(?:color_bg|multiview_master|multiview_overlay|interactive_click_test)(?:\.html)?$/i
	/** Server prunes at osc.layerStaleTimeoutMs (default 10 s); template guard is the delta-merge / old-server fallback. */
	const MV_OSC_LAYER_STALE_MS = 12000

	function oscFileLabel(file) {
		return String(file?.name || file?.path || '')
	}

	/**
	 * Layer whose OSC stopped flowing (removed from the Caspar stage) — its clip/elapsed is frozen history.
	 * Compares the layer's server-stamped `_lastOscAt` against the snapshot `updatedAt` (same clock).
	 * @param {object|null|undefined} layerOsc
	 * @param {number|null|undefined} nowTs - `updatedAt` of the latest OSC snapshot/delta
	 * @param {number} [staleMs]
	 * @returns {boolean}
	 */
	function isStaleOscPlaybackLayer(layerOsc, nowTs, staleMs) {
		const last = Number(layerOsc?._lastOscAt || 0)
		const now = Number(nowTs || 0)
		if (!last || !now) return false
		return now - last > (Number(staleMs) > 0 ? Number(staleMs) : MV_OSC_LAYER_STALE_MS)
	}

	function isIgnoredOscFileLabel(label) {
		const lower = String(label || '').toLowerCase()
		if (!lower || lower.startsWith('route://')) return false
		if (lower.includes('led_grid_test') || lower.includes('led_test_pattern')) return true
		return MV_OSC_IGNORE_NAME_RE.test(label)
	}

	/**
	 * @param {number} layerNum
	 * @param {object|null|undefined} layerOsc
	 * @param {number|null|undefined} [nowTs] - latest OSC snapshot `updatedAt` (enables stale-layer skip)
	 * @returns {boolean}
	 */
	function shouldIgnoreOscPlaybackLayer(layerNum, layerOsc, nowTs) {
		if (MV_OSC_IGNORE_LAYER.has(layerNum)) return true
		if (isStaleOscPlaybackLayer(layerOsc, nowTs)) return true
		return isIgnoredOscFileLabel(oscFileLabel(layerOsc?.file))
	}

	global.mvPlaybackOsc = {
		MV_OSC_LAYER_STALE_MS,
		oscFileLabel,
		isIgnoredOscFileLabel,
		isStaleOscPlaybackLayer,
		shouldIgnoreOscPlaybackLayer,
	}
})(typeof window !== 'undefined' ? window : globalThis)
