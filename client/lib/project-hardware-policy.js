/** @typedef {'ask' | 'apply_saved' | 'keep_live'} HardwarePolicy */

import { readGlobalPref, writeGlobalPref } from './client-prefs.js'

/** Shared by every client on the node (WO-598 D, client-prefs `hardwarePolicy`); localStorage is the fallback. */
/** @returns {HardwarePolicy} */
export function getHardwarePolicy() {
	const v = readGlobalPref('hardwarePolicy')
	return v === 'apply_saved' || v === 'keep_live' || v === 'ask' ? v : 'ask'
}

/** @param {HardwarePolicy} policy */
export function setHardwarePolicy(policy) {
	writeGlobalPref('hardwarePolicy', policy)
}
