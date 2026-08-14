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
 * Current label for a source identified by its ROUTE VALUE (`route://5-3`), for surfaces that
 * stored a drag payload rather than a connector id — the operator-GUI compose tiles do exactly
 * that (WO-323 source tiles keep `{ type, value, label }` from the drop).
 *
 * Without this they render the label captured AT DROP TIME, so renaming a DeckLink input left the
 * compose preview's label bar on the old name (owner 14.08: *"the labels then doesnt show up on
 * the compose preview label bar"*). The stored payload label stays the fallback: a tile whose
 * source has since disappeared from state still shows something meaningful.
 *
 * `sourceLabels` is consulted FIRST because a rename broadcasts only
 * `change { path: 'sourceLabels' }` (src/api/routes-sources.js) — the enriched `extraLiveSources`
 * is not re-pushed, so until the next full `/api/state` its `label` is stale. Applying the override
 * here is the same resolution the server does in `src/config/source-labels.js`, so a rename shows
 * up immediately instead of at the next reload.
 *
 * @param {Array<object>|null|undefined} sources `extraLiveSources` from state
 * @param {string} value the tile's stored route value
 * @param {string} [fallback] the label captured at drop time
 * @param {Record<string, string>|null} [sourceLabels] `state.sourceLabels`, keyed by connector id
 * @returns {string}
 */
export function liveSourceLabelForValue(sources, value, fallback = '', sourceLabels = null) {
	const key = String(value ?? '').trim()
	if (!key) return fallback
	const list = Array.isArray(sources) ? sources : []
	const mine = list.find((s) => String(s?.value ?? '').trim() === key)
	if (!mine) return fallback
	// `sourceLabelKey` is the connector id when there is one, else the route value — mirrors the
	// server's own key derivation, so an override written under either form is found.
	const lkey = String(mine.sourceLabelKey || mine.connectorId || key).trim()
	const override = String(sourceLabels?.[lkey] ?? '').trim()
	if (override) return override
	return sourceLabel(mine, fallback)
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
