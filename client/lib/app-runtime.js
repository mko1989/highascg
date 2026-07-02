/**
 * Late-bound app singletons — avoids import cycles with app.js.
 */
/** @type {import('./ws-client.js').WsClient | null} */
let _ws = null
/** @type {import('./osc-client.js').OscClient | null} */
let _osc = null
/** @type {import('./state-store.js').StateStore | null} */
let _stateStore = null
/** @type {{ syncMultiviewCanvas?: (cm: object) => void, scheduleMultiviewRefresh?: () => void } | null} */
let _appLogic = null
/** @type {(() => object) | null} */
let _getVariableStore = null

/**
 * @param {{ ws?: import('./ws-client.js').WsClient | null, osc?: import('./osc-client.js').OscClient | null, stateStore?: import('./state-store.js').StateStore | null, appLogic?: object | null, getVariableStore?: (() => object) | null }} bridge
 */
export function setAppRuntime(bridge) {
	if (bridge.ws !== undefined) _ws = bridge.ws
	if (bridge.osc !== undefined) _osc = bridge.osc
	if (bridge.stateStore !== undefined) _stateStore = bridge.stateStore
	if (bridge.appLogic !== undefined) _appLogic = bridge.appLogic
	if (bridge.getVariableStore !== undefined) _getVariableStore = bridge.getVariableStore
}

export function getAppWs() {
	return _ws
}

export function getAppOsc() {
	return _osc
}

export function getAppStateStore() {
	return _stateStore
}

export function getAppLogic() {
	return _appLogic
}

export function getAppVariableStore() {
	return _getVariableStore?.() ?? null
}
