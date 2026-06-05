'use strict'

const { calculateCadence } = require('./config-modes')

/**
 * @param {string[]} customVideoModes
 * @param {Set<string>} customModeIds
 * @param {{ modeId: string, width: number, height: number, fps: number } | null | undefined} dims
 */
function pushCustomMode(customVideoModes, customModeIds, dims) {
	if (!dims || !dims.modeId || !dims.width || !dims.height || !dims.fps) return
	if (customModeIds.has(dims.modeId)) return
	customModeIds.add(dims.modeId)
	const timeScale = Math.round(dims.fps * 1000)
	const cad = calculateCadence(dims.fps)
	customVideoModes.push(
		`        <video-mode>
            <id>${dims.modeId}</id>
            <width>${dims.width}</width>
            <height>${dims.height}</height>
            <time-scale>${timeScale}</time-scale>
            <duration>1000</duration>
            <cadence>${cad}</cadence>
        </video-mode>`
	)
}

module.exports = { pushCustomMode }
