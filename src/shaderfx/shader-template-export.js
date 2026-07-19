/**
 * WO-266 — build the self-contained Caspar HTML template for one shader config.
 *
 * The exported file lives in `template/shaders/<id>.html` next to the shared runtime
 * (`player.js`) and the vendored renderer (`ShaderToyLite.js`), referenced RELATIVELY so the
 * template works both from Caspar's CEF (file:// template root) and served over
 * `/templates/shaders/…` by the playout HTTP server (WO-258 browser_display path — the one with
 * real getUserMedia audio).
 */

'use strict'

/**
 * JSON-embed a config into an inline <script>, breaking any `</script` sequence inside shader
 * source strings so pasted GLSL/comments can never terminate the script block early.
 * @param {any} config
 * @returns {string}
 */
function embedConfigJson(config) {
	return JSON.stringify(config).replace(/<\//g, '<\\/')
}

/**
 * @param {{ id: string, name: string, opts: { alpha: boolean } }} config — normalized (shader-store)
 * @returns {string} HTML document
 */
function buildShaderTemplateHtml(config) {
	const background = config.opts.alpha ? 'transparent' : '#000'
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>${String(config.name).replace(/[<>&]/g, '')} — HighAsCG Shader FX</title>
	<style>
		html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${background}; }
		#shaderfx-canvas { display: block; width: 100vw; height: 100vh; }
	</style>
</head>
<body>
	<canvas id="shaderfx-canvas"></canvas>
	<script>window.__SHADERFX_CONFIG__ = ${embedConfigJson(config)}</script>
	<script src="ShaderToyLite.js"></script>
	<script src="player.js"></script>
</body>
</html>
`
}

module.exports = { buildShaderTemplateHtml, embedConfigJson }
