/**
 * CLS / TLS response handlers (Companion-free subset).
 * @see companion-module-casparcg-server/src/handlers.js
 */

'use strict'

/**
 * @param {{ state?: { updateFromCLS?: (data: string[]) => void, getState?: () => { media?: unknown[] } }, variables?: object, setVariableValues?: (o: object) => void, init_actions?: () => void }} ctx
 * @param {string[]} data
 */
function handleCLS(ctx, data) {
	ctx._clsRawLines = data || []
	if (ctx.state?.updateFromCLS) {
		ctx.state.updateFromCLS(data)
	}
	const count = ctx.state?.getState?.()?.media?.length ?? 0
	if (ctx.variables) ctx.variables.media_count = String(count)
	if (typeof ctx.setVariableValues === 'function') ctx.setVariableValues({ media_count: ctx.variables?.media_count })
	if (typeof ctx.init_actions === 'function') ctx.init_actions()
}

/**
 * @param {Array<string>} data - TLS response lines
 * @returns {Array<{ id: string, label: string }>}
 */
function parseTlsLines(data) {
	const templates = []
	for (let i = 0; i < (data || []).length; ++i) {
		const line = String(data[i] || '')
			.replace(/\r/g, '')
			.trim()
		if (!line || /^TLS\b/i.test(line) || /^\d{3}\s/.test(line)) continue
		const match = line.match(/\"(.*?)\" +(.*)/)
		let file = null
		if (match === null) file = line
		else file = match[1]
		if (file !== null) {
			file = file.replace(/\\/g, '\\\\')
			templates.push({ label: file, id: file })
		}
	}
	return templates
}

/**
 * @param {{ state?: { updateFromTLS?: (data: string[]) => void, getState?: () => { templates?: unknown[] } }, variables?: object, setVariableValues?: (o: object) => void, init_actions?: () => void }} ctx
 * @param {string[]} data
 */
function handleTLS(ctx, data) {
	if (ctx.state?.updateFromTLS) {
		ctx.state.updateFromTLS(data)
	} else {
		const templates = parseTlsLines(data)
		if (!Object.getOwnPropertyDescriptor(ctx, 'CHOICES_TEMPLATES')?.get) {
			ctx.CHOICES_TEMPLATES = templates
		}
	}
	const count = ctx.state?.getState?.()?.templates?.length ?? parseTlsLines(data).length
	if (ctx.variables) ctx.variables.template_count = String(count)
	if (typeof ctx.setVariableValues === 'function') ctx.setVariableValues({ template_count: ctx.variables?.template_count })
	if (typeof ctx.init_actions === 'function') ctx.init_actions()
}

module.exports = { handleCLS, handleTLS, parseTlsLines }
