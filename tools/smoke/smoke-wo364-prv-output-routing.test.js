'use strict'

/**
 * WO-364 smoke — the PRV bus is a first-class routable output.
 *
 * Covers (a) destinationToVideoSource: a pgm_prv destination edge with outputLayer 2 feeds
 * `preview_<N>` while layer 1 (or absent) keeps `program_<N>`, and pgm_only/pixelmap never
 * map to preview; (b) collectDestinationOutputEdges threads the edge's outputLayer note into
 * the resolved videoSource; (c) resolveInputTargetToChannel resolves `preview_N` to the
 * preview channel of the pair.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
	destinationToVideoSource,
	collectDestinationOutputEdges,
} = require('../../src/config/device-graph-output-mapping.js')
const { resolveInputTargetToChannel } = require('../../src/config/rtmp-output.js')

describe('WO-364 destinationToVideoSource honors outputLayer', () => {
	const dest = (mode, mainScreenIndex = 0) => ({ mode, mainScreenIndex })

	it('pgm_prv layer 2 → preview_N', () => {
		assert.equal(destinationToVideoSource(dest('pgm_prv', 0), 2), 'preview_1')
		assert.equal(destinationToVideoSource(dest('pgm_prv', 1), 2), 'preview_2')
	})

	it('pgm_prv layer 1 / absent → program_N', () => {
		assert.equal(destinationToVideoSource(dest('pgm_prv', 0), 1), 'program_1')
		assert.equal(destinationToVideoSource(dest('pgm_prv', 1)), 'program_2')
	})

	it('pgm_only / pixelmap never map to preview', () => {
		assert.equal(destinationToVideoSource(dest('pgm_only', 0), 2), 'program_1')
		assert.equal(destinationToVideoSource(dest('pixelmap', 2), 2), 'program_3')
	})

	it('multiview stays multiview regardless of layer', () => {
		assert.equal(destinationToVideoSource(dest('multiview'), 2), 'multiview')
	})
})

describe('WO-364 collectDestinationOutputEdges threads outputLayer into videoSource', () => {
	const config = {
		screenDestinations: {
			version: 1,
			destinations: [
				{ id: 'dst_a', label: 'PGM/PRV 1', mainScreenIndex: 0, mode: 'pgm_prv', width: 1920, height: 1080, fps: 50 },
			],
		},
		deviceGraph: {
			version: 1,
			devices: [],
			connectors: [
				{ id: 'dst_in_dst_a', kind: 'destination_in', externalRef: 'dst_a' },
				{ id: 'stream_1', kind: 'stream_out' },
				{ id: 'record_1', kind: 'record_out' },
			],
			edges: [
				{ id: 'e1', sourceId: 'dst_in_dst_a', sinkId: 'stream_1', note: JSON.stringify({ outputLayer: 2 }) },
				{ id: 'e2', sourceId: 'dst_in_dst_a', sinkId: 'record_1' },
			],
			layout: {},
		},
	}

	it('layer-2 edge resolves preview_1, unnoted edge resolves program_1', () => {
		const edges = collectDestinationOutputEdges(config)
		const stream = edges.find((e) => e.sink.id === 'stream_1')
		const record = edges.find((e) => e.sink.id === 'record_1')
		assert.ok(stream && record, 'both edges resolve')
		assert.equal(stream.layer, 2)
		assert.equal(stream.videoSource, 'preview_1')
		assert.equal(record.layer, 1)
		assert.equal(record.videoSource, 'program_1')
	})
})

describe('WO-364 preview_N resolves to the preview channel', () => {
	it('preview_1 → previewCh(1)', () => {
		const config = { screen_count: 1 }
		const ch = resolveInputTargetToChannel(config, 'preview_1')
		assert.ok(Number.isFinite(ch) && ch >= 2, `preview_1 resolves to a real channel (got ${ch})`)
	})
})
