/**
 * OSC layer selection for multiview timers / active-source labels.
 * Ignores full-screen chrome (LED test, global border, multiview CG) on high layers.
 */
;(function (global) {
	const MV_OSC_IGNORE_LAYER = new Set([996, 998, 999])
	const MV_OSC_IGNORE_NAME_RE =
		/(?:^|[/\\])(?:color_bg|multiview_master|multiview_overlay|interactive_click_test)(?:\.html)?$/i

	function oscFileLabel(file) {
		return String(file?.name || file?.path || '')
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
	 * @returns {boolean}
	 */
	function shouldIgnoreOscPlaybackLayer(layerNum, layerOsc) {
		if (MV_OSC_IGNORE_LAYER.has(layerNum)) return true
		return isIgnoredOscFileLabel(oscFileLabel(layerOsc?.file))
	}

	global.mvPlaybackOsc = {
		oscFileLabel,
		isIgnoredOscFileLabel,
		shouldIgnoreOscPlaybackLayer,
	}
})(typeof window !== 'undefined' ? window : globalThis)
