import { getResolutionForScreen } from './inspector-channel-resolution.js'

/**
 * @param {HTMLElement} root
 * @param {import('../lib/state-store.js').StateStore} stateStore
 * @param {() => import('../lib/scene-state.js').GlobalBorderConfig | null | undefined} gbNow
 * @param {(patch: object) => void} patchGlobalBorder
 */
export function appendGlobalBorderSlicesSection(root, stateStore, gbNow, patchGlobalBorder) {
	const slicesGrp = document.createElement('div')
	slicesGrp.className = 'inspector-group'
	slicesGrp.innerHTML = '<div class="inspector-group__title">Slices (Multi-segment physical layout)</div>'
	const slicesBody = document.createElement('div')
	slicesBody.className = 'inspector-effect-card__params'
	slicesBody.style.display = 'flex'
	slicesBody.style.flexDirection = 'column'
	slicesBody.style.gap = '10px'

	const res = getResolutionForScreen(stateStore)

	const sliceBtns = document.createElement('div')
	sliceBtns.style.display = 'flex'
	sliceBtns.style.gap = '8px'
	sliceBtns.style.marginTop = '4px'

	const addBtn = document.createElement('button')
	addBtn.type = 'button'
	addBtn.className = 'scenes-btn scenes-btn--sm'
	addBtn.textContent = '+ Add Slice'
	addBtn.addEventListener('click', () => {
		const currentSlices = gbNow()?.slices || []
		patchGlobalBorder({ slices: [...currentSlices, { x: 0, y: 0, w: 0.5, h: 1 }] })
		renderSliceRows()
	})

	const fullBtn = document.createElement('button')
	fullBtn.type = 'button'
	fullBtn.className = 'scenes-btn scenes-btn--sm'
	fullBtn.textContent = 'Full Canvas'
	fullBtn.title = 'Reset to full screen border'
	fullBtn.addEventListener('click', () => {
		patchGlobalBorder({ slices: [] })
		renderSliceRows()
	})

	sliceBtns.appendChild(addBtn)
	sliceBtns.appendChild(fullBtn)
	slicesBody.appendChild(sliceBtns)

	function appendSliceRow(s, idx) {
		const row = document.createElement('div')
		row.className = 'inspector-slice-row'
		row.style.display = 'flex'
		row.style.alignItems = 'center'
		row.style.gap = '6px'
		row.style.background = 'rgba(255,255,255,0.03)'
		row.style.padding = '6px'
		row.style.borderRadius = '4px'

		const createInput = (key, label, val, maxRes) => {
			const w = document.createElement('div')
			w.style.display = 'flex'
			w.style.flexDirection = 'column'
			w.style.gap = '2px'
			const l = document.createElement('label')
			l.style.fontSize = '0.65rem'
			l.style.color = 'var(--text-muted)'
			l.textContent = label
			const i = document.createElement('input')
			i.type = 'number'
			i.className = 'inspector-field__input'
			i.style.width = '52px'
			i.style.padding = '2px 4px'
			i.min = 0
			i.max = maxRes
			i.value = Math.round(val * maxRes)
			i.addEventListener('change', () => {
				const currentSlices = gbNow()?.slices || []
				const next = [...currentSlices]
				if (next[idx]) {
					next[idx] = {
						...next[idx],
						[key]: Math.max(0, Math.min(maxRes, parseFloat(i.value) || 0)) / maxRes,
					}
					patchGlobalBorder({ slices: next })
				}
			})
			w.appendChild(l)
			w.appendChild(i)
			return w
		}

		row.appendChild(createInput('x', 'X(px)', s.x ?? 0, res.w))
		row.appendChild(createInput('y', 'Y(px)', s.y ?? 0, res.h))
		row.appendChild(createInput('w', 'W(px)', s.w ?? 1, res.w))
		row.appendChild(createInput('h', 'H(px)', s.h ?? 1, res.h))

		const del = document.createElement('button')
		del.type = 'button'
		del.className = 'scenes-btn scenes-btn--sm scenes-btn--danger'
		del.style.marginLeft = 'auto'
		del.style.padding = '2px 6px'
		del.textContent = '×'
		del.title = 'Remove slice'
		del.addEventListener('click', () => {
			const currentSlices = gbNow()?.slices || []
			patchGlobalBorder({ slices: currentSlices.filter((_, i) => i !== idx) })
			renderSliceRows()
		})
		row.appendChild(del)
		slicesBody.insertBefore(row, sliceBtns)
	}

	function renderSliceRows() {
		slicesBody.querySelectorAll('.inspector-slice-row').forEach((el) => el.remove())
		slicesBody.querySelectorAll('.inspector-field--hint').forEach((el) => el.remove())
		const slices = gbNow()?.slices || []
		if (slices.length === 0) {
			const empty = document.createElement('div')
			empty.className = 'inspector-field inspector-field--hint'
			empty.textContent = 'No slices defined. Defaulting to full canvas (0,0 100×100).'
			slicesBody.insertBefore(empty, sliceBtns)
		}
		slices.forEach((s, idx) => appendSliceRow(s, idx))
	}

	renderSliceRows()
	slicesGrp.appendChild(slicesBody)
	root.appendChild(slicesGrp)
}
