'use strict'

/** CINF reports the time base (1/25), not the rate — reading it as fps made a 17.9 s clip 3 h long and fade-on-end never fired. */
const assert = require('assert')
const { parseCinfMedia } = require('../../src/media/cinf-parse')

const pal = parseCinfMedia('"PROJECTS/X"  MOVIE  535952228 20260924135114 448 1/25')
assert.strictEqual(pal.durationMs, 17920)
assert.strictEqual(pal.fps, 25)

const ntsc = parseCinfMedia('"X"  MOVIE  1 20260101000000 300 1001/30000')
assert.strictEqual(ntsc.durationMs, 10010)
assert.strictEqual(ntsc.fps, 29.97)

const rate = parseCinfMedia('"X"  MOVIE  1 20260101000000 250 25/1')
assert.strictEqual(rate.durationMs, 10000)
assert.strictEqual(rate.fps, 25)

console.log('smoke-cinf-timebase: ok')
