'use strict'

/**
 * Classify a PixelHue `/unico/v1/interface/list-detail` entry as a **video input** (takes Caspar/DeckLink)
 * or a **video output** (feeds program to destinations / record).
 *
 * Companion uses **interfaceType 2, workMode 0** for layer *sources* (external in). Other combinations
 * are treated as program outputs. `connectorInfo.type` often follows 0 = in / 1 = out on PixelFlow.
 *
 * @param {any} iface
 * @returns {'in' | 'out'}
 */
function classifyPhInterfaceKind(iface) {
	const c = iface && iface.auxiliaryInfo && iface.auxiliaryInfo.connectorInfo
	if (!c) return 'in'
	const it = Number(c.interfaceType)
	const wm = Number(c.workMode) || 0
	const t = Number(c.type)
	// Explicit connector `type` out/in (PixelFlow / some firmware) wins over interfaceType
	if (t === 1) return 'out'
	// Match Companion: layer *source* = external video in (getInterfaces(2, 0))
	if (it === 2 && wm === 0) return 'in'
	// Distinguish interfaceType before generic connector type 0 (default on many rows)
	if (it === 1) return 'out'
	if (it > 2) return 'out'
	if (it === 2 && wm === 1) return 'out'
	if (t === 0) return 'in'
	return 'in'
}

module.exports = { classifyPhInterfaceKind }
