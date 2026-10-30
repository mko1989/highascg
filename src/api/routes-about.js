'use strict'

/**
 * WO-616 attribution / AGPL §5(d) — GET /api/about: what both clients' Settings → About pane shows (Appropriate
 * Legal Notices + credits). One source so the Godot and web panes never drift: version from package.json, the
 * copyright line from COPYRIGHT, credits below (the full texts stay in THIRD_PARTY_NOTICES and licenses/INDEX.md).
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const SOURCE = 'https://github.com/mko1989/highascg'

const CREDITS = [
	{
		name: 'OpenFollow',
		what: 'Tracking — camera model, calibration, zones and detection pinning are ported from it',
		license: 'AGPL-3.0-or-later',
		copyright: 'Copyright (C) 2026 The OpenFollow Project – Paul Hermann, Michel Honold, Vinzenz Schultz',
		url: 'https://github.com/openfollowapp/openfollow',
	},
	{
		name: 'fosfora',
		what: 'Beat tracking — onset, tempo and beat-grid design ported from it (WO-872)',
		license: 'MIT OR Apache-2.0',
		copyright: 'Copyright (c) 2025-2026 Kevin Raymond',
		url: 'https://github.com/kevinraymond/fosfora',
	},
	{
		name: 'CasparCG Server',
		what: 'Playout engine',
		license: 'GPL-3.0',
		copyright: 'Copyright (C) Sveriges Television AB and CasparCG contributors',
		url: 'https://github.com/CasparCG/server',
	},
	{
		name: 'Godot Engine',
		what: 'Operator client',
		license: 'MIT',
		copyright: 'Copyright (c) 2014-present Godot Engine contributors; (c) 2007-2014 Juan Linietsky, Ariel Manzur',
		url: 'https://godotengine.org',
	},
	{
		name: 'Ultralytics YOLO26',
		what: 'Person detection weights (installed per machine)',
		license: 'AGPL-3.0',
		copyright: 'Copyright Ultralytics',
		url: 'https://github.com/ultralytics/ultralytics',
	},
	{
		name: 'ONNX Runtime',
		what: 'Person detection inference (installed per machine)',
		license: 'MIT',
		copyright: 'Copyright Microsoft Corporation',
		url: 'https://github.com/microsoft/onnxruntime',
	},
	{
		name: 'Rewir',
		what: 'Interface font ("·" and "•" outlines added, WO-620)',
		license: 'OFL-1.1',
		copyright: 'Copyright © 2016 Stowarzyszenie Kulturotwórcze Miastodwa',
		url: 'https://github.com/warszawskie-kroje/rewir',
	},
]

function readText(root, file) {
	try {
		return fs.readFileSync(path.join(root, file), 'utf8')
	} catch {
		return ''
	}
}

/** The About payload; root = repo root (tests point it at a fixture). */
function aboutInfo(root = ROOT) {
	let version
	try {
		version = String(JSON.parse(readText(root, 'package.json')).version || '')
	} catch {
		version = ''
	}
	const copyright = (
		readText(root, 'COPYRIGHT')
			.split('\n')
			.find((l) => /^Copyright/.test(l.trim())) || ''
	).trim()
	return {
		name: 'HighAsCG',
		version,
		copyright,
		license: 'AGPL-3.0-or-later',
		warranty:
			'This program comes with ABSOLUTELY NO WARRANTY. It is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License, version 3 or later.',
		source: SOURCE,
		notices: 'THIRD_PARTY_NOTICES and licenses/INDEX.md in the source tree',
		credits: CREDITS,
	}
}

function handleGet() {
	return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aboutInfo()) }
}

module.exports = { aboutInfo, handleGet, CREDITS, SOURCE }
