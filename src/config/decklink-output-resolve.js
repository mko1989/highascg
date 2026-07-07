'use strict'

const modes = require('./decklink-output-resolve-modes')
const feed = require('./decklink-output-resolve-feed')
const status = require('./decklink-output-resolve-status')

module.exports = {
	...modes,
	...feed,
	...status,
}
