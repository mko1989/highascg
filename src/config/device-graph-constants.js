'use strict'

const DEFAULT_DEVICE_ID = 'caspar_host'
const PH_DEVICE_ID = 'pixelhue_main'
const DEST_DEVICE_ID = 'destinations'
const AUTO_CASPAR_KINDS = new Set(['gpu_out', 'decklink_in', 'decklink_out'])
const AUTO_PH_KINDS = new Set(['ph_in', 'ph_out'])

function slug(s) {
	return String(s || 'x')
		.replace(/[^a-zA-Z0-9._-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.slice(0, 48) || 'port'
}

module.exports = {
	DEFAULT_DEVICE_ID,
	PH_DEVICE_ID,
	DEST_DEVICE_ID,
	AUTO_CASPAR_KINDS,
	AUTO_PH_KINDS,
	slug,
}
