'use strict'

// WO-319: GUI live stream — the operator-GUI channel NVENC-encoded once, relayed to browser
// WebCodecs clients over a dedicated binary WS. Fully idle (0 NVENC sessions, no UDP hop)
// until a browser actually opens the live preview; see src/preview/gui-stream-ingest.js.
function setupOperatorGuiStream({ config, appCtx, httpServer, logger }) {
	try {
		const { resolveOperatorGuiChannel, resolveOperatorGuiChannelDims } = require('../system/operator-gui-channel')
		const { createGuiStreamIngest } = require('../preview/gui-stream-ingest')
		const { attachGuiStreamRelay } = require('../preview/gui-stream-ws-relay')
		const { DEFAULT_FPS, DEFAULT_GOP } = require('../preview/gui-stream-nvenc-args')
		const guiCh = resolveOperatorGuiChannel(config)
		if (guiCh) {
			const dims = resolveOperatorGuiChannelDims(config)
			// Downscale anything above 1080p before encode; -2 keeps aspect at an even height.
			const scale = dims && dims.width > 1920 ? '1920:-2' : null
			const glog = (lvl, m) => (lvl === 'warn' ? logger.warn(m) : logger.info(m))
			// Lazy AMCP wrapper: Caspar may (re)connect after this point; resolve at call time.
			const lazyAmcp = { raw: (cmd) => {
				if (!appCtx.amcp) return Promise.reject(new Error('Caspar not connected'))
				return appCtx.amcp.raw(cmd)
			} }
			const ingest = createGuiStreamIngest({ amcp: lazyAmcp, channel: guiCh.ch, scale, log: glog })
			ingest.cleanupStaleConsumer().catch(() => {})
			appCtx._guiStreamIngest = ingest
			appCtx._guiStreamRelay = attachGuiStreamRelay(httpServer, appCtx, { ingest, channel: guiCh.ch, fps: DEFAULT_FPS, gop: DEFAULT_GOP, log: glog })
			appCtx._guiStreamLifecycle = { onShutdown: () => void ingest.stop() }
			logger.info(`[GUI stream] relay at /ws/gui-stream → channel ${guiCh.ch}${scale ? ` (scale ${scale})` : ''}`)
		} else {
			logger.info('[GUI stream] not attached — no operator_gui destination configured')
		}
	} catch (e) {
		logger.warn(`[GUI stream] setup failed: ${e?.message || e}`)
	}
}

module.exports = { setupOperatorGuiStream }
