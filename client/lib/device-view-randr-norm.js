/**
 * Leaf helper shared by device-view components and gpu-port libs.
 * Lives alone so lib/device-view-gpu-port-* and components/device-view-* can
 * both use it without forming an import cycle (WO-138).
 */

/** Normalize an xrandr/Caspar port name for comparison (strip cardN- prefix, uppercase). */
export function normRandrCaspar(v) {
	return String(v || '').trim().toUpperCase().replace(/^CARD\d+-/i, '')
}
