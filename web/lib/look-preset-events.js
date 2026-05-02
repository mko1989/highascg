/**
 * {@link CustomEvent} names for recalling a look to PRV / PGM from the look preset panel.
 * `detail`: `{ sceneId, lookPreset?, forceCut? }` — `lookPreset` is the full bookmark (incl. optional `tandem.pixelhue`).
 * Listeners: {@link import('../components/scenes-editor.js')}
 */
export const LOOK_PRESET_RECALL_PRV = 'hacg-look-preset-recall-prv'
export const LOOK_PRESET_RECALL_PGM = 'hacg-look-preset-recall-pgm'
