'use strict'

const { hostFocusActive } = require('./cef-interactive-bridge-shared')
const {
	listInteractiveZones,
	resolveInteractiveLayer,
	bridgeEnabledInConfig,
} = require('./cef-interactive-bridge-zones')
const {
	startCefInteractiveBridge,
	stopCefInteractiveBridge,
	syncCefInteractiveBridge,
} = require('./cef-interactive-bridge-lifecycle')
const {
	handleX11Event,
	enqueueX11Event,
	drainCefInteractiveEvents,
	notifyCefInteractiveAmcpLines,
	notifyCefFocusChanged,
} = require('./cef-interactive-bridge-events')

module.exports = {
	listInteractiveZones,
	resolveInteractiveLayer,
	bridgeEnabledInConfig,
	startCefInteractiveBridge,
	stopCefInteractiveBridge,
	syncCefInteractiveBridge,
	handleX11Event,
	enqueueX11Event,
	drainCefInteractiveEvents,
	notifyCefInteractiveAmcpLines,
	notifyCefFocusChanged,
	hostFocusActive,
}
