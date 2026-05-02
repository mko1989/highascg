/**
 * Previs mesh inspector (WO-17 T3.1).
 */
import { PREVIS_STATE_EVENTS } from '../lib/previs-state.js'
import * as Sections from './previs-inspector-sections.js'
import * as Mapping from './previs-inspector-mapping.js'

const PANEL_CLASS = 'previs-pgm-3d-inspector'; const SECTION_CLASS = `${PANEL_CLASS}__section`; const SECTION_HEADER_CLASS = `${PANEL_CLASS}__section-header`; const SECTION_BODY_CLASS = `${PANEL_CLASS}__body`; const ROW_CLASS = `${PANEL_CLASS}__row`; const ROW_TAGGED_MOD = `${PANEL_CLASS}__row--tagged`; const LABEL_CLASS = `${PANEL_CLASS}__label`; const LABEL_ACTIVE_MOD = `${PANEL_CLASS}__label--active`; const EMPTY_CLASS = `${PANEL_CLASS}__empty`; const BTN_CLASS = `${PANEL_CLASS}__btn`; const BTN_GHOST_MOD = `${PANEL_CLASS}__btn--ghost`; const SELECT_CLASS = `${PANEL_CLASS}__select`; const INPUT_CLASS = `${PANEL_CLASS}__input`; const PRESET_ROW_CLASS = `${PANEL_CLASS}__preset-row`; const SAVE_ROW_CLASS = `${PANEL_CLASS}__save-row`
const CSS_VARS = { PANEL_CLASS, SECTION_CLASS, SECTION_HEADER_CLASS, SECTION_BODY_CLASS, ROW_CLASS, ROW_TAGGED_MOD, LABEL_CLASS, LABEL_ACTIVE_MOD, EMPTY_CLASS, BTN_CLASS, BTN_GHOST_MOD, SELECT_CLASS, INPUT_CLASS, PRESET_ROW_CLASS, SAVE_ROW_CLASS }

export function createPrevisMeshInspector(opts) {
	const panel = document.createElement('div'); panel.className = PANEL_CLASS
	const build = (l) => { const s = document.createElement('section'); s.className = SECTION_CLASS; const h = document.createElement('div'); h.className = SECTION_HEADER_CLASS; h.textContent = l; const b = document.createElement('div'); b.className = SECTION_BODY_CLASS; s.append(h, b); return { el: s, body: b } }
	const savedS = build('Saved models'); const meshS = build('Current model — meshes'); const mapS = opts.getScreenMappingSummary ? build('Screen mapping') : null; const camS = build('Cameras'); const pipeS = opts.getStreamStatuses ? build('Video streams') : null; const dispS = build('Display')
	panel.append(savedS.el, meshS.el); if (mapS) panel.append(mapS.el); panel.append(camS.el); if (pipeS) panel.append(pipeS.el); panel.append(dispS.el)

	const refresh = () => { if (destroyed) return; Sections.renderSavedModels(savedS.body, opts, CSS_VARS); Sections.renderMeshList(meshS.body, opts, CSS_VARS); if (mapS) Mapping.renderMappingSection(mapS.body, opts, CSS_VARS); Sections.renderCameraPresets(camS.body, opts, CSS_VARS); if (pipeS) renderPipeline(pipeS.body, opts); renderDisplayState(dispS.body, opts) }
	const refreshPipe = () => { if (!destroyed && pipeS) renderPipeline(pipeS.body, opts) }; const refreshMap = () => { if (!destroyed && mapS) Mapping.renderMappingSection(mapS.body, opts, CSS_VARS) }
	const unsub = opts.state.on(PREVIS_STATE_EVENTS.CHANGE, refresh); const unsubU = mapS ? opts.state.on(PREVIS_STATE_EVENTS.UI, refreshMap) : null
	let destroyed = false; refresh()

	for (const key of ['grid', 'axes', 'wireframe']) {
		const row = document.createElement('label'); row.className = ROW_CLASS; const inp = Object.assign(document.createElement('input'), { type: 'checkbox' }); inp.dataset.key = key
		inp.onchange = () => { opts.state.setUI({ [key]: inp.checked }); try { const t = opts.getSceneToggles?.() || {}; if (key === 'grid' && t.grid) t.grid.visible = inp.checked; if (key === 'axes' && t.axes) t.axes.visible = inp.checked; if (key === 'wireframe' && t.setWireframe) t.setWireframe(inp.checked) } catch {} }
		row.append(inp, Object.assign(document.createElement('span'), { className: LABEL_CLASS, textContent: key === 'grid' ? 'Ground grid' : key === 'axes' ? 'World axes' : 'Wireframe' })); dispS.body.appendChild(row)
	}

	function renderPipeline(container, opts) { container.replaceChildren(); try { for (const row of opts.getStreamStatuses() || []) { const r = document.createElement('div'); r.className = `${ROW_CLASS} ${PANEL_CLASS}__row--pipeline`; const b = document.createElement('span'); b.className = `${PANEL_CLASS}__pipeline-badge`; b.textContent = !row.acquired ? 'unused' : (row.live ? 'live' : 'waiting'); r.append(Object.assign(document.createElement('span'), { className: LABEL_CLASS, textContent: row.label || row.id }), b); container.appendChild(r) } } catch {} }
	function renderDisplayState(container, opts) { const ui = opts.state.getUI(); for (const i of container.querySelectorAll('input[type="checkbox"]')) { const k = i.dataset.key; if (k && k in ui && i.checked !== !!ui[k]) i.checked = !!ui[k] } }

	return { el: panel, refresh, refreshPipeline: refreshPipe, refreshMapping: refreshMap, destroy: () => { if (destroyed) return; destroyed = true; unsub(); unsubU?.(); panel.remove() } }
}
