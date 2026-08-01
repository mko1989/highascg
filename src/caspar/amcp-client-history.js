'use strict'

const fs = require('fs')
const path = require('path')

const FLUSH_DEBOUNCE_MS = 1000

/**
 * WO-401 F4: this used to `mkdirSync` + `writeFileSync` data/amcp-last50.txt inline before EVERY
 * `socket.send` (a scene take = dozens–hundreds of blocking disk round-trips inside take latency).
 * The ring now lives in memory only; the file is flushed asynchronously, debounced 1 s, purely as
 * a post-mortem artifact. A crash can lose at most the last second of tail — nothing in code reads
 * the file back.
 */
function recordAmcpHistory(ctx, command) {
	try {
		if (!ctx._amcpHistory) ctx._amcpHistory = []
		const ts = new Date().toISOString()
		ctx._amcpHistory.push(`${ts} ${command}`)
		if (ctx._amcpHistory.length > 50) {
			ctx._amcpHistory = ctx._amcpHistory.slice(ctx._amcpHistory.length - 50)
		}
		if (ctx._amcpHistoryFlushTimer) return
		ctx._amcpHistoryFlushTimer = setTimeout(() => {
			ctx._amcpHistoryFlushTimer = null
			flushAmcpHistory(ctx)
		}, FLUSH_DEBOUNCE_MS)
		if (ctx._amcpHistoryFlushTimer.unref) ctx._amcpHistoryFlushTimer.unref()
	} catch {
		/* non-fatal */
	}
}

/** Async fire-and-forget write of the in-memory ring. `ctx._amcpHistoryFile` overrides the path (tests). */
function flushAmcpHistory(ctx) {
	const lines = Array.isArray(ctx._amcpHistory) ? ctx._amcpHistory : []
	if (lines.length === 0) return Promise.resolve()
	const fp = ctx._amcpHistoryFile || path.join(process.cwd(), 'data', 'amcp-last50.txt')
	return fs.promises
		.mkdir(path.dirname(fp), { recursive: true })
		.then(() => fs.promises.writeFile(fp, lines.join('\n') + '\n', 'utf8'))
		.catch(() => {})
}

module.exports = { recordAmcpHistory, flushAmcpHistory }
