'use strict'

/**
 * WO-661 — is Caspar's HTML producer running with GPU acceleration? Shader templates need WebGL2, which CEF only has
 * with `<html><enable-gpu>true` (WO-268); without it they render nothing on the CG path. `running` is what Caspar
 * reported in INFO CONFIG (null = not gathered yet), `setting` is `operatorTools.cefEnableGpu` (applies only after a
 * Caspar config apply + restart, so the two can differ).
 */

/** @param {string} xml INFO CONFIG text @returns {boolean | null} */
function parseHtmlEnableGpu(xml) {
	if (typeof xml !== 'string' || !xml.trim()) return null
	const html = xml.match(/<html>([\s\S]*?)<\/html>/i)
	const m = html && html[1].match(/<enable-gpu>\s*(true|false)\s*<\/enable-gpu>/i)
	return m ? m[1].toLowerCase() === 'true' : false
}

/** @param {any} ctx @returns {{ running: boolean | null, setting: boolean }} */
function htmlGpuState(ctx) {
	const ot = ctx?.config?.operatorTools || {}
	return {
		running: parseHtmlEnableGpu(ctx?.gatheredInfo?.infoConfig),
		setting: ot.cefEnableGpu === true || ot.cefEnableGpu === 'true',
	}
}

module.exports = { parseHtmlEnableGpu, htmlGpuState }
