'use strict'

/**
 * WO-1029 part 2 — pure restore plan for one channel: the snapshot's layers (air-snapshot.js) against what the
 * restarted Caspar shows on the mapped channel right now (after the looks were re-taken and routing set up).
 *
 *  - layer EMPTY now          → put back from INFO: a clip at `position + elapsed` (paused at its frame, a loop modulo
 *                               its length, an ended clip NOT restarted), a route (source channel mapped by role), an
 *                               html URL, a DeckLink device, a colour;
 *  - the SAME clip is on it   → only its position (the look re-take started it from the top): `CALL SEEK`, + `PAUSE`;
 *  - something else is on it  → left alone (the look / routing put it there) and reported.
 * Bands owned by someone else are not touched: audio / route buses (routing setup), the timeline (its engine), editing
 * chrome, the border, the test card on 999 (restore-on-screens.js).
 *
 * This build: `SEEK n` = seconds × CHANNEL fps; `LOOP SEEK n` would also move the loop's IN point
 * (ffmpeg_producer.cpp:302), so a loop is PLAYed and then seeked with a separate `CALL … SEEK`; Caspar never answers
 * `CALL SEEK` on a still image (WO-974) — a clip without a length gets no SEEK.
 */

const { clipParamForPlay, param } = require('../caspar/amcp-utils')
const { pathsMatch } = require('../state/live-scene-reconcile')

/** Why a layer is not this pass's to restore ('' = it is). */
function ownedElsewhere(layer, { cardActive = false, timelineOwned = false } = {}) {
	const n = Number(layer)
	if ((n >= 1 && n <= 9) || (n >= 101 && n <= 109)) return 'route / audio bus (routing setup)'
	if (timelineOwned && n >= 210 && n <= 259) return 'timeline (its engine)'
	if (n >= 980 && n <= 995) return 'editing chrome'
	if (n === 996 || n === 998) return 'global border (look)'
	if (n === 999 && cardActive) return 'test card'
	return ''
}

const isFileProducer = (L) => !!L.clip && !['route', 'html', 'decklink', 'color'].includes(L.producer)
const round3 = (n) => Math.round(n * 1000) / 1000

/**
 * Where a clip is now. `null` = no position (a still image / unknown length while playing).
 * @returns {{ state: 'paused'|'playing'|'ended', at_s: number, target_s: number }|null}
 */
function clipPosition(L, elapsedS) {
	const t = Number(L.time_s)
	if (!Number.isFinite(t)) return null
	const len = Number(L.length_s) > 0 ? Number(L.length_s) : null
	if (L.paused) return { state: 'paused', at_s: t, target_s: len ? Math.min(t, len) : t }
	if (!len) return null
	let target = t + Math.max(0, elapsedS)
	if (L.loop) target = target % len
	else if (target >= len) return { state: 'ended', at_s: t, target_s: len }
	return { state: 'playing', at_s: t, target_s: target }
}

/**
 * @param {{ channel: number, layers: object[], fps: number|null, label?: string }} snapCh the snapshot's channel
 * @param {{ fps: number|null, layers: object[] }} current parsed INFO of the mapped channel now
 * @param {{ channel: number, elapsedS: number, mapChannel: (old: number) => number|null, cardActive?: boolean,
 *   timelineOwned?: boolean }} o
 * @returns {{ lines: string[], clips: object[], layers: object[], skipped: object[] }}
 */
function planChannelRestore(snapCh, current, o) {
	const ch = o.channel
	const fps = current?.fps || snapCh.fps || null
	const out = { lines: [], clips: [], layers: [], skipped: [] }
	const now = new Map((current?.layers || []).map((l) => [l.layer, l]))
	const frames = (s) => Math.max(0, Math.round(s * fps))
	for (const L of snapCh.layers || []) {
		if (ownedElsewhere(L.layer, o)) continue
		const cl = `${ch}-${L.layer}`
		const what = `ch ${ch} layer ${L.layer}${L.clip ? ` ${L.clip}` : ` (${L.producer})`}`
		const cur = now.get(L.layer)
		const file = isFileProducer(L)
		const pos = file ? clipPosition(L, o.elapsedS) : null
		const seekable = pos && fps && Number(L.length_s) > 0
		if (cur) {
			if (file && cur.clip && pathsMatch(L.clip, cur.clip)) {
				if (seekable) {
					const f = pos.state === 'ended' ? Math.max(0, Math.floor(Number(L.length_s) * fps) - 1) : frames(pos.target_s)
					out.lines.push(`CALL ${cl} SEEK ${f}`)
					if (pos.state !== 'playing') out.lines.push(`PAUSE ${cl}`)
					out.clips.push({ channel: ch, layer: L.layer, clip: L.clip, at_s: round3(pos.at_s), resumed_s: round3(pos.target_s), paused: pos.state !== 'playing', loop: !!L.loop, via: 'look' })
				} else out.layers.push({ channel: ch, layer: L.layer, producer: L.producer, action: 'kept' })
			} else if (cur.producer === L.producer && !file) {
				out.layers.push({ channel: ch, layer: L.layer, producer: L.producer, action: 'kept' })
			} else {
				out.skipped.push({ what, why: `layer now shows ${cur.clip || cur.producer} (look / routing put it there)` })
			}
			continue
		}
		if (file) {
			const c = clipParamForPlay(L.clip)
			if (pos?.state === 'ended') {
				out.skipped.push({ what, why: 'clip had ended — not restarted' })
				continue
			}
			if (!seekable) {
				out.lines.push(`${L.paused ? 'LOAD' : 'PLAY'} ${cl} ${c}${L.loop ? ' LOOP' : ''}`)
				out.layers.push({ channel: ch, layer: L.layer, producer: L.producer, action: 'played' })
				continue
			}
			const f = frames(pos.target_s)
			const verb = pos.state === 'paused' ? 'LOAD' : 'PLAY'
			if (L.loop) {
				out.lines.push(`${verb} ${cl} ${c} LOOP`)
				if (f > 0) out.lines.push(`CALL ${cl} SEEK ${f}`)
			} else out.lines.push(`${verb} ${cl} ${c}${f > 0 ? ` SEEK ${f}` : ''}`)
			out.clips.push({ channel: ch, layer: L.layer, clip: L.clip, at_s: round3(pos.at_s), resumed_s: round3(pos.target_s), paused: pos.state === 'paused', loop: !!L.loop })
			continue
		}
		if (L.producer === 'route') {
			const src = L.route ? o.mapChannel(L.route.channel) : null
			if (!src) {
				out.skipped.push({ what, why: `route source channel ${L.route?.channel ?? '?'} no longer exists` })
				continue
			}
			out.lines.push(`PLAY ${cl} route://${src}${L.route.layer != null ? `-${L.route.layer}` : ''}`)
		} else if (L.producer === 'html' && L.url) out.lines.push(`PLAY ${cl} [HTML] ${clipParamForPlay(L.url)}`)
		else if (L.producer === 'decklink' && Number.isFinite(L.device)) out.lines.push(`PLAY ${cl} DECKLINK ${L.device}`)
		else if (L.producer === 'color' && L.color) out.lines.push(`PLAY ${cl} ${param(L.color)}`)
		else {
			out.skipped.push({ what, why: `${L.producer} layer: nothing to put it back from` })
			continue
		}
		out.layers.push({ channel: ch, layer: L.layer, producer: L.producer, action: 'played' })
	}
	return out
}

module.exports = { planChannelRestore, clipPosition }
