/**
 * CasparCG lower-third HTML export for CG Studio.
 * Wraps GrapesJS output in template/lower-thirds/lt-engine.js contract.
 */

import {
	LT_BASE_CSS,
	LT_CONTAINER_CLASS,
	LT_GRAPHIC_CLASS,
	getLtAnimationPreset,
	ltDisplayNameFromId,
	normalizeLtTemplateId,
} from './cg-studio-lt-presets.js'

const GSAP_SRC = '../CasparCG-Guide-HTML-Template-master/node_modules/gsap/dist/gsap.js'
const LT_ENGINE_SRC = 'lt-engine.js'

/**
 * @param {string} html
 */
function escapeHtml(text) {
	return String(text || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

/**
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
function escapeJsonForScript(data) {
	return JSON.stringify(data == null ? {} : data).replace(/</g, '\\u003c')
}

/**
 * Build LTEngine.init script block for exported template.
 * @param {{ animationPreset?: string }} opts
 */
export function buildLtEngineInitScript(opts) {
	const preset = getLtAnimationPreset(opts.animationPreset)
	return `LTEngine.init({
            containerSel: '.${LT_CONTAINER_CLASS}',
            titleSel: '[data-lt-role="title"], h1',
            subtitleSel: '[data-lt-role="subtitle"], .subtitle p',
            applyStyles: function(style) {
                var root = document.documentElement;
                if (style.primaryColor) root.style.setProperty('--primary', style.primaryColor);
                if (style.textColor) root.style.setProperty('--text', style.textColor);
            },
            animateIn: ${preset.animateIn},
            animateOut: ${preset.animateOut}
        });`
}

/**
 * Build a Caspar-safe lower-third HTML file (lt-engine.js + GSAP).
 *
 * @param {{
 *   name: string,
 *   html: string,
 *   css: string,
 *   projectData?: object,
 *   animationPreset?: string,
 *   fields?: Record<string, string>,
 * }} opts
 * @returns {{ html: string, projectJson: string, templateId: string, htmlPath: string }}
 */
export function buildCasparTemplateHtml(opts) {
	const templateId = normalizeLtTemplateId(opts.name)
	const displayName = ltDisplayNameFromId(templateId)
	const graphicHtml = String(opts.html || '').trim()
	const userCss = String(opts.css || '').trim()
	const animationPreset = String(opts.animationPreset || 'fade')
	const fields = opts.fields && typeof opts.fields === 'object' ? opts.fields : {
		title: 'Name',
		subtitle: 'Title',
	}
	const projectData = opts.projectData != null ? opts.projectData : null

	const html = `<!DOCTYPE html>
<!-- ${templateId}.html — ${displayName} (CG Studio / lt-engine) -->
<html>
<head>
    <meta charset="utf-8">
    <title>Lower Third — ${escapeHtml(displayName)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
${LT_BASE_CSS}
${userCss}
    </style>
</head>
<body>
    <main class="${LT_CONTAINER_CLASS}">
        <div class="${LT_GRAPHIC_CLASS}">
${graphicHtml}
        </div>
    </main>
    <script src="${GSAP_SRC}"></script>
    <script src="${LT_ENGINE_SRC}"></script>
    <script>
        ${buildLtEngineInitScript({ animationPreset })}
    </script>
</body>
</html>`

	const projectJson = JSON.stringify(
		{
			name: templateId,
			displayName,
			version: 2,
			engine: 'lt-engine',
			animationPreset,
			exportedAt: new Date().toISOString(),
			fields,
			projectData,
			graphicHtml,
			css: userCss,
		},
		null,
		2,
	)

	return {
		html,
		projectJson,
		templateId,
		htmlPath: `lower-thirds/${templateId}.html`,
	}
}

/**
 * Extract inner HTML of the `.graphic` layer from GrapesJS output.
 * @param {import('grapesjs').Editor} editor
 * @returns {{ graphicHtml: string, css: string }}
 */
export function extractLtGraphicFromEditor(editor) {
	const wrapper = editor.getWrapper()
	const graphic =
		wrapper?.find?.(`.${LT_GRAPHIC_CLASS}`)?.[0] ||
		wrapper?.find?.('[class*="graphic"]')?.[0] ||
		null

	const graphicHtml = graphic ? graphic.getInnerHTML() : editor.getHtml()
	const css = editor.getCss()
	return { graphicHtml, css }
}
