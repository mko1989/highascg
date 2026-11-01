/**
 * WO-919 — the web client follows the server's active show, like the Godot client (WO-918 F27, core/project_sync.gd).
 *
 * Autosaves carry `editingSlug` (the show this tab edits). When another client or an API Load switched shows, the
 * server refuses the stale write (409 `not_active`) instead of saving the old show over the new one or switching the
 * box back; the tab then pulls the active show. A `project.activated` broadcast for another slug does the same
 * up-front, so the tab never keeps editing a show the server closed.
 */

import { api } from './api-client.js'
import { showAppToast } from './app-toast.js'

let _following = null

/**
 * Pull the server's active show into this tab (silent import: listeners must not write it back).
 * @param {{ projectState: object, sceneState: object, timelineState: object, multiviewState: object, programOutputState?: object }} s
 * @returns {Promise<boolean>}
 */
export function followServerProject(s) {
	if (_following) return _following
	_following = (async () => {
		try {
			const project = await api.get('/api/project')
			if (!project || typeof project !== 'object' || !project.version) return false
			s.projectState.importProject(project, s.sceneState, s.timelineState, s.multiviewState, s.programOutputState, { silent: true })
			if (project.slug) s.projectState.setProjectSlug(project.slug)
			window.dispatchEvent(new CustomEvent('project-loaded', { detail: { remote: true } }))
			try {
				showAppToast(`The server switched to "${project.name || project.slug}" — this tab follows`, 'warn')
			} catch {
				/* the toast is advisory — the show is already adopted */
			}
			return true
		} catch (e) {
			console.warn('[HighAsCG] could not follow the server show:', e?.message || e)
			return false
		} finally {
			_following = null
		}
	})()
	return _following
}

/** The autosave body: the project plus the slug this tab edits (absent until the server named one). */
export function autosaveBody(project, projectState) {
	const editingSlug = projectState.getProjectSlug?.() || ''
	return editingSlug ? { project, editingSlug } : { project }
}

/** True when a `project.activated` change names a show other than the one this tab edits. */
export function activatedElsewhere(value, projectState) {
	const slug = value && typeof value === 'object' ? String(value.slug || '') : ''
	const mine = projectState.getProjectSlug?.() || ''
	return !!slug && !!mine && slug !== mine
}
