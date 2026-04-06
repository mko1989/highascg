'use strict'

/**
 * Map layer `audioRoute` (stereo pair within the program mix) to Caspar FFmpeg audio filter string.
 * @param {string} [route]
 * @returns {string | null} inner AF string for AMCP, or null for default (1+2)
 */
function audioRouteToAudioFilter(route) {
	const r = route || '1+2'
	if (r === '1+2') return null
	let cLeft = 0
	let cRight = 1
	if (r === '3+4') {
		cLeft = 2
		cRight = 3
	} else if (r === '5+6') {
		cLeft = 4
		cRight = 5
	} else if (r === '7+8') {
		cLeft = 6
		cRight = 7
	} else if (r === '9+10') {
		cLeft = 8
		cRight = 9
	} else if (r === '11+12') {
		cLeft = 10
		cRight = 11
	} else if (r === '13+14') {
		cLeft = 12
		cRight = 13
	} else if (r === '15+16') {
		cLeft = 14
		cRight = 15
	} else return null
	if (cLeft <= 0) return null
	return `pan=16c|c${cLeft}=c0|c${cRight}=c1`
}

module.exports = { audioRouteToAudioFilter }
