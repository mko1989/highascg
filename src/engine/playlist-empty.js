'use strict'

/**
 * WO-768 — the empty playlist item (owner 25.10: "play a clip from the list, then manually transition to nothing on
 * that layer then play next clip so on"). It stages as `LOADBG ch-l EMPTY <playlist transition>` + PLAY, so the clip
 * dissolves to nothing and the next item comes in from an empty layer. Timeless: a manual list holds it until Next,
 * an auto list for its duration. Never a file: no ⚠ missing, no project-media rewrite, no replication, never the
 * layer's `source`.
 */

const EMPTY_TYPE = 'empty'
const EMPTY_VALUE = 'EMPTY'
const EMPTY_LABEL = '— empty —'

function isEmptyPlaylistItem(item) {
	return !!item && String(item.type || '').toLowerCase() === EMPTY_TYPE
}

/** The first item that is not empty (the layer's `source`), or null. */
function firstRealItem(list) {
	return (list || []).find((it) => it && !isEmptyPlaylistItem(it)) || null
}

module.exports = { EMPTY_TYPE, EMPTY_VALUE, EMPTY_LABEL, isEmptyPlaylistItem, firstRealItem }
