/**
 * {@link CustomEvent} names for recalling a look to PRV / PGM from the look preset panel.
 * `detail`: `{ sceneId, lookPreset?, forceCut?, useGlobalTransition? }` — `lookPreset` is the full bookmark from scene state.
 * `useGlobalTransition` (PGM only): take with the deck's default/global transition instead of each look's own (B150.5).
 * Listeners: {@link import('../components/scenes-editor.js')}
 */
export const LOOK_PRESET_RECALL_PRV = 'hacg-look-preset-recall-prv'
export const LOOK_PRESET_RECALL_PGM = 'hacg-look-preset-recall-pgm'
