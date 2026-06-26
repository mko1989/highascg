import { buildCasparTemplateHtml, extractLtGraphicFromEditor } from '../../../lib/cg-studio-caspar-export.js'
import { normalizeLtTemplateId } from '../../../lib/cg-studio-lt-presets.js'

/**
 * @param {import('grapesjs').Editor} editor
 * @param {{
 *   nameInp: HTMLInputElement,
 *   animSel: HTMLSelectElement,
 *   statusSpan: HTMLElement,
 *   saveBtn: HTMLButtonElement,
 *   loadSel: HTMLSelectElement,
 *   loadOpt: HTMLOptionElement,
 *   seedLowerThirdScaffold: () => void,
 *   findGraphicComponent: () => object | null,
 * }} ctx
 */
export function createTemplatePersistence(editor, ctx) {
	const { nameInp, animSel, statusSpan, saveBtn, loadSel, loadOpt, seedLowerThirdScaffold, findGraphicComponent } = ctx

	async function refreshLoadList() {
		try {
			const res = await fetch('/api/cg-studio/templates')
			if (!res.ok) return
			const data = await res.json()
			loadSel.replaceChildren(loadOpt.cloneNode(true))
			for (const t of data.templates || []) {
				const opt = document.createElement('option')
				opt.value = t.id
				opt.textContent = t.name || t.id
				loadSel.appendChild(opt)
			}
		} catch {
			/* dev API optional */
		}
	}

	async function loadTemplateById(id) {
		if (!id) return
		statusSpan.textContent = 'Loading…'
		try {
			const res = await fetch(`/api/cg-studio/load/${encodeURIComponent(id)}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const project = await res.json()
			if (project.projectData) {
				editor.loadProjectData(project.projectData)
			} else {
				seedLowerThirdScaffold()
				const graphic = findGraphicComponent()
				if (graphic && project.graphicHtml) {
					graphic.components(project.graphicHtml)
				}
			}
			if (project.animationPreset) animSel.value = project.animationPreset
			nameInp.value = String(project.name || id).replace(/^lt-/, '')
			statusSpan.textContent = `Loaded ${id}`
			setTimeout(() => {
				statusSpan.textContent = ''
			}, 2500)
		} catch (err) {
			statusSpan.textContent = `Load failed: ${err?.message || err}`
		}
	}

	async function saveTemplate() {
		const tplName = normalizeLtTemplateId(nameInp.value.trim())
		if (!tplName || tplName === 'lt-') {
			statusSpan.textContent = 'Enter a template name'
			return
		}
		nameInp.value = tplName.replace(/^lt-/, '')
		saveBtn.disabled = true
		statusSpan.textContent = 'Saving…'
		try {
			const projectData = editor.getProjectData()
			const { graphicHtml, css } = extractLtGraphicFromEditor(editor)
			const animationPreset = animSel.value || 'fade'
			const { html: casparHtml, projectJson, templateId, htmlPath } = buildCasparTemplateHtml({
				name: tplName,
				html: graphicHtml,
				css,
				projectData,
				animationPreset,
			})

			const res = await fetch('/api/cg-studio/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: templateId,
					html: graphicHtml,
					css,
					projectData,
					animationPreset,
					casparHtml,
					projectJson,
				}),
			})
			if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
			const out = await res.json().catch(() => ({}))
			statusSpan.textContent = out.path ? `Saved → ${out.path}` : `Saved ${templateId} (${htmlPath})`
			void refreshLoadList()
			setTimeout(() => {
				statusSpan.textContent = ''
			}, 5000)
		} catch (err) {
			console.error('[cg-studio] save failed:', err)
			statusSpan.textContent = `Error: ${err && err.message ? err.message : err}`
		} finally {
			saveBtn.disabled = false
		}
	}

	return { refreshLoadList, loadTemplateById, saveTemplate }
}
