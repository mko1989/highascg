'use strict'

/**
 * WO-872 — tools/audio/beat-metrics.js is a port of mir_eval 0.8.2 beat.py (trim_beats, f_measure, continuity), so the
 * beat benchmark (tools/audio/eval-beat-tracker.js) reads like published numbers. The `want` values below are the real
 * mir_eval's output for these exact inputs (scratch run 30.10: 400 random cases, 0 mismatches, max diff 0); `want` is
 * [F, CMLc, CMLt, AMLc, AMLt] after the 5 s trim.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { trimBeats, fMeasure, continuity, tempoAccuracy, variations } = require('../audio/beat-metrics')

const CASES = [
	{
		label: 'on the beat, \u00b130 ms jitter',
		ref: [
			0.9221, 1.2343, 1.5465, 1.8587, 2.1709, 2.4832, 2.7954, 3.1076, 3.4198, 3.732, 4.0442, 4.3564, 4.6687, 4.9809,
			5.2931, 5.6053, 5.9175, 6.2297,
		],
		est: [
			0.9248, 1.163, 1.5667, 1.8389, 2.1971, 2.4279, 2.8161, 3.1005, 3.444, 3.7042, 4.0257, 4.4237, 4.6438, 4.9597, 5.2848,
			5.5746, 5.9532, 6.2815,
		],
		want: [1, 0.5, 0.75, 0.5, 0.75],
	},
	{
		label: 'off-beat (half a period late)',
		ref: [
			2.7946, 3.3324, 3.8703, 4.4082, 4.946, 5.4839, 6.0217, 6.5596, 7.0975, 7.6353, 8.1732, 8.711, 9.2489, 9.7867,
			10.3246, 10.8625, 11.4003, 11.9382, 12.476,
		],
		est: [
			3.0579, 3.5957, 4.1336, 4.6714, 5.2093, 5.7472, 6.285, 6.8229, 7.3607, 7.8986, 8.4364, 8.9743, 9.5122, 10.05,
			10.5879, 11.1257, 11.6636, 12.2014, 12.7393,
		],
		want: [0, 0, 0, 0.866666666667, 0.866666666667],
	},
	{
		label: 'double tempo',
		ref: [1.9349, 2.5003, 3.0657, 3.6311, 4.1964, 4.7618, 5.3272, 5.8926, 6.458, 7.0234, 7.5887, 8.1541, 8.7195, 9.2849],
		est: [
			1.9349, 2.2177, 2.5003, 2.7831, 3.0657, 3.3484, 3.6311, 3.9138, 4.1964, 4.4792, 4.7618, 5.0446, 5.3272, 5.61, 5.8926,
			6.1754, 6.458, 6.7407, 7.0234, 7.3061, 7.5887, 7.8715, 8.1541, 8.4369, 8.7195, 9.0023, 9.2849, 9.5677,
		],
		want: [0.64, 0, 0, 0.882352941176, 0.882352941176],
	},
	{
		label: 'half tempo',
		ref: [
			3.2715, 4.0239, 4.7763, 5.5286, 6.281, 7.0334, 7.7858, 8.5382, 9.2906, 10.043, 10.7954, 11.5478, 12.3001, 13.0525,
			13.8049,
		],
		est: [3.2461, 4.7576, 6.2868, 7.7887, 9.2831, 10.7839, 12.2835, 13.8038],
		want: [0.666666666667, 0, 0, 1, 1],
	},
	{
		label: 'random clicks',
		ref: [
			3.088, 3.604, 4.12, 4.6359, 5.1519, 5.6679, 6.1839, 6.6999, 7.2159, 7.7318, 8.2478, 8.7638, 9.2798, 9.7958, 10.3117,
			10.8277, 11.3437,
		],
		est: [
			1.3079, 2.2041, 3.359, 3.5463, 5.1245, 5.6698, 6.0726, 6.3316, 6.8062, 6.9067, 6.956, 7.524, 8.1161, 9.0658, 9.5538,
			10.0009, 10.0889, 10.622, 11.1013, 11.3732, 12.3084,
		],
		want: [0.2, 0.117647058824, 0.117647058824, 0.117647058824, 0.294117647059],
	},
	{
		label: '20% dropped, \u00b150 ms jitter',
		ref: [
			2.8856, 3.7769, 4.6683, 5.5596, 6.451, 7.3423, 8.2337, 9.125, 10.0164, 10.9077, 11.7991, 12.6905, 13.5818, 14.4732,
			15.3645, 16.2559, 17.1472, 18.0386,
		],
		est: [
			2.8336, 3.6991, 4.6177, 6.3842, 7.3797, 8.2747, 9.077, 9.9469, 10.89, 11.8687, 12.5495, 13.6081, 14.4194, 15.4165,
			16.202, 17.133, 17.9633,
		],
		want: [0.827586206897, 0.466666666667, 0.8, 0.466666666667, 0.8],
	},
	{
		label: 'a pair exactly 70 ms apart (window edge)',
		ref: [
			2.124, 2.5807, 3.0373, 3.494, 3.9506, 4.4073, 4.864, 5.3206, 5.7773, 6.2339, 6.6906, 7.1472, 7.6039, 8.0606, 8.5172,
			8.9739, 9.4305, 9.8872, 10.3438, 10.8005, 11.2572, 11.7138, 12.1705, 12.6271, 13.0838, 13.5404, 13.9971, 14.4538,
			14.9104, 15.3671, 15.8237, 16.2804, 16.7371, 17.1937, 17.6504, 18.107, 18.5637, 19.0203, 19.477, 19.9337, 20.3903,
			20.847, 21.3036, 21.7603, 22.2169,
		],
		est: [
			2.1489, 2.5379, 3.021, 3.611, 3.8902, 4.3836, 4.9172, 5.3126, 6.1933, 7.0811, 7.6307, 8.5682, 9.0439, 9.4332,
			10.3961, 10.7489, 11.2656, 11.6799, 12.1792, 12.6647, 13.1373, 14.8609, 15.8871, 16.2567, 16.6858, 17.1852, 17.5772,
			19.0206, 19.4915, 19.9236, 20.4171, 20.8312, 21.3038, 22.1449,
		],
		want: [0.769230769231, 0.131578947368, 0.394736842105, 0.131578947368, 0.394736842105],
	},
]

describe('WO-872: beat metrics match mir_eval 0.8.2', () => {
	for (const c of CASES) {
		it(c.label, () => {
			const ref = trimBeats(c.ref)
			const est = trimBeats(c.est)
			const k = continuity(ref, est)
			const got = [fMeasure(ref, est), k.cmlc, k.cmlt, k.amlc, k.amlt]
			got.forEach((g, i) =>
				assert.ok(Math.abs(g - c.want[i]) < 1e-9, `${['F', 'CMLc', 'CMLt', 'AMLc', 'AMLt'][i]} ${g} != ${c.want[i]}`)
			)
		})
	}
	it('reference variations: off-beat, double and both halves', () => {
		const [orig, off, dbl, odd, even] = variations([1, 2, 3, 4])
		assert.deepEqual(orig, [1, 2, 3, 4])
		assert.deepEqual(off, [1.5, 2.5, 3.5])
		assert.deepEqual(dbl, [1, 1.5, 2, 2.5, 3, 3.5, 4])
		assert.deepEqual(odd, [1, 3])
		assert.deepEqual(even, [2, 4])
	})
	it('empty or single-beat input scores 0 (mir_eval returns 0 there too)', () => {
		assert.equal(fMeasure([], [1, 2]), 0)
		assert.deepEqual(continuity([6], [6, 7]), { cmlc: 0, cmlt: 0, amlc: 0, amlt: 0 })
	})
	it('tempo Acc1 is ±4 %, Acc2 also allows ×2, ×½, ×3, ×⅓', () => {
		assert.deepEqual(tempoAccuracy(120, 124), { acc1: 1, acc2: 1 })
		assert.deepEqual(tempoAccuracy(120, 126), { acc1: 0, acc2: 0 })
		assert.deepEqual(tempoAccuracy(120, 60.5), { acc1: 0, acc2: 1 })
		assert.deepEqual(tempoAccuracy(90, 180), { acc1: 0, acc2: 1 })
		assert.deepEqual(tempoAccuracy(60, 180), { acc1: 0, acc2: 1 })
		assert.deepEqual(tempoAccuracy(120, 0), { acc1: 0, acc2: 0 })
	})
})
