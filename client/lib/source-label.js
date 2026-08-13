/**
 * Live-source label helpers (WO-506).
 *
 * The server already applies an operator's custom name onto each `extraLiveSources[].label` before
 * it reaches `/api/state` (`src/config/source-labels.js`), so any surface that renders that field is
 * correct with no change. These helpers are for the surfaces that resolve a source themselves, and
 * for the top-bar pill shorthand.
 *
 * Screens are NOT resolved here — use `screenLabel(cm, idx)` from `./screen-label.js`. A screen's
 * name is its owning destination's name and, per the owner, outranks everything.
 */

/**
 * Display label for a live source.
 * @param {object|null|undefined} source an `extraLiveSources` entry from state
 * @param {string} [fallback]
 * @returns {string}
 */
export function sourceLabel(source, fallback = '') {
	const label = String(source?.label ?? '').trim()
	if (label) return label
	const generated = String(source?.generatedLabel ?? '').trim()
	if (generated) return generated
	return fallback
}

/** @returns {boolean} true when an operator named this source, rather than us generating it. */
export function sourceLabelIsCustom(source) {
	return source?.labelIsCustom === true
}

/**
 * Top-bar screen-pill text (owner 13.08): *"a 3 later shorthand of the label, just first 3 letters,
 * nothing else."*
 *
 * Literally the first three characters — no initials, no vowel-stripping, no case change.
 * "Main" → "Mai", "Stage Left" → "Sta". Shorter labels render whole.
 *
 * Display only: never store this, and never use it anywhere the full label fits.
 * Mirrors `shortSourcePill` in `src/config/source-labels.js`; the two must agree.
 *
 * @param {string} label
 * @returns {string}
 */
export function shortLabelPill(label) {
	return String(label ?? '')
		.trim()
		.slice(0, 3)
}
