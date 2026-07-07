'use strict'

const layout = require('./x-display-session-layout')
const runtime = require('./x-display-session-runtime')

module.exports = {
	...layout,
	...runtime,
}
