/**
 * Late-bound app singletons — avoids import cycles with app.js.
 */
/** @type {import('./ws-client.js').WsClient | null} */
let _ws = null
/** @type {import('./osc-client.js').OscClient | null} */
let _osc = null

/**
 * @param {{ ws?: import('./ws-client.js').WsClient | null, osc?: import('./osc-client.js').OscClient | null }} bridge
 */
export function setAppRuntime(bridge) {
	if (bridge.ws !== undefined) _ws = bridge.ws
	if (bridge.osc !== undefined) _osc = bridge.osc
}

export function getAppWs() {
	return _ws
}

export function getAppOsc() {
	return _osc
}
