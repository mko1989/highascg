/**
 * Lower-thirds engine presets for CG Studio export.
 * Matches template/lower-thirds/lt-engine.js + CasparCG Guide patterns.
 */

/** @typedef {'fade' | 'slide-left' | 'rise'} LtAnimationPresetId */

export const LT_CONTAINER_CLASS = 'lt-cg-studio'
export const LT_GRAPHIC_CLASS = 'graphic'

/** Base layout CSS — merged with user styles on export. */
export const LT_BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
	background: transparent;
	display: flex;
	font-family: 'Arial', 'Helvetica Neue', sans-serif;
	height: 1080px;
	width: 1920px;
	overflow: hidden;
	position: relative;
}
.${LT_CONTAINER_CLASS} {
	align-self: flex-end;
	display: flex;
	margin: 54px 77px;
	position: relative;
}
.${LT_GRAPHIC_CLASS} {
	opacity: 0;
	position: relative;
}
.${LT_CONTAINER_CLASS} h1,
.${LT_CONTAINER_CLASS} [data-lt-role="title"] {
	font-size: 46px;
	font-weight: 700;
	color: var(--text, #fff);
}
.${LT_CONTAINER_CLASS} .subtitle p,
.${LT_CONTAINER_CLASS} [data-lt-role="subtitle"] {
	font-size: 27px;
	color: var(--primary, lightblue);
}
`

/** GrapesJS initial component tree for a new lower-third design. */
export function buildLtEditorComponents() {
	return {
		tagName: 'main',
		attributes: { class: LT_CONTAINER_CLASS },
		draggable: false,
		removable: false,
		copyable: false,
		badgable: false,
		layerable: true,
		selectable: true,
		components: [
			{
				tagName: 'div',
				attributes: { class: LT_GRAPHIC_CLASS },
				draggable: false,
				removable: false,
				copyable: false,
				droppable: true,
				components: [
					{
						tagName: 'h1',
						attributes: { 'data-lt-role': 'title' },
						type: 'text',
						content: 'Name',
						style: {
							padding: '8px 0',
						},
					},
					{
						tagName: 'div',
						attributes: { class: 'subtitle' },
						components: [
							{
								tagName: 'p',
								attributes: { 'data-lt-role': 'subtitle' },
								type: 'text',
								content: 'Title',
							},
						],
					},
				],
			},
		],
	}
}

/**
 * @param {LtAnimationPresetId} id
 * @returns {{ id: LtAnimationPresetId, label: string, animateIn: string, animateOut: string }}
 */
export function getLtAnimationPreset(id) {
	return LT_ANIMATION_PRESETS[id] || LT_ANIMATION_PRESETS.fade
}

/** @type {Record<LtAnimationPresetId, { id: LtAnimationPresetId, label: string, animateIn: string, animateOut: string }>} */
export const LT_ANIMATION_PRESETS = {
	fade: {
		id: 'fade',
		label: 'Fade',
		animateIn: `function() {
			return new Promise(function(resolve) {
				var g = document.querySelector('.${LT_CONTAINER_CLASS} .${LT_GRAPHIC_CLASS}');
				var h1 = g.querySelector('[data-lt-role="title"], h1');
				var sub = g.querySelector('[data-lt-role="subtitle"], .subtitle p, p');
				var tl = new gsap.timeline({ ease: 'power2.out', onComplete: resolve });
				tl.set(g, { opacity: 1 })
					.fromTo(h1, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.55 })
					.fromTo(sub, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45 }, '-=0.25');
			});
		}`,
		animateOut: `function() {
			return new Promise(function(resolve) {
				var g = document.querySelector('.${LT_CONTAINER_CLASS} .${LT_GRAPHIC_CLASS}');
				var tl = new gsap.timeline({ ease: 'power2.in', onComplete: resolve });
				tl.to(g, { opacity: 0, y: 8, duration: 0.5 }).set(g, { y: 0 });
			});
		}`,
	},
	'slide-left': {
		id: 'slide-left',
		label: 'Slide from left',
		animateIn: `function() {
			return new Promise(function(resolve) {
				var g = document.querySelector('.${LT_CONTAINER_CLASS} .${LT_GRAPHIC_CLASS}');
				var tl = new gsap.timeline({ ease: 'power2.out', onComplete: resolve });
				tl.set(g, { opacity: 1 })
					.fromTo(g, { x: '-110%', opacity: 0 }, { x: '0%', opacity: 1, duration: 0.75 });
			});
		}`,
		animateOut: `function() {
			return new Promise(function(resolve) {
				var g = document.querySelector('.${LT_CONTAINER_CLASS} .${LT_GRAPHIC_CLASS}');
				var tl = new gsap.timeline({ ease: 'power2.in', onComplete: resolve });
				tl.to(g, { x: '-110%', opacity: 0, duration: 0.55 }).set(g, { x: '0%' });
			});
		}`,
	},
	rise: {
		id: 'rise',
		label: 'Rise',
		animateIn: `function() {
			return new Promise(function(resolve) {
				var g = document.querySelector('.${LT_CONTAINER_CLASS} .${LT_GRAPHIC_CLASS}');
				var tl = new gsap.timeline({ ease: 'power3.out', onComplete: resolve });
				tl.set(g, { opacity: 1 })
					.fromTo(g, { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7 });
			});
		}`,
		animateOut: `function() {
			return new Promise(function(resolve) {
				var g = document.querySelector('.${LT_CONTAINER_CLASS} .${LT_GRAPHIC_CLASS}');
				var tl = new gsap.timeline({ ease: 'power2.in', onComplete: resolve });
				tl.to(g, { y: 32, opacity: 0, duration: 0.5 });
			});
		}`,
	},
}

/**
 * Normalize template id: always `lt-*` for lower-thirds folder.
 * @param {string} raw
 */
export function normalizeLtTemplateId(raw) {
	const slug = String(raw || '')
		.trim()
		.toLowerCase()
		.replace(/[^\w-]+/g, '-')
		.replace(/^-+|-+$/g, '')
	if (!slug) return 'lt-custom'
	return slug.startsWith('lt-') ? slug : `lt-${slug}`
}

/**
 * Human-readable title from template id.
 * @param {string} id
 */
export function ltDisplayNameFromId(id) {
	return String(id || '')
		.replace(/^lt-/, '')
		.split('-')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}
