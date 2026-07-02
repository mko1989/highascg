'use strict'

/**
 * Log swallowed errors instead of empty catch blocks (WO-101).
 * @param {unknown} err
 * @param {{ log?: (level: string, msg: string) => void, tag?: string, level?: string }} [ctx]
 */
function swallow(err, ctx = {}) {
	const tag = ctx.tag ? String(ctx.tag) : 'swallow'
	const level = ctx.level || 'warn'
	const msg = err instanceof Error ? err.message : String(err)
	const line = `[${tag}] ${msg}`
	if (typeof ctx.log === 'function') {
		try {
			ctx.log(level, line)
			return
		} catch {
			/* ignore */
		}
	}
	if (level === 'error') console.error(line)
	else if (level === 'debug') console.debug(line)
	else console.warn(line)
}

module.exports = { swallow }
