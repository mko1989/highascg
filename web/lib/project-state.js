/**
 * Project state — aggregate export/import for dashboard, timelines, multiview.
 * Save/load via DATA STORE (server) or file download/upload.
 * @see main_plan.md Prompt 20
 */

const STORAGE_KEY = 'casparcg_project_name'
const PROJECT_VERSION = 1
const SERVER_STORE_NAME = 'casparcg_web_project'

export class ProjectState {
	constructor(options = {}) {
		this.projectName = ''
		this._listeners = new Map()
		this._loadName()
	}

	_loadName() {
		try {
			const name = localStorage.getItem(STORAGE_KEY)
			if (name && typeof name === 'string') this.projectName = name
		} catch {}
	}

	_persistName() {
		try {
			localStorage.setItem(STORAGE_KEY, this.projectName)
		} catch {}
		this._emit('change')
	}

	setProjectName(name) {
		this.projectName = String(name || '').trim()
		this._persistName()
	}

	getProjectName() {
		return this.projectName
	}

	on(key, fn) {
		if (!this._listeners.has(key)) this._listeners.set(key, [])
		this._listeners.get(key).push(fn)
		return () => {
			const fns = this._listeners.get(key)
			if (fns) {
				const i = fns.indexOf(fn)
				if (i >= 0) fns.splice(i, 1)
			}
		}
	}

	_emit(key) {
		const fns = this._listeners.get(key)
		if (fns) fns.forEach((fn) => fn())
	}

	/**
	 * Build project JSON from scenes/looks, timelines, multiview (and legacy dashboard if present).
	 * @param {object} sceneState
	 * @param {object} timelineState
	 * @param {object} multiviewState
	 * @param {object} [dashboardState] - optional legacy Millumin-style dashboard
	 */
	exportProject(sceneState, timelineState, multiviewState, dashboardState) {
		const scenes = sceneState?.getExportData?.() ?? null
		const dashboard = dashboardState?.getExportData?.() ?? null
		const timelines = timelineState?.getExportData?.() ?? null
		const multiview = multiviewState?.getExportData?.() ?? null
		return {
			version: PROJECT_VERSION,
			name: this.projectName || 'Untitled',
			savedAt: new Date().toISOString(),
			scenes,
			dashboard,
			timelines,
			multiview,
		}
	}

	/**
	 * Apply project data to scene state, timelines, multiview, optional legacy dashboard.
	 * @param {object} data - Project JSON
	 * @param {object} sceneState
	 * @param {object} timelineState
	 * @param {object} multiviewState
	 * @param {object} [dashboardState]
	 */
	importProject(data, sceneState, timelineState, multiviewState, dashboardState) {
		if (!data || typeof data !== 'object') return false
		const name = data.name
		if (name) this.setProjectName(name)
		if (data.scenes && sceneState?.loadFromData) sceneState.loadFromData(data.scenes)
		if (data.dashboard && dashboardState?.loadFromData) dashboardState.loadFromData(data.dashboard)
		if (data.timelines && timelineState?.loadFromData) timelineState.loadFromData(data.timelines)
		if (data.multiview && multiviewState?.loadFromData) multiviewState.loadFromData(data.multiview)
		this._emit('imported')
		return true
	}
}

export const projectState = new ProjectState()
export { SERVER_STORE_NAME }
export default ProjectState
