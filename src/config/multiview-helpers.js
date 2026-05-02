'use strict'

/**
 * Whether the generated Caspar multiview channel includes a `<screen>` consumer
 * (vs stream-only / DeckLink-only / stream+DeckLink without a window).
 * @param {Record<string, unknown>} cs - casparServer slice
 * @returns {boolean}
 */
function multiviewGeneratedConfigIncludesScreen(cs) {
	const mode = String(cs?.multiview_output_mode || '').trim()
	if (mode === 'stream_only' || mode === 'decklink_only' || mode === 'decklink_stream') return false
	if (
		mode === 'screen_only' ||
		mode === 'screen_decklink' ||
		mode === 'screen_stream_decklink' ||
		mode === 'screen_stream'
	) {
		return true
	}
	if (!mode) return cs.multiview_screen_consumer !== false && cs.multiview_screen_consumer !== 'false'
	return false
}

module.exports = { multiviewGeneratedConfigIncludesScreen }
