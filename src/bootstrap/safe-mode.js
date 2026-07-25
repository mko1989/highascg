'use strict'

const path = require('path')

/**
 * @param {object} opts
 * @param {object} opts.config
 * @param {object} opts.configManager
 * @param {string} opts.WEB_DIR
 * @param {string} opts.REPO_ROOT
 * @param {Function} opts.routeRequest
 * @param {object} opts.persistence
 * @param {object} opts.logger
 * @param {Function} opts.startHttpServer
 * @param {Function} opts.stopHttpServer
 */
function startSafeMode({ config, configManager, WEB_DIR, REPO_ROOT, routeRequest, persistence, logger, startHttpServer, stopHttpServer }) {
	// Minimal Context for UI
	const safeCtx = { config, log: (l, m) => logger.info(`[SafeMode] ${m}`), configManager }
	const httpServer = startHttpServer({
		port: config.server.httpPort,
		bindAddress: config.server.bindAddress,
		webDir: WEB_DIR,
		templatesDir: path.join(REPO_ROOT, 'template'),
		vendorDirs: [],
		routeApi: (m, p, b, r) => routeRequest(m, p, b, safeCtx, r),
		log: m => logger.info(`[SafeMode HTTP] ${m}`)
	})
	const safeShutdown = () => {
		try {
			persistence.flushSync()
		} catch (e) {
			logger.warn(`[SafeMode] persistence flush: ${e?.message || e}`)
		}
		stopHttpServer(httpServer, () => process.exit(0))
	}
	process.on('SIGINT', safeShutdown)
	process.on('SIGTERM', safeShutdown)
	logger.info(`[SafeMode] UI active on port ${config.server.httpPort}. Use the web interface to fix configuration.`)
}

module.exports = { startSafeMode }
