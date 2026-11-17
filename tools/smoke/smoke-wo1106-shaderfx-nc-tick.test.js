'use strict'
/** WO-1106 B67 follow-up: the web Shader FX modal can knowingly keep a NonCommercial shader (tick), shows the refusal and marks NC rows. */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const src = fs.readFileSync(path.join(__dirname, '../../client/components/shader-fx-modal.js'), 'utf8')

test('modal has an unticked NC tick with the owner wording', () => {
	assert.match(src, /id="shaderfx-allow-nc"(?![^>]*checked)[^>]*>\s*Allow non-commercial licence \(non-paid work on this machine only\)/)
})
test('flag is sent only when ticked, on import and save', () => {
	assert.match(src, /checked \? \{ allowNonCommercial: true \} : \{\}/)
	assert.match(src, /'\/api\/shaders\/import', \{ url, \.\.\.ncFlag\(\) \}/)
	assert.match(src, /'\/api\/shaders', \{ \.\.\.collectForm\(\), \.\.\.ncFlag\(\) \}/)
})
test('server refusal is shown on both paths', () => {
	assert.match(src, /Import failed: \$\{ncMessage\(e\)\}/)
	assert.match(src, /setStatus\(ncMessage\(e\), 'err'\)/)
})
test('list marks shaders the server reports as nonCommercial', () => {
	assert.match(src, /s\.nonCommercial \?[^\n]*s\.licenceNote/)
})
