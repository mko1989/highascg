'use strict'

const { normalizeDeviceGraph, validateDeviceGraph } = require('./device-graph-core')
const { suggestConnectorsAndDevicesFromLive, mergeHardwareSync } = require('./device-graph-suggest')
const {
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
	isCasparOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
} = require('./device-graph-edges')
const { DEFAULT_DEVICE_ID, DEST_DEVICE_ID } = require('./device-graph-constants')

module.exports = {
	normalizeDeviceGraph,
	validateDeviceGraph,
	mergeHardwareSync,
	suggestConnectorsAndDevicesFromLive,
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
	isCasparOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
	DEFAULT_DEVICE_ID,
	DEST_DEVICE_ID,
}
