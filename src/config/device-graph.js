'use strict'

const { normalizeDeviceGraph, validateDeviceGraph } = require('./device-graph-core')
const { suggestConnectorsAndDevicesFromLive: suggestBase, mergeHardwareSync } = require('./device-graph-suggest')
const { withLocalUse } = require('./device-graph-local-use')
const {
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
	pruneDestinationFromGraph,
	isCasparOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
} = require('./device-graph-edges')
const { DEFAULT_DEVICE_ID, DEST_DEVICE_ID } = require('./device-graph-constants')

/** WO-1029: the suggested connectors plus this server's one Local use jack. */
const suggestConnectorsAndDevicesFromLive = (live, appConfig) => withLocalUse(suggestBase(live, appConfig))

module.exports = {
	normalizeDeviceGraph,
	validateDeviceGraph,
	mergeHardwareSync,
	suggestConnectorsAndDevicesFromLive,
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
	pruneDestinationFromGraph,
	isCasparOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
	DEFAULT_DEVICE_ID,
	DEST_DEVICE_ID,
}
