/**
 * DMX fixture properties — mounted in main Inspector when Pixel Map tab is active.
 */

import { dmxState } from '../lib/dmx-state.js'

/**
 * @param {HTMLElement} root
 * @param {() => void} [onDraw] — e.g. pixel-map canvas redraw
 */
export function renderFixtureInspector(root, onDraw) {
	const fid = dmxState.selectedFixtureId
	const f = fid ? dmxState.getFixture(fid) : null
	root.innerHTML = ''

	if (!f) {
		const p = document.createElement('p')
		p.className = 'inspector-empty'
		p.textContent = 'Select a fixture on the canvas'
		root.appendChild(p)
		return
	}

	const title = document.createElement('div')
	title.className = 'inspector-title'
	title.textContent = f.id
	root.appendChild(title)

	const wrap = document.createElement('div')
	wrap.className = 'inspector-group'
	wrap.innerHTML = `
		<div class="inspector-field"><label class="inspector-field__label">Name</label><input type="text" class="inspector-field__input" id="fx-id" value="${escapeAttr(f.id)}"></div>
		<hr class="fixture-inspector__sep">
		<div class="inspector-field"><label class="inspector-field__label">Universe</label><input type="number" class="inspector-field__input" id="fx-uni" value="${f.universe}"></div>
		<div class="inspector-field"><label class="inspector-field__label">Start Ch</label><input type="number" class="inspector-field__input" id="fx-ch" value="${f.startChannel}"></div>
		<div class="inspector-field"><label class="inspector-field__label">Protocol</label>
			<select class="inspector-field__select" id="fx-prot">
				<option value="artnet"${f.protocol === 'artnet' ? ' selected' : ''}>Art-Net</option>
				<option value="sacn"${f.protocol === 'sacn' ? ' selected' : ''}>sACN</option>
			</select>
		</div>
		<div class="inspector-field"><label class="inspector-field__label">Destination</label><input type="text" class="inspector-field__input" id="fx-dest" value="${escapeAttr(f.destination)}"></div>
		<div class="inspector-field"><label class="inspector-field__label">Color order</label><input type="text" class="inspector-field__input" id="fx-order" value="${escapeAttr(f.colorOrder)}"></div>
		<hr class="fixture-inspector__sep">
		<div class="inspector-field"><label class="inspector-field__label">Source channel</label><input type="number" class="inspector-field__input" id="fx-src" value="${f.sourceChannel || 1}"></div>
		<div class="inspector-field"><label class="inspector-field__label">Grid cols</label><input type="number" class="inspector-field__input" id="fx-cols" value="${f.grid.cols}"></div>
		<div class="inspector-field"><label class="inspector-field__label">Grid rows</label><input type="number" class="inspector-field__input" id="fx-rows" value="${f.grid.rows}"></div>
		<div class="inspector-field"><label class="inspector-field__label">Brightness</label><input type="number" class="inspector-field__input" step="0.1" id="fx-bright" value="${f.brightness}"></div>
		<div class="inspector-field" style="margin-top:0.75rem">
			<button type="button" class="inspector-btn-sm" id="fx-delete" style="background:rgba(218,54,51,0.2);color:#f85149">Delete fixture</button>
		</div>
	`
	root.appendChild(wrap)

	const update = (key, val) => {
		const updates = {}
		if (key.includes('.')) {
			const [p, k] = key.split('.')
			updates[p] = { [k]: val }
		} else {
			updates[key] = val
		}
		dmxState.updateFixture(f.id, updates)
		onDraw?.()
	}

	wrap.querySelector('#fx-id').addEventListener('change', (e) => {
		const newId = String(e.target.value || '').trim()
		if (!newId || newId === f.id) return
		if (dmxState.getFixture(newId)) {
			e.target.value = f.id
			return
		}
		f.id = newId
		dmxState.fixtures = [...dmxState.fixtures]
		dmxState.setSelectedFixtureId(newId)
		void dmxState.flushSave()
		renderFixtureInspector(root, onDraw)
	})

	wrap.querySelector('#fx-uni').addEventListener('change', (e) => update('universe', parseInt(e.target.value, 10)))
	wrap.querySelector('#fx-ch').addEventListener('change', (e) => update('startChannel', parseInt(e.target.value, 10)))
	wrap.querySelector('#fx-prot').addEventListener('change', (e) => update('protocol', e.target.value))
	wrap.querySelector('#fx-dest').addEventListener('change', (e) => update('destination', e.target.value))
	wrap.querySelector('#fx-order').addEventListener('change', (e) => update('colorOrder', e.target.value))
	wrap.querySelector('#fx-src').addEventListener('change', (e) => update('sourceChannel', parseInt(e.target.value, 10)))
	wrap.querySelector('#fx-cols').addEventListener('change', (e) => update('grid.cols', parseInt(e.target.value, 10)))
	wrap.querySelector('#fx-rows').addEventListener('change', (e) => update('grid.rows', parseInt(e.target.value, 10)))
	wrap.querySelector('#fx-bright').addEventListener('change', (e) => update('brightness', parseFloat(e.target.value)))

	wrap.querySelector('#fx-delete').addEventListener('click', () => {
		if (!confirm('Delete this fixture?')) return
		dmxState.removeFixture(f.id)
		onDraw?.()
		renderFixtureInspector(root, onDraw)
	})
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

function escapeAttr(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
}
