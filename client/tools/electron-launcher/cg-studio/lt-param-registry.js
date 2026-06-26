/**
 * Lower-thirds inspector field definitions for CG Studio.
 */

'use strict'

const DEFAULT_DATA = {
	title: 'Name',
	subtitle: 'Title',
}

const DEFAULT_STYLE = {
	primaryColor: 'lightblue',
	textColor: '#ffffff',
	position: 'left',
	marginX: 77,
	marginY: 43,
	opacity: 1,
	titleFontSize: '',
	subtitleFontSize: '',
	titleFontWeight: '700',
	letterSpacing: '',
	textTransform: 'none',
	displayDurationSec: 10,
	speed: 1,
	customFont: '',
}

const DATA_FIELDS = [
	{ key: 'title', label: 'Title / name line', type: 'text', hint: 'Primary line (maps to f0 / title)' },
	{ key: 'subtitle', label: 'Subtitle / role line', type: 'text', hint: 'Secondary line (maps to f1 / subtitle)' },
	{ key: 'name', label: 'Name (alt)', type: 'text', hint: 'Optional Caspar field alias' },
	{ key: 'role', label: 'Role (alt)', type: 'text', hint: 'Optional Caspar field alias' },
	{ key: 'f0', label: 'f0 (Caspar)', type: 'text', hint: 'Raw Caspar component f0' },
	{ key: 'f1', label: 'f1 (Caspar)', type: 'text', hint: 'Raw Caspar component f1' },
]

const COLOR_FIELDS = [
	{ key: 'primaryColor', label: 'Primary / accent', type: 'color' },
	{ key: 'textColor', label: 'Text color', type: 'color' },
]

const TYPOGRAPHY_FIELDS = [
	{ key: 'titleFontSize', label: 'Title size (px)', type: 'number', min: 12, max: 120, step: 1, placeholder: 'template default' },
	{ key: 'subtitleFontSize', label: 'Subtitle size (px)', type: 'number', min: 10, max: 80, step: 1, placeholder: 'template default' },
	{ key: 'titleFontWeight', label: 'Title weight', type: 'select', options: ['300', '400', '500', '600', '700', '800', '900'] },
	{ key: 'letterSpacing', label: 'Letter spacing', type: 'text', placeholder: 'e.g. 0.05em' },
	{ key: 'textTransform', label: 'Text transform', type: 'select', options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
]

const LAYOUT_FIELDS = [
	{
		key: 'position',
		label: 'Horizontal position',
		type: 'select',
		options: ['left', 'center', 'right'],
	},
	{ key: 'marginX', label: 'Side margin (px)', type: 'number', min: 0, max: 400, step: 1 },
	{ key: 'marginY', label: 'Bottom margin (px)', type: 'number', min: 0, max: 400, step: 1 },
	{ key: 'opacity', label: 'Graphic opacity', type: 'range', min: 0, max: 1, step: 0.05 },
]

const ANIMATION_FIELDS = [
	{ key: 'speed', label: 'Animation speed', type: 'number', min: 0.1, max: 5, step: 0.1 },
	{ key: 'displayDurationSec', label: 'On-air duration (s)', type: 'number', min: 0, max: 120, step: 1, hint: '0 = hold until manual stop' },
	{ key: 'customFont', label: 'Custom font file', type: 'text', placeholder: 'filename in template/fonts/' },
]

/** @type {Record<string, Array<object>>} */
const TEMPLATE_EXTRAS = {
	'lt-gradient-wave': [
		{ key: 'gradientMid', label: 'Gradient mid', type: 'color' },
		{ key: 'gradientEnd', label: 'Gradient end', type: 'color' },
	],
	'lt-split-color': [
		{ key: 'panelColor', label: 'Left panel color', type: 'color' },
	],
	'lt-frosted-glass': [
		{ key: 'blurAmount', label: 'Glass blur (px)', type: 'number', min: 0, max: 40, step: 1 },
	],
}

/**
 * @param {string} [templateId]
 * @returns {{ data: object[], colors: object[], typography: object[], layout: object[], animation: object[], template: object[] }}
 */
function getFieldsForTemplate(templateId) {
	const extras = TEMPLATE_EXTRAS[templateId] || []
	return {
		data: DATA_FIELDS.slice(),
		colors: COLOR_FIELDS.concat(extras.filter((f) => f.type === 'color')),
		typography: TYPOGRAPHY_FIELDS.slice(),
		layout: LAYOUT_FIELDS.slice(),
		animation: ANIMATION_FIELDS.slice(),
		template: extras.filter((f) => f.type !== 'color'),
	}
}

/**
 * @param {string} [templateId]
 * @returns {{ data: object, style: object }}
 */
function getDefaultPayload(templateId) {
	const payload = {
		data: { ...DEFAULT_DATA },
		style: { ...DEFAULT_STYLE },
	}
	const extras = TEMPLATE_EXTRAS[templateId] || []
	for (const field of extras) {
		if (field.type === 'color') payload.style[field.key] = '#4a148c'
		else if (field.type === 'number') payload.style[field.key] = 8
	}
	if (templateId === 'lt-gradient-wave') {
		payload.style.gradientMid = '#7b1fa2'
		payload.style.gradientEnd = '#4a148c'
	}
	if (templateId === 'lt-split-color') {
		payload.style.panelColor = '#1a237e'
	}
	if (templateId === 'lt-frosted-glass') {
		payload.style.blurAmount = 12
		payload.style.titleFontSize = 42
		payload.style.subtitleFontSize = 18
	}
	if (templateId === 'lt-classic-box') {
		payload.style.titleFontSize = 46
		payload.style.subtitleFontSize = 27
	}
	return payload
}

function parseInitSelectors(html) {
	const titleM = html.match(/titleSel:\s*['"]([^'"]+)['"]/)
	const subM = html.match(/subtitleSel:\s*['"]([^'"]+)['"]/)
	return {
		titleSel: titleM ? titleM[1] : 'h1',
		subtitleSel: subM ? subM[1] : '.subtitle p, p',
	}
}

module.exports = {
	DEFAULT_DATA,
	DEFAULT_STYLE,
	DATA_FIELDS,
	COLOR_FIELDS,
	TYPOGRAPHY_FIELDS,
	LAYOUT_FIELDS,
	ANIMATION_FIELDS,
	TEMPLATE_EXTRAS,
	getFieldsForTemplate,
	getDefaultPayload,
	parseInitSelectors,
}
