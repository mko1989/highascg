'use strict'

const { normalizeDeviceGraph, validateDeviceGraph, graphFromTandemTopology } = require('./device-graph-core')
const { suggestConnectorsAndDevicesFromLive, mergeHardwareSync } = require('./device-graph-suggest')
const {
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
	isCasparOutputConnector,
	isPhInputConnector,
	isPhOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
} = require('./device-graph-edges')
const { DEFAULT_DEVICE_ID, PH_DEVICE_ID, DEST_DEVICE_ID } = require('./device-graph-constants')

module.exports = {
	normalizeDeviceGraph,
	validateDeviceGraph,
	graphFromTandemTopology,
	mergeHardwareSync,
	suggestConnectorsAndDevicesFromLive,
	edgeConnectAllowed,
	ensureConnectorsFromSuggested,
	addEdgeToGraph,
	removeEdgeById,
	isCasparOutputConnector,
	isPhInputConnector,
	isPhOutputConnector,
	isDestinationInputConnector,
	isDecklinkIoInputConnector,
	DEFAULT_DEVICE_ID,
	PH_DEVICE_ID,
	DEST_DEVICE_ID,
}
