import { attachMathInput } from '../lib/math-input.js'

/**
 * WO-243: guiUrl/physicalPort fields for the `operator_gui` destination inspector — split out of
 * device-view-destinations-inspector-form.js to keep that file under the repo's ~500-line target
 * (mirrors the pixelmap fixture-array block's `field()`-helper pattern there).
 * @param {{ d: object, patchDestination: (id: string, patch: object) => void }} args
 * @returns {HTMLElement[]}
 */
export function buildOperatorGuiFields({ d, patchDestination }) {
	const field = (labelText, input) => {
		const wrap = Object.assign(document.createElement('div'), {
			style: 'display:flex; flex-direction:column; gap:4px; width:100%',
		})
		const lab = Object.assign(document.createElement('label'), {
			className: 'device-view__inspector-label',
			textContent: labelText,
			style: 'font-size:10px;opacity:.7',
		})
		wrap.append(lab, input)
		return wrap
	}

	const guiUrlIn = document.createElement('input')
	guiUrlIn.type = 'text'
	guiUrlIn.className = 'device-view__destinations-type'
	guiUrlIn.placeholder = 'http://127.0.0.1:4200/?cefOperator=1'
	guiUrlIn.value = String(d?.guiUrl || '')
	guiUrlIn.title = 'CEF web-UI URL (top layer 100) — must include ?cefOperator to render transparent preview holes'
	guiUrlIn.addEventListener('change', () => patchDestination(d.id, { guiUrl: String(guiUrlIn.value || '').trim() }))

	const physicalPortIn = document.createElement('input')
	physicalPortIn.type = 'number'
	physicalPortIn.min = '1'
	physicalPortIn.max = '4'
	physicalPortIn.step = '1'
	physicalPortIn.className = 'device-view__destinations-type'
	physicalPortIn.placeholder = '(auto)'
	physicalPortIn.value = d?.physicalPort != null ? String(d.physicalPort) : ''
	physicalPortIn.title = 'Explicit physical GPU port (1-4) for the operator monitor. Blank = auto-resolve (resolveOperatorMonitorPort).'
	physicalPortIn.addEventListener('change', () => {
		const raw = String(physicalPortIn.value || '').trim()
		const n = parseInt(raw, 10)
		patchDestination(d.id, { physicalPort: raw === '' ? null : (Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : null) })
	})
	attachMathInput(physicalPortIn, { decimals: 0 })

	const note = document.createElement('p')
	note.className = 'device-view__note'
	note.textContent =
		'Route layers (10-49) mirror routed compose preview cells; the CEF layer (100) plays this URL. Regenerate + restart Caspar to apply the channel/screen consumer.'

	return [field('CEF web-UI URL', guiUrlIn), field('Physical GPU port (optional)', physicalPortIn), note]
}
