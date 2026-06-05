/**
 * Template Editor (CG Studio) API routes.
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('../api/response')

const fs = require('fs')
const path = require('path')

/**
 * Basic health check for the cg-studio module.
 * @param {object} ctx
 */
function handleHealth(ctx) {
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			module: 'cg-studio',
			status: 'active'
		})
	}
}

async function handleSave(ctx, bodyStr) {
	try {
		const body = JSON.parse(bodyStr)
		if (!body.name) throw new Error('Missing template name')

		const { REPO_ROOT } = require('../repo-paths')
		const tplDir = path.join(REPO_ROOT, 'template', body.name)
		await fs.promises.mkdir(tplDir, { recursive: true })

		// Save GrapesJS project data
		if (body.projectData) {
			await fs.promises.writeFile(
				path.join(tplDir, 'project.json'),
				JSON.stringify(body.projectData, null, 2)
			)
		}

		// Generate index.html wrapped for CasparCG
		if (body.html != null || body.css != null) {
			const outputHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { background: transparent; margin: 0; padding: 0; width: 1920px; height: 1080px; overflow: hidden; }
${body.css || ''}
</style>
<script>
window.update = function(str) {
	try {
		const data = typeof str === 'string' ? JSON.parse(str) : str;
		for (const key in data) {
			const el = document.getElementById(key) || document.querySelector('[data-field="'+key+'"]');
			if (el) el.innerHTML = data[key];
		}
	} catch (e) { console.error('Template update error:', e); }
};
window.play = function() {};
window.stop = function() { document.body.innerHTML = ''; };
</script>
</head>
<body>
${body.html || ''}
</body>
</html>`
			await fs.promises.writeFile(path.join(tplDir, 'index.html'), outputHtml)
		}

		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true })
		}
	} catch (e) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ error: String(e) })
		}
	}
}

module.exports = {
	handleHealth,
	handleSave
}
