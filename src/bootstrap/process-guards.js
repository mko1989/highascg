'use strict'

/**
 * Global process error handlers (WO-101).
 * @param {{ logger: { error: (msg: string) => void }, persistence?: { flushSync?: () => void } }} opts
 */
function installProcessGuards(opts) {
	const logger = opts?.logger
	const persistence = opts?.persistence
	const logError = (tag, err) => {
		const msg =
			err instanceof Error ? err.stack || err.message : typeof err === 'string' ? err : String(err)
		if (logger && typeof logger.error === 'function') logger.error(`[${tag}] ${msg}`)
		else console.error(`[${tag}] ${msg}`)
	}

	process.on('unhandledRejection', (reason) => {
		logError('unhandledRejection', reason)
	})

	process.on('uncaughtException', (err) => {
		logError('uncaughtException', err)
		try {
			persistence?.flushSync?.()
		} catch (flushErr) {
			logError('uncaughtException.flush', flushErr)
		}
		process.exit(1)
	})
}

module.exports = { installProcessGuards }
