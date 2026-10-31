'use strict'

const { calculateCadence, findStandardModeId } = require('./config-modes')
const { videoModeTiming } = require('./audio-only-channel-mode')

/**
 * @param {string[]} customVideoModes
 * @param {Set<string>} customModeIds
 * @param {{ modeId: string, width: number, height: number, fps: number } | null | undefined} dims
 */
function pushCustomMode(customVideoModes, customModeIds, dims) {
	if (!dims || !dims.modeId || !dims.width || !dims.height || !dims.fps) return
	/* WO-484, belt and braces: never register a mode Caspar already ships. getModeDimensions now
	 * returns the standard id for a matching triple, so this should not fire — but a future caller
	 * building dims by hand must not be able to reintroduce a duplicate `1920x1080` = 1080p5000. */
	if (findStandardModeId(dims.width, dims.height, dims.fps)) return
	if (customModeIds.has(dims.modeId)) return
	customModeIds.add(dims.modeId)
	/* WO-898: 23.976 / 29.97 / 59.94 must be N*1000/1001 with Caspar's cadence list — round(fps*1000)/1000 with
	 * cadence round(48000/fps) fails server.cpp's cadence check ("Incorrect cadence in video-mode") and Caspar
	 * refuses to start. Integer rates come out exactly as before. */
	const t = videoModeTiming(dims.fps)
	const timeScale = t ? t.timeScale : Math.round(dims.fps * 1000)
	const duration = t ? t.duration : 1000
	const cad = t ? t.cadence.join(' ') : calculateCadence(dims.fps)
	customVideoModes.push(
		`        <video-mode>
            <id>${dims.modeId}</id>
            <width>${dims.width}</width>
            <height>${dims.height}</height>
            <time-scale>${timeScale}</time-scale>
            <duration>${duration}</duration>
            <cadence>${cad}</cadence>
        </video-mode>`
	)
}

module.exports = { pushCustomMode }
