try {
	const { SamplingManager } = require('../src/sampling/dmx-sampling')
	console.log('SamplingManager import OK')
} catch (e) {
	console.error('SamplingManager import FAILED:', e)
}
