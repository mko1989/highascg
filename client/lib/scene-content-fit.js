/** Shared content-fit enum — keep in lib/ to avoid component import cycles. */

/** @typedef {'native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'} SceneContentFit */

/** Same labels/values as look + timeline inspectors. */
export const SCENE_CONTENT_FIT_OPTIONS = /** @type {const} */ ([
	{ value: 'native', label: 'Native (1:1 px)' },
	{ value: 'fill-canvas', label: 'Fit canvas' },
	{ value: 'horizontal', label: 'Fill width' },
	{ value: 'vertical', label: 'Fill height' },
	{ value: 'stretch', label: 'Stretch' },
])

export const SCENE_CONTENT_FIT_VALUES = new Set(SCENE_CONTENT_FIT_OPTIONS.map((o) => o.value))
