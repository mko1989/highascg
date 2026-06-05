'use strict'

/**
 * Single-line XML comment safe for CasparCG config (avoid `--` in body).
 * @param {string} description - Human-readable role for this `<channel>`
 * @returns {string} Line ending with newline, 8-space indent to match `<channel>` blocks
 */
function channelXmlComment(description) {
	const t = String(description || 'channel')
		.replace(/\-\-/g, '\u2014')
		.replace(/\]\]>/g, '] ]>')
		.trim()
	return `        <!-- HighAsCG: ${t} -->\n`
}

module.exports = { channelXmlComment }
