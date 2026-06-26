/**
 * Project state — aggregate export/import for scenes, timelines, multiview, program output strip.
 * Save/load via DATA STORE (server) or file download/upload.
 * @see main_plan.md Prompt 20
 */

const STORAGE_KEY = 'casparcg_project_name'
const PROJECT_VERSION = 2
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
	 * Build project JSON from scenes/looks, timelines, multiview, program-output mixer strip.
	 * @param {object} sceneState
	 * @param {object} timelineState
	 * @param {object} multiviewState
	 * @param {object} [programOutputState]
	 */
	exportProject(sceneState, timelineState, multiviewState, programOutputState) {
		const scenes = sceneState?.getExportData?.() ?? null
		const programOutput = programOutputState?.getExportData?.() ?? null
		const timelines = timelineState?.getExportData?.() ?? null
		const multiview = multiviewState?.getExportData?.() ?? null
		const placeholders = window.placeholderState?.getExportData?.() ?? null
		return {
			version: PROJECT_VERSION,
			name: this.projectName || 'Untitled',
			savedAt: new Date().toISOString(),
			scenes,
			programOutput,
			timelines,
			multiview,
			placeholders,
		}
	}

	/**
	 * Apply project data to scene state, timelines, multiview, program output strip.
	 * @param {object} data - Project JSON
	 * @param {object} sceneState
	 * @param {object} timelineState
	 * @param {object} multiviewState
	 * @param {object} [programOutputState]
	 * @param {{ silent?: boolean }} [opts] - when true, persist locally without outbound change events
	 */
	importProject(data, sceneState, timelineState, multiviewState, programOutputState, opts = {}) {
		if (!data || typeof data !== 'object') return false
		const silent = !!opts.silent
		const name = data.name
		if (name) this.setProjectName(name)
		if (data.scenes && sceneState?.loadFromData) sceneState.loadFromData(data.scenes, { silent })
		const po = data.programOutput || data.dashboard
		if (po && programOutputState?.loadFromData) programOutputState.loadFromData(po, { silent })
		if (data.timelines && timelineState?.loadFromData) timelineState.loadFromData(data.timelines, { silent })
		if (data.multiview && multiviewState?.loadFromData) multiviewState.loadFromData(data.multiview, { silent })
		if (data.placeholders && window.placeholderState?.loadFromData) window.placeholderState.loadFromData(data.placeholders)
		this._emit('imported')
		return true
	}
}

export const projectState = new ProjectState()
export { SERVER_STORE_NAME }
export default ProjectState
