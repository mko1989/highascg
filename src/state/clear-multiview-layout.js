'use strict'

/**
 * Drop persisted multiview layout so routing startup does not replay a pre-reset grid.
 * @param {object} [ctx]
 */
function clearPersistedMultiviewLayout(ctx) {
	const persistence = ctx?.persistence || require('../utils/persistence')
	try {
		persistence.remove('multiviewLayout')
		const all = typeof persistence.getAll === 'function' ? persistence.getAll() : {}
		for (const key of Object.keys(all || {})) {
			if (/^multiviewLayout_\d+$/.test(key)) persistence.remove(key)
		}
	} catch {
		/* optional */
	}
	if (ctx && typeof ctx === 'object') {
		ctx._multiviewLayout = null
		if (ctx._multiviewLayouts && typeof ctx._multiviewLayouts === 'object') {
			ctx._multiviewLayouts = {}
		}
	}
}

module.exports = { clearPersistedMultiviewLayout }
