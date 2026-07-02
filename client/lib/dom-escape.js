/**
 * HTML / attribute escaping for client innerHTML sinks (WO-103).
 */

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/** Alias for HTML attribute contexts (quoted attributes). */
export const escapeAttr = escapeHtml

/**
 * Tagged template — escapes all interpolations for safe innerHTML assignment.
 * @param {TemplateStringsArray} strings
 * @param {unknown[]} values
 */
export function html(strings, ...values) {
	let out = ''
	for (let i = 0; i < strings.length; i++) {
		out += strings[i]
		if (i < values.length) out += escapeHtml(values[i])
	}
	return out
}
