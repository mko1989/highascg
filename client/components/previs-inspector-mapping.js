/**
 * Screen mapping and UV editor rendering for the Previs Inspector.
 */
import { computeScreenUV } from '../lib/previs-uv-mapper.js'
import { mountPrevisUvEditor } from './previs-uv-editor.js'

export function renderMappingSection(container, opts, { PANEL_CLASS, EMPTY_CLASS }) {
	if (container._previsUvEditorDispose) container._previsUvEditorDispose(); container.replaceChildren()
	const uuid = opts.getSelectedMeshUuid?.(); if (!uuid) { container.appendChild(Object.assign(document.createElement('div'), { className: EMPTY_CLASS, textContent: 'Select a tagged screen mesh to see mapping.' })); return }
	let summary = null; try { summary = opts.getScreenMappingSummary(uuid) } catch {}
	if (!summary) { container.appendChild(Object.assign(document.createElement('div'), { className: EMPTY_CLASS, textContent: 'Mapping data unavailable.' })); return }
	const ui = opts.state.getUI(); const vc = summary.virtualCanvas || { width: ui.virtualCanvasWidth, height: ui.virtualCanvasHeight }
	const line = (txt) => container.appendChild(Object.assign(document.createElement('div'), { className: `${PANEL_CLASS}__mapping-line`, textContent: txt }))
	line(`Virtual canvas: ${vc.width}×${vc.height} px`); const vp = summary.videoPixels
	line(vp ? `Video: ${vp.width}×${vp.height} px · ${summary.videoLive ? 'live' : 'waiting'}` : 'Video: waiting stream…')
	const mw = summary.meshWorld; if (mw) line(`Mesh: ${mw.widthM.toFixed(2)} × ${mw.heightM.toFixed(2)} m (~${summary.meshAspect?.toFixed(2)}:1)`)
	const crop = summary.canvasRegion || { canvasX: 0, canvasY: 0, canvasWidth: vc.width, canvasHeight: vc.height }
	if (mw && vc.width > 0) {
		try { const uv = computeScreenUV({ ...crop, worldWidth: mw.widthM, worldHeight: mw.heightM }, vp, vc)
		line(`UV: u ${uv.uvs.uLeft.toFixed(3)}…${uv.uvs.uRight.toFixed(3)} · v ${uv.uvs.vBottom.toFixed(3)}…${uv.uvs.vTop.toFixed(3)}`) } catch {}
	}
	if (mw && opts.onCanvasRegionLive && vc.width > 0) {
		const ed = mountPrevisUvEditor({ virtualCanvas: vc, region: crop, onLiveChange: r => opts.onCanvasRegionLive(uuid, r), onCommit: r => opts.onCanvasRegionCommit(uuid, r), onReset: opts.onCanvasRegionReset ? () => opts.onCanvasRegionReset(uuid) : undefined })
		container.appendChild(ed.el); container._previsUvEditorDispose = () => ed.dispose()
	}
}
