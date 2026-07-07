'use strict'

const enumerate = require('./alsa-mixer-enumerate')
const controls = require('./alsa-mixer-controls')

module.exports = {
	...enumerate,
	...controls,
}
