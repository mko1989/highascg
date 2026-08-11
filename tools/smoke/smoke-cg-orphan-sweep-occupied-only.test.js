'use strict'

/* WO-482. The WO-207 orphan sweep cleared the WHOLE template-CG host band (700-789) on every
 * program channel at every startup and Caspar reconnect — ~186 `CG n-m CLEAR` lines on a box with
 * nothing on those layers. Batched into 3 round-trips (the comment in the sweep explains why that
 * matters), but Caspar logs every line, and the owner reasonably asked what the blanket clear was
 * for.
 *
 * The connect gather has already run INFO per channel, so occupancy is known: clear only hosts that
 * hold a producer and are not declared by the restored live look. Clean channel → zero commands.
 * No XML for a channel → the old full sweep for that channel, because an orphan left on air is
 * worse than a redundant clear. */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	sweepTemplateCgOrphansOnCasparConnected,
} = require('../../src/engine/template-cg-orphan-sweep')

/**
 * INFO XML in the shape `parseLayerFgProducerTypesFromChannelXml` actually reads: layers live under
 * `channel/stage/layer`, and occupancy is the `<producer>` text of each layer's `<foreground>`.
 *
 * Checked against a live box (INFO 1 on highascg0916, 11.08): Caspar reports **only layers that
 * exist** — that channel returned a single entry, `999=html` (the LED test card), and nothing at
 * all in 700-789. So both shapes must skip: an absent layer AND a present-but-`empty` one. The
 * `emptyPresent` flag exercises the second, which a Caspar that does emit the element would give.
 */
function channelXmlWithBusyLayers(busy, { emptyPresent = false } = {}) {
	const layers = []
	for (let n = 700; n <= 789; n++) {
		if (busy.includes(n)) {
			layers.push(`<layer_${n}><foreground><producer>image[x.png]</producer></foreground></layer_${n}>`)
		} else if (emptyPresent) {
			layers.push(`<layer_${n}><foreground><producer>empty</producer></foreground></layer_${n}>`)
		}
	}
	return `<?xml version="1.0" encoding="utf-8"?><channel><stage><layer>${layers.join('')}</layer></stage></channel>`
}

function fakeAmcp() {
	const sent = []
	return {
		sent,
		batchSendChunked: async (lines) => {
			sent.push(...lines)
			return { ok: true }
		},
	}
}

test('WO-482: a clean channel costs zero CLEAR commands', async () => {
	const amcp = fakeAmcp()
	const res = await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channels: [1, 3],
		channelXml: { 1: channelXmlWithBusyLayers([]), 3: channelXmlWithBusyLayers([]) },
	})
	assert.equal(amcp.sent.length, 0, 'nothing on the band → nothing to clear')
	assert.equal(res.clearedCount, 0)
})

test('WO-482: a channel that reports only unrelated layers costs nothing (real INFO shape)', async () => {
	const amcp = fakeAmcp()
	/* What the live box actually returned: layer 999 present, band 700-789 absent entirely. */
	const xml =
		'<?xml version="1.0" encoding="utf-8"?><channel><stage><layer>' +
		'<layer_999><foreground><producer>html</producer></foreground></layer_999>' +
		'</layer></stage></channel>'
	await sweepTemplateCgOrphansOnCasparConnected({ amcp, liveState: {}, channels: [1], channelXml: { 1: xml } })
	assert.equal(amcp.sent.length, 0, 'absent layers are empty layers — nothing to clear')
})

test('WO-482: a present-but-empty layer is skipped too', async () => {
	const amcp = fakeAmcp()
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channels: [1],
		channelXml: { 1: channelXmlWithBusyLayers([], { emptyPresent: true }) },
	})
	assert.equal(amcp.sent.length, 0)
})

test('WO-482: an occupied host is still cleared', async () => {
	const amcp = fakeAmcp()
	await sweepTemplateCgOrphansOnCasparConnected({
		amcp,
		liveState: {},
		channels: [1],
		channelXml: { 1: channelXmlWithBusyLayers([705, 712]) },
	})
	assert.deepEqual(amcp.sent.sort(), ['CG 1-705 CLEAR', 'CG 1-712 CLEAR'].sort())
})

test('WO-482: no INFO xml for a channel falls back to the full band — orphans must not survive', async () => {
	const amcp = fakeAmcp()
	await sweepTemplateCgOrphansOnCasparConnected({ amcp, liveState: {}, channels: [1], channelXml: {} })
	assert.equal(amcp.sent.length, 90, 'hosts 700-789 inclusive')
	assert.ok(amcp.sent.includes('CG 1-700 CLEAR') && amcp.sent.includes('CG 1-789 CLEAR'))
})

test('WO-482: the batch stays one chunked send, not a command per layer (WO-259)', async () => {
	let calls = 0
	const amcp = {
		batchSendChunked: async (lines, opts) => {
			calls++
			assert.equal(opts?.forceBatch, true, 'forceBatch is not optional — see the sweep comment')
			assert.ok(Array.isArray(lines))
			return { ok: true }
		},
	}
	await sweepTemplateCgOrphansOnCasparConnected({ amcp, liveState: {}, channels: [1], channelXml: {} })
	assert.equal(calls, 1, 'one chunked batch for the whole sweep')
})
