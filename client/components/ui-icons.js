/**
 * Tiny shared inline-SVG icons (fill: currentColor) for controls that previously used glyph
 * characters (⏸ 👁 ⟲ …). The box has no emoji/symbol font — those codepoints fall back to
 * DejaVu Sans (crude shapes like "|<") or tofu boxes in the operator kiosk Firefox. Inline SVG
 * renders identically everywhere. 24×24 viewBox; size via the CSS class you pass in.
 */

const SVG = (cls, inner, filled = true) =>
	`<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${
		filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"'
	} aria-hidden="true">${inner}</svg>`

const PATHS = {
	toStart: ['<path d="M6 5h2.5v14H6z"/><path d="M20 5v14l-10.5-7z"/>', true],
	toEnd: ['<path d="M15.5 5H18v14h-2.5z"/><path d="M4 5v14l10.5-7z"/>', true],
	play: ['<path d="M7 4.5v15l13-7.5z"/>', true],
	pause: ['<path d="M7 5h3.5v14H7z"/><path d="M13.5 5H17v14h-3.5z"/>', true],
	stop: ['<rect x="6" y="6" width="12" height="12" rx="1"/>', true],
	reset: [
		'<path d="M12 5a7 7 0 1 0 7 7h-2a5 5 0 1 1-5-5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5 17 5l-5 3.5z"/>',
		true,
	],
	eye: [
		'<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2" fill="var(--bg-elevated, #21262d)"/>',
		true,
	],
	eyeOff: [
		'<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" opacity="0.35"/><path d="M4 3l17 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
		true,
	],
	plus: ['<path d="M11 4h2v16h-2z"/><path d="M4 11h16v2H4z"/>', true],
	timer: [
		'<circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 2h6v2H9z"/>',
		true,
	],
}

/**
 * @param {keyof typeof PATHS | string} name
 * @param {string} [cls] - CSS class for sizing (default .ui-icon: 1em square, see styles)
 * @returns {string} inline SVG markup ('' for unknown names)
 */
export function uiIcon(name, cls = 'ui-icon') {
	const def = PATHS[name]
	if (!def) return ''
	return SVG(cls, def[0], def[1])
}
