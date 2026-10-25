'use strict'

/**
 * WO-603 slice 6 — look-layer playlist edits planned in node (owner D directive). Port of the web
 * client/components/inspector-layer-playlist.js mutations; the client sends its current layer and one op and stores
 * the returned patch (looks stay client-owned: deck sync / autosave).
 *
 * Ops: mode {mode} · add {items} · add_empty {at?} · move {from, to} · remove {index} · item {index, duration?, loop?, fadeOut?} ·
 *      settings {advance?, loop?, transition?, fadeFrames?} · timeless {secs}
 * WO-766: `fadeOut` (↘ fade down when done) and `loop` exclude each other — setting one clears the other.
 * WO-768: `add_empty` inserts an empty item (engine/playlist-empty.js); the layer's `source` skips empty items.
 */

const { isTimelessPlaylistItem } = require('./scene-take-lbg-playlist')
const { EMPTY_TYPE, EMPTY_VALUE, EMPTY_LABEL, firstRealItem } = require('./playlist-empty')

const TRANSITION_TYPES = ['MIX', 'CUT', 'SLIDE', 'WIPE']
const IMAGE_RE = /\.(png|jpg|jpeg|gif|bmp|webp)$/i

let _seq = 0
/** Web `pl_<Date.now()>_<random7>`; a counter keeps ids unique within one millisecond. */
function newItemId(now = Date.now()) {
	_seq = (_seq + 1) % 1e6
	return `pl_${now}_${_seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Web playlist-timeless timelessSecsOf. */
function timelessSecsOf(playlist) {
	for (const it of playlist || []) {
		const d = Number(it?.duration)
		if (isTimelessPlaylistItem(it) && it?.duration != null && Number.isFinite(d) && d > 0) return d
	}
	return 20
}

/** Web isDraggableLayerSourcePayload: a value, never an effect. */
function isDroppableSource(s) {
	return !!s && !!String(s.value || '').trim() && String(s.type || 'media').toLowerCase() !== 'effect'
}

/** `{type:'multi', items}` or one source → the droppable sources, in order (web parseDraggableSourcesPayload). */
function flattenSources(data) {
	if (data && data.type === 'multi' && Array.isArray(data.items)) return data.items.filter(isDroppableSource)
	if (Array.isArray(data)) return data.filter(isDroppableSource)
	return isDroppableSource(data) ? [data] : []
}

/** A playlist item from a dropped source (web dropzone, inspector-layer-playlist.js:105-116). */
function itemFromSource(src, playlist, now) {
	const value = String(src.value)
	const isImg = src.kind === 'still' || src.type === 'image' || IMAGE_RE.test(value)
	const item = { id: newItemId(now), type: isImg ? 'image' : src.type || 'media', value, label: src.label || value }
	if (isTimelessPlaylistItem(item)) item.duration = timelessSecsOf(playlist)
	return item
}

const sourceOf = (it) => (it ? { type: it.type, value: it.value, label: it.label } : null)
/* WO-768: the layer's source is its first real item — an empty item is never a source */
const sourceOfList = (list) => sourceOf(firstRealItem(list))

/**
 * Pure. @returns {{ patch: object, playlistChanged: boolean } | { error: string }}
 */
function planPlaylistEdit(layer, op, args = {}, now = Date.now()) {
	const L = layer && typeof layer === 'object' ? layer : {}
	const list = Array.isArray(L.playlist) ? L.playlist : []
	const idx = (v) => {
		const n = parseInt(v, 10)
		return Number.isFinite(n) && n >= 0 && n < list.length ? n : -1
	}
	switch (op) {
		case 'mode': {
			const mode = args.mode === 'list' ? 'list' : args.mode === 'single' ? 'single' : null
			if (!mode) return { error: "mode must be 'single' or 'list'" }
			const patch = { sourceMode: mode }
			if (mode === 'list' && list.length === 0 && L.source && L.source.value) {
				const seeded = { id: newItemId(now), type: L.source.type || 'media', value: L.source.value, label: L.source.label || L.source.value }
				if (isTimelessPlaylistItem(seeded)) seeded.duration = timelessSecsOf(list)
				patch.playlist = [seeded]
			}
			if (mode === 'single' && firstRealItem(list)) patch.source = sourceOfList(list)
			return { patch, playlistChanged: !!patch.playlist }
		}
		case 'add': {
			const srcs = flattenSources(args.items)
			if (!srcs.length) return { error: 'nothing droppable (a source needs a value; effects are not items)' }
			const added = srcs.map((s) => itemFromSource(s, list, now))
			const patch = { playlist: [...list, ...added] }
			if (!firstRealItem(list)) patch.source = sourceOf(added[0])
			return { patch, playlistChanged: true }
		}
		/* WO-768: an empty item at `at` (default: the end) — Next transitions the layer to nothing */
		case 'add_empty': {
			const at = args.at == null ? list.length : parseInt(args.at, 10)
			if (!Number.isFinite(at) || at < 0 || at > list.length) return { error: 'at out of range' }
			const item = { id: newItemId(now), type: EMPTY_TYPE, value: EMPTY_VALUE, label: EMPTY_LABEL, duration: timelessSecsOf(list) }
			return { patch: { playlist: [...list.slice(0, at), item, ...list.slice(at)] }, playlistChanged: true }
		}
		case 'move': {
			const from = idx(args.from)
			const to = idx(args.to)
			if (from < 0 || to < 0) return { error: 'from / to out of range' }
			if (from === to) return { patch: {}, playlistChanged: false }
			const next = [...list]
			const [moved] = next.splice(from, 1)
			next.splice(to, 0, moved)
			const patch = { playlist: next }
			if (from === 0 || to === 0 || firstRealItem(list) !== firstRealItem(next)) patch.source = sourceOfList(next)
			return { patch, playlistChanged: true }
		}
		case 'remove': {
			const i = idx(args.index)
			if (i < 0) return { error: 'index out of range' }
			const next = list.filter((_, k) => k !== i)
			return { patch: { playlist: next, source: sourceOfList(next) }, playlistChanged: true }
		}
		case 'item': {
			const i = idx(args.index)
			if (i < 0) return { error: 'index out of range' }
			const it = { ...list[i] }
			if (args.duration !== undefined) {
				if (!isTimelessPlaylistItem(it)) return { error: 'timed media carries its own length' }
				it.duration = Math.min(86400, Math.max(1, Math.round(Number(args.duration)) || timelessSecsOf(list)))
			}
			if (args.loop !== undefined) {
				it.loop = args.loop === true
				if (it.loop) delete it.fadeOut
			}
			if (args.fadeOut !== undefined) {
				if (args.fadeOut === true && isTimelessPlaylistItem(it)) return { error: 'only a clip with a length can fade out at its end' }
				if (args.fadeOut === true) {
					it.fadeOut = true
					it.loop = false
				} else delete it.fadeOut
			}
			return { patch: { playlist: list.map((x, k) => (k === i ? it : x)) }, playlistChanged: true }
		}
		case 'settings': {
			const patch = {}
			if (args.advance !== undefined) {
				if (args.advance !== 'auto' && args.advance !== 'manual') return { error: "advance must be 'auto' or 'manual'" }
				patch.playlistAdvance = args.advance
			}
			if (args.loop !== undefined) patch.playlistLoop = args.loop !== false
			if (args.transition && typeof args.transition === 'object') {
				const cur = L.playlistTransition && typeof L.playlistTransition === 'object' ? L.playlistTransition : {}
				const t = { type: 'MIX', duration: 12, tween: 'linear', ...cur }
				if (args.transition.type !== undefined) {
					const ty = String(args.transition.type).toUpperCase()
					if (!TRANSITION_TYPES.includes(ty)) return { error: `transition type must be one of ${TRANSITION_TYPES.join(', ')}` }
					t.type = ty
				}
				if (args.transition.duration !== undefined) t.duration = Math.max(0, Math.round(Number(args.transition.duration) || 0))
				patch.playlistTransition = t
			}
			/* WO-766: ↘ fade length in channel frames; 0 / null = half the channel's frame rate */
			if (args.fadeFrames !== undefined) {
				const f = Math.round(Number(args.fadeFrames) || 0)
				patch.playlistFadeFrames = f > 0 ? Math.min(250, f) : null
			}
			return { patch, playlistChanged: false }
		}
		case 'timeless': {
			if (!Number.isFinite(Number(args.secs)) || Number(args.secs) <= 0) return { error: 'secs must be a positive number' }
			const s = Math.min(86400, Math.max(1, Number(args.secs)))
			let touched = 0
			const next = list.map((it) => {
				if (!isTimelessPlaylistItem(it)) return it
				touched++
				return { ...it, duration: s }
			})
			return { patch: touched ? { playlist: next } : {}, playlistChanged: touched > 0, touched }
		}
		default:
			return { error: `unknown op "${op}"` }
	}
}

/** Whether the inspector shows "Next ▶" (web: manual advance, or any item that holds with its own loop). */
function showsNext(layer) {
	return layer?.playlistAdvance === 'manual' || (layer?.playlist || []).some((it) => it?.loop === true)
}

module.exports = { TRANSITION_TYPES, timelessSecsOf, flattenSources, itemFromSource, planPlaylistEdit, showsNext }
