#!/usr/bin/env node
'use strict'

// WO-979: the imitated camera moved to src/tracking/detect-sim.js (a live box runs it via detection.simulate). This
// shim keeps HIGHASCG_TRACKING_PYTHON=<this file> working for the sandboxes.
const sim = require('../../src/tracking/detect-sim')

if (require.main === module) sim.main()
module.exports = sim
