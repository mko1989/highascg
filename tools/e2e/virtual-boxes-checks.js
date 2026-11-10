'use strict'

/**
 * WO-1029 phase 2a — the invariants every virtual-box scenario asserts on the fake Caspars' write logs (fake-caspar.js),
 * so a stray write is caught wherever it comes from (a catch-up, a replay, a reconnect, a relay, a restart):
 *
 *   onlyWriters(bed, { box: 'vb-a', dest: LED_ID, since: mark, allowed: ['vb-a'] })
 *     → the write-log entries on that destination's PGM + PRV channels of box vb-a's Caspar, after the mark, by any
 *       connection that is NOT one of `allowed` (box ids = whose node process held the connection). [] = clean.
 *       The box's own consumer lines (ADD / REMOVE) on its own channels are not counted.
 *   assertOnlyWriters(…)  the same, as an assertion with the offending lines in the message
 *   assertNoStrays(bed, mark, owners)  for every box and every destination cabled there: only `owners(box, dest)` wrote
 *     (default: the box itself) — "nobody but X touched X's screens in this window"
 *   wrote(bed, box, dest, since, who) → entries by `who` (positive evidence: "this press DID land there")
 */

const assert = require('node:assert/strict')

const chansOf = (bed, boxId, destId, buses) => buses.map((b) => bed.box(boxId).ch(destId, b)).filter((c) => Number(c) > 0)

function onlyWriters(bed, { box, dest, since, allowed, buses = ['pgm', 'prv'] }) {
	const b = bed.box(box)
	const mark = typeof since === 'object' && since !== null ? since[box] : since
	const ok = new Set(allowed)
	const out = []
	// a box (re)attaching its OWN consumers (ADD/REMOVE n-720 STREAM … audio taps, after a reconnect) is housekeeping,
	// not screen content; the same line from another box would still count
	const own = (e) => e.who === box && /^(ADD|REMOVE)\s/i.test(e.line)
	for (const ch of chansOf(bed, box, dest, buses)) out.push(...b.caspar.since(mark, { channel: ch }).filter((e) => !ok.has(e.who) && !own(e)))
	return out.sort((x, y) => x.seq - y.seq)
}

const show = (list) => list.slice(0, 8).map((e) => `${e.who} → ch ${e.channel}${e.layer != null ? '-' + e.layer : ''}: ${e.line.slice(0, 90)}`).join('; ') + (list.length > 8 ? ` (+${list.length - 8} more)` : '')

function assertOnlyWriters(bed, o, msg = '') {
	const bad = onlyWriters(bed, o)
	assert.deepEqual(bad.map((e) => e.line), [], `${msg ? msg + ': ' : ''}${bad.length} write(s) on ${o.box}'s ${o.dest} by ${[...new Set(bad.map((e) => e.who))].join(', ')} (allowed: ${o.allowed.join(', ')}) — ${show(bad)}`)
}

/**
 * Every destination cabled on a box: between `mark` and now only `owners(boxId, destId)` (default: that box) wrote to
 * its channels there. The general stray catcher: run it over any window in which no cross-box press was made.
 */
function assertNoStrays(bed, mark, owners = (boxId) => [boxId], msg = '') {
	for (const b of bed.boxes.values())
		for (const destId of b.cabled) assertOnlyWriters(bed, { box: b.id, dest: destId, since: mark, allowed: owners(b.id, destId) }, msg)
}

/** Entries written by `who` on that destination's channels of `box` after the mark (PGM only by default). */
function wrote(bed, box, destId, since, who, buses = ['pgm']) {
	const mark = typeof since === 'object' && since !== null ? since[box] : since
	return chansOf(bed, box, destId, buses).flatMap((ch) => bed.box(box).caspar.since(mark, { channel: ch, who }))
}

/** The clip in the foreground of the topmost visible layer of that screen ('' = black). */
function topClip(bed, box, destId, bus = 'pgm') {
	const v = bed.onScreen(box, destId, bus).filter((l) => l.fg)
	return v.length ? v[v.length - 1].fg.source : ''
}

module.exports = { onlyWriters, assertOnlyWriters, assertNoStrays, wrote, topClip }
