'use strict'

const assert = require('assert')
const { audioRouteToAudioFilter } = require('../../src/engine/audio-route')
const {
	clipAudioRoute,
	playAfSuffix,
	timelineClipTransportStale,
} = require('../../src/engine/timeline-playback-helpers')

assert.strictEqual(audioRouteToAudioFilter('1+2', '8ch'), null)
assert.strictEqual(audioRouteToAudioFilter('3+4', '8ch'), 'pan=8c|c2=c0|c3=c1')
assert.strictEqual(audioRouteToAudioFilter('5+6', '8ch'), 'pan=8c|c4=c0|c5=c1')
assert.strictEqual(audioRouteToAudioFilter('7+8', '8ch'), 'pan=8c|c6=c0|c7=c1')
assert.strictEqual(audioRouteToAudioFilter('3+4', '4ch'), 'pan=4c|c2=c0|c3=c1')
assert.strictEqual(audioRouteToAudioFilter('9+10', '8ch'), null)
assert.strictEqual(audioRouteToAudioFilter('3+4', '16ch'), 'pan=16c|c2=c0|c3=c1')

assert.strictEqual(clipAudioRoute({}), '1+2')
assert.strictEqual(clipAudioRoute({ audioRoute: '5+6' }), '5+6')
assert.strictEqual(
	playAfSuffix({ audioRoute: '3+4' }, '8ch'),
	' AF "pan=8c|c2=c0|c3=c1"',
)
assert.strictEqual(playAfSuffix({ audioRoute: '1+2' }, '8ch'), '')

const prev = { clipId: 'c1', audioRoute: '1+2', frame: 0 }
assert.strictEqual(timelineClipTransportStale(prev, { id: 'c1', audioRoute: '3+4' }), true)
assert.strictEqual(timelineClipTransportStale(prev, { id: 'c1', audioRoute: '1+2' }), false)
assert.strictEqual(timelineClipTransportStale(prev, { id: 'c2', audioRoute: '1+2' }), true)
assert.strictEqual(timelineClipTransportStale(null, { id: 'c1', audioRoute: '7+8' }), true)

console.log('smoke-timeline-audio-route: OK')
