const INSPECTOR_MODE_STORAGE = 'hacg_inspector_panel_mode'
const INSPECTOR_MODES = new Set(['inspector', 'layerPresets', 'lookPresets'])

export function readInspectorPanelMode() {
	try {
		const m = sessionStorage.getItem(INSPECTOR_MODE_STORAGE)
		if (m && INSPECTOR_MODES.has(m)) return m
	} catch {
		/* ignore */
	}
	return 'inspector'
}

export function writeInspectorPanelMode(m) {
	try {
		sessionStorage.setItem(INSPECTOR_MODE_STORAGE, m)
	} catch {
		/* ignore */
	}
}
