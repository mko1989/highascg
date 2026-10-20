'use strict'

/**
 * WO-603 — the media index of the live library (getRawMediaCatalog) for the media-exists rules, and the take-time
 * missing-media list (web warnMissingMediaOnTake; the take reply carries it so every client warns the same way).
 */

const { buildMediaIndex, missingMediaInScene } = require('../media/media-exists')

function mediaIndexFor(ctx) {
	try {
		return buildMediaIndex(require('./media-catalog').getRawMediaCatalog(ctx))
	} catch {
		return buildMediaIndex([])
	}
}

/** `{ missingMedia: [...] }` for a take reply, or `{}` when nothing is missing (or no media list yet). */
function missingMediaField(ctx, scene) {
	const missing = missingMediaInScene(scene, mediaIndexFor(ctx))
	return missing.length ? { missingMedia: missing } : {}
}

module.exports = { mediaIndexFor, missingMediaField }
