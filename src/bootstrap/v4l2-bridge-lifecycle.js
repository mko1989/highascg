'use strict'

const bridge = require('../virtual-output/v4l2-bridge')

/**
 * @param {object} opts
 * @param {object} opts.appCtx
 */
function createV4l2BridgeLifecycle({ appCtx }) {
	function onCasparConnected() {
		if (bridge.isVirtualCameraEnabled(appCtx.config)) {
			void bridge.startV4l2Bridge(appCtx)
		}
	}

	function onCasparDisconnected() {
		void bridge.stopV4l2Bridge(appCtx)
	}

	function onConfigChange() {
		if (bridge.isVirtualCameraEnabled(appCtx.config)) {
			void bridge.startV4l2Bridge(appCtx)
		} else {
			void bridge.stopV4l2Bridge(appCtx)
		}
	}

	function onShutdown() {
		void bridge.stopV4l2Bridge(appCtx)
		require('../virtual-output/v4l2-bridge-consumer').resetV4l2BridgeConsumerState()
		require('../virtual-output/v4l2-bridge-audio').resetV4l2BridgeAudioState()
	}

	return {
		onCasparConnected,
		onCasparDisconnected,
		onConfigChange,
		onShutdown,
	}
}

module.exports = { createV4l2BridgeLifecycle }
