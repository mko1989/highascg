/** Device View rear panel — compact node layout + orthogonal cables (WO-82). */
export const SIMPLE_WIRING_KEY = 'highascg_device_view_simple_wiring'

export function readSimpleWiring() {
	try {
		return localStorage.getItem(SIMPLE_WIRING_KEY) === '1'
	} catch {
		return false
	}
}

export function writeSimpleWiring(on) {
	try {
		if (on) localStorage.setItem(SIMPLE_WIRING_KEY, '1')
		else localStorage.removeItem(SIMPLE_WIRING_KEY)
	} catch {
		/* ignore */
	}
}
