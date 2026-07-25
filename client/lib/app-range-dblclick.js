/**
 * Reset a range input to its default value on double-click.
 */
export function initRangeInputDblclickReset() {
	document.addEventListener('dblclick', (ev) => {
		const target = ev.target
		if (target && target.tagName === 'INPUT' && target.type === 'range') {
			ev.preventDefault()
			ev.stopPropagation()
			const attrVal = target.getAttribute('value')
			const defVal = attrVal !== null ? attrVal : (target.defaultValue !== undefined ? target.defaultValue : '')
			let val = defVal
			if (val === '') {
				if (target.id === 'cable-messiness') {
					val = '0'
				} else if (target.min === '0.5' && target.max === '3') {
					val = '1'
				} else {
					const min = parseFloat(target.min) || 0
					const max = parseFloat(target.max) || 100
					val = String(min + (max - min) / 2)
				}
			}
			target.value = val
			target.dispatchEvent(new Event('input', { bubbles: true }))
			target.dispatchEvent(new Event('change', { bubbles: true }))
		}
	})
}
