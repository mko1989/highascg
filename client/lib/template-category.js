/**
 * WO-661 — the Sources Templates tab in three groups: Templates, Lower thirds, Shaders (owner 21.10). Kind comes from
 * the Caspar TLS path: `shaders/sh-*` = Shader FX export (WO-266), `lower-thirds/lt-*` or `studio/lt-*` = CG Studio
 * lower third (WO-265; studio exports were shown as plain templates before), anything else = template.
 * Godot twin: godot/client/features/live/source_lists_model.gd.
 */

export const TEMPLATE_GROUPS = [
	{ id: 'templates', title: 'Templates' },
	{ id: 'lower_thirds', title: 'Lower thirds' },
	{ id: 'shaders', title: 'Shaders' },
]

/** @param {string} id Caspar TLS id @returns {'templates' | 'lower_thirds' | 'shaders'} */
export function templateCategory(id) {
	const p = String(id || '').toLowerCase().replace(/\\/g, '/')
	if (/(^|\/)shaders\/sh-[a-z0-9-]+$/.test(p)) return 'shaders'
	if (/(^|\/)(lower-thirds|lower_thirds|studio)\/lt-/.test(p)) return 'lower_thirds'
	return 'templates'
}

/**
 * GET /api/shaders `gpu` ({ running, setting }) → the warning shown on shaders, '' when Caspar renders WebGL.
 * `running` null = Caspar's INFO CONFIG not gathered yet → trust the setting.
 * @param {{ running?: boolean | null, setting?: boolean } | null | undefined} gpu
 */
export function shaderGpuWarning(gpu) {
	if (!gpu) return ''
	if (gpu.running === true) return ''
	if (gpu.running == null && gpu.setting === true) return ''
	if (gpu.setting === true) return 'GPU acceleration is on in settings, but CasparCG is still running without it: apply the Caspar config and restart Caspar. Until then shaders render nothing on air.'
	return 'GPU acceleration is off in CasparCG, so shaders render nothing on air (they need WebGL). Turn on "Enable GPU in CEF templates" in Devices → Caspar server, then apply and restart Caspar.'
}
