import { api } from '../lib/api-client.js'

/**
 * WO-243/255: guiUrl/physicalPort fields + a Launch/Bring-to-front button for the `operator_gui`
 * destination inspector — split out of device-view-destinations-inspector-form.js to keep that
 * file under the repo's ~500-line target (mirrors the pixelmap fixture-array block's
 * `field()`-helper pattern there).
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
	guiUrlIn.placeholder = 'http://127.0.0.1:4200/?operatorGui=1'
	guiUrlIn.value = String(d?.guiUrl || '')
	guiUrlIn.title = 'Fullscreen Firefox web-UI URL — must include ?operatorGui (or legacy ?cefOperator) for the client bundle to enter operator mode'
	guiUrlIn.addEventListener('change', () => patchDestination(d.id, { guiUrl: String(guiUrlIn.value || '').trim() }))

	// A select with an explicit Auto entry: a bare number input read as "required" and gave no
	// way back to auto once a port was typed (the PATCH also swallowed null — fixed server-side).
	const physicalPortIn = document.createElement('select')
	physicalPortIn.className = 'device-view__destinations-type'
	const autoOpt = Object.assign(document.createElement('option'), {
		value: '',
		textContent: 'Auto (operator monitor, else multiview jack)',
	})
	physicalPortIn.appendChild(autoOpt)
	for (let n = 1; n <= 4; n++) {
		physicalPortIn.appendChild(Object.assign(document.createElement('option'), { value: String(n), textContent: `Port ${n}` }))
	}
	physicalPortIn.value = d?.physicalPort != null ? String(d.physicalPort) : ''
	physicalPortIn.title =
		'Physical GPU port for the operator-GUI window. Auto = the screen_N_operator_monitor flag (single connected display wins), falling back to the multiview jack — never a program screen.'
	physicalPortIn.addEventListener('change', () => {
		const raw = String(physicalPortIn.value || '').trim()
		const n = parseInt(raw, 10)
		patchDestination(d.id, { physicalPort: raw === '' ? null : (Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : null) })
	})

	const note = document.createElement('p')
	note.className = 'device-view__note'
	note.textContent =
		'Route layers (10-49) mirror routed compose/timeline/mv-edit preview cells, shaped above fullscreen Firefox via X SHAPE. Regenerate + restart Caspar to apply the channel/screen consumer.'

	// WO-255 T255.2: Launch (or raise, if already running) the fullscreen Firefox GUI process.
	const launchBtn = document.createElement('button')
	launchBtn.type = 'button'
	launchBtn.className = 'device-view__btn'
	launchBtn.textContent = 'Launch / Bring to front'
	const statusLine = document.createElement('p')
	statusLine.className = 'device-view__note'
	statusLine.style.minHeight = '1em'
	launchBtn.addEventListener('click', async () => {
		launchBtn.disabled = true
		statusLine.textContent = 'Launching...'
		try {
			const res = await api.post('/api/operator-gui/launch', {})
			if (res?.ok) {
				statusLine.textContent = res.action === 'raised' ? 'Brought to front.' : 'Launched.'
			} else {
				statusLine.textContent = `Failed: ${res?.reason || 'unknown error'}`
			}
		} catch (e) {
			statusLine.textContent = `Failed: ${e?.reason || e?.message || e}`
		} finally {
			launchBtn.disabled = false
		}
	})
	const launchWrap = Object.assign(document.createElement('div'), {
		style: 'display:flex; flex-direction:column; gap:4px; width:100%',
	})
	launchWrap.append(launchBtn, statusLine)

	return [field('Web-UI URL', guiUrlIn), field('Physical GPU port (optional)', physicalPortIn), note, launchWrap]
}
