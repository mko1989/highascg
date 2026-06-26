/** @typedef {'ask' | 'apply_saved' | 'keep_live'} HardwarePolicy */

const STORAGE_KEY = 'highascg_hardware_policy'

/** @returns {HardwarePolicy} */
export function getHardwarePolicy() {
	try {
		const v = localStorage.getItem(STORAGE_KEY)
		if (v === 'apply_saved' || v === 'keep_live' || v === 'ask') return v
	} catch {
		/* ignore */
	}
	return 'ask'
}

/** @param {HardwarePolicy} policy */
export function setHardwarePolicy(policy) {
	try {
		localStorage.setItem(STORAGE_KEY, policy)
	} catch {
		/* ignore */
	}
}
