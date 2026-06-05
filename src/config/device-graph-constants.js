'use strict'

const DEFAULT_DEVICE_ID = 'caspar_host'
const DEST_DEVICE_ID = 'destinations'
const AUTO_CASPAR_KINDS = new Set(['gpu_out', 'decklink_in', 'decklink_out'])

function slug(s) {
	return String(s || 'x')
		.replace(/[^a-zA-Z0-9._-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 48) || 'port'
}

module.exports = {
	DEFAULT_DEVICE_ID,
	DEST_DEVICE_ID,
	AUTO_CASPAR_KINDS,
	slug,
}
