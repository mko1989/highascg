/**
 * CLS / TLS response handlers (Companion-free subset).
 * @see companion-module-casparcg-server/src/handlers.js
 */

'use strict'

/**
 * @param {{ CHOICES_MEDIAFILES?: Array<{ id: string, label: string }>, variables?: object, setVariableValues?: (o: object) => void, init_actions?: () => void }} ctx
 * @param {string[]} data
 */
function handleCLS(ctx, data) {
	if (!ctx.CHOICES_MEDIAFILES) ctx.CHOICES_MEDIAFILES = []
	ctx.CHOICES_MEDIAFILES.length = 0
	ctx._clsRawLines = data || []
	for (let i = 0; i < (data || []).length; ++i) {
		const match = data[i].match(/^"([^"]+)"/)
		if (match && match.length > 1) {
			const file = match[1].replace(/\\/g, '\\\\')
			ctx.CHOICES_MEDIAFILES.push({ label: file, id: file })
		}
	}
	if (ctx.variables) ctx.variables.media_count = String(ctx.CHOICES_MEDIAFILES.length)
	if (typeof ctx.setVariableValues === 'function') ctx.setVariableValues({ media_count: ctx.variables.media_count })
	if (typeof ctx.init_actions === 'function') ctx.init_actions()
}

/**
 * @param {{ CHOICES_TEMPLATES?: Array<{ id: string, label: string }>, variables?: object, setVariableValues?: (o: object) => void, init_actions?: () => void }} ctx
 * @param {string[]} data
 */
function handleTLS(ctx, data) {
	if (!ctx.CHOICES_TEMPLATES) ctx.CHOICES_TEMPLATES = []
	ctx.CHOICES_TEMPLATES.length = 0
	for (let i = 0; i < (data || []).length; ++i) {
		const match = data[i].match(/\"(.*?)\" +(.*)/)
		let file = null
		if (match === null) file = data[i]
		else file = match[1]
		if (file !== null) {
			file = file.replace(/\\/g, '\\\\')
			ctx.CHOICES_TEMPLATES.push({ label: file, id: file })
		}
	}
	if (ctx.variables) ctx.variables.template_count = String(ctx.CHOICES_TEMPLATES.length)
	if (typeof ctx.setVariableValues === 'function') ctx.setVariableValues({ template_count: ctx.variables.template_count })
	if (typeof ctx.init_actions === 'function') ctx.init_actions()
}

module.exports = { handleCLS, handleTLS }
