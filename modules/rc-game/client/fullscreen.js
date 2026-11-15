/* global document, window */
/**
 * Full-screen button of the RC game page (WO-1074, owner 15.11: "need a fullscreen button on the client game
 * browser"). A phone browser otherwise keeps its address bar over a landscape race. Standard Fullscreen API with the
 * webkit names as fallback; where the browser has neither (iPhone Safari) no button is made at all. Going full screen
 * also asks for a landscape lock (Android honours it only in full screen), so the "turn your phone" card goes away.
 */

/** @param {{ doc?: Document, screen?: Screen }} [o] injected for tests */
export function createFullscreen({ doc = document, screen = window.screen } = {}) {
	const root = doc.documentElement
	const enter = root.requestFullscreen || root.webkitRequestFullscreen
	const leave = doc.exitFullscreen || doc.webkitExitFullscreen
	const supported =
		typeof enter === 'function' &&
		typeof leave === 'function' &&
		doc.fullscreenEnabled !== false &&
		doc.webkitFullscreenEnabled !== false
	const active = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement)
	return {
		supported,
		get active() {
			return active()
		},
		/** Must run inside a user gesture. Never throws; resolves to the state after the attempt. */
		async toggle() {
			if (!supported) return false
			try {
				if (active()) {
					screen?.orientation?.unlock?.()
					await leave.call(doc)
				} else {
					await enter.call(root, { navigationUI: 'hide' })
					await screen?.orientation?.lock?.('landscape')?.catch?.(() => {}) // desktop / iPad: not supported, fine
				}
			} catch {
				/* refused (no gesture, embedded without permission): the button simply stays as it was */
			}
			return active()
		},
		onChange(fn) {
			doc.addEventListener('fullscreenchange', fn)
			doc.addEventListener('webkitfullscreenchange', fn)
		},
	}
}

/**
 * One full-screen toggle button (icon drawn in CSS: no font glyph, no SVG namespace URL — the page holds no URL at all), or null where the browser cannot do it. Several may
 * exist (toolbar, join form, lobby): each follows the page's real state.
 * @param {string} [cls] extra class names, e.g. 'tool' or 'ghost sq'
 */
export function fullscreenButton(cls = 'tool', fs = createFullscreen()) {
	if (!fs.supported) return null
	const el = document.createElement('button')
	el.type = 'button'
	el.className = `fs-btn ${cls}`
	const ico = document.createElement('span')
	ico.className = 'fs-ico'
	ico.setAttribute('aria-hidden', 'true')
	el.append(ico)
	const paint = () => {
		const on = fs.active
		const label = on ? 'Leave full screen' : 'Full screen'
		el.title = label
		el.setAttribute('aria-label', label)
		el.classList.toggle('on', on)
	}
	el.addEventListener('click', async (e) => {
		e.preventDefault()
		el.blur()
		await fs.toggle()
		paint()
	})
	fs.onChange(paint)
	paint()
	return el
}
