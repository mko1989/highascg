'use strict'

/**
 * WO-717 — owner 23.10.26: "make sure the vsync and GPU texture always follow best practice, and don't change
 * even on template iso". src/config/screen-consumer-policy.js forces vsync off + gpu-texture on onto every
 * `<screen>` consumer of ANY Caspar XML; run.sh applies it to casparcg.config before every launch, and both
 * node write paths that can carry hand-written XML apply it before writing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { enforceScreenConsumerPolicy } = require('../../src/config/screen-consumer-policy')
const { main: enforceFile } = require('../../tools/runtime/enforce-screen-consumer-policy')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const screens = (xml) => [...xml.matchAll(/<screen>([\s\S]*?)<\/screen>/g)].map((m) => m[1])
const policyClean = (b) =>
	(b.match(/<vsync\b[^>]*>[^<]*<\/vsync>|<vsync\s*\/>/g) || []).join() === '<vsync>false</vsync>' &&
	(b.match(/<gpu-texture\b[^>]*>[^<]*<\/gpu-texture>|<gpu-texture\s*\/>/g) || []).join() === '<gpu-texture>true</gpu-texture>'

/** The pre-WO-716 ISO template's consumer: vsync on, no gpu-texture. */
const OLD = `<channels>
        <channel>
            <consumers>
                <screen>
                    <device>1</device>
                    <vsync>true</vsync>
                    <high-bitdepth>false</high-bitdepth>
                </screen>
                <decklink><device>1</device></decklink>
            </consumers>
        </channel>
        <channel><consumers><screen><device>2</device><vsync>TRUE</vsync><gpu-texture>false</gpu-texture></screen></consumers></channel>
        <!-- <screen><vsync>true</vsync></screen> a commented-out consumer is left alone -->
        <channel><consumers><screen><gpu-texture/><vsync/></screen></consumers></channel>
    </channels>`

test('WO-717: every <screen> gets vsync false + gpu-texture true; everything else is byte-identical', () => {
	const r = enforceScreenConsumerPolicy(OLD)
	assert.equal(r.changed, true)
	assert.equal(r.screens, 3)
	for (const b of screens(r.xml.replace(/<!--[\s\S]*?-->/g, ''))) assert.ok(policyClean(b), b)
	assert.match(r.xml, /<high-bitdepth>false<\/high-bitdepth>\n {20}<gpu-texture>true<\/gpu-texture>\n {16}<\/screen>/,
		'an inserted line takes the indentation of the block')
	assert.match(r.xml, /<!-- <screen><vsync>true<\/vsync><\/screen> a commented-out consumer is left alone -->/)
	assert.match(r.xml, /<decklink><device>1<\/device><\/decklink>/)
	const strip = (x) => x.replace(/<screen>[\s\S]*?<\/screen>/g, '')
	assert.equal(strip(r.xml.replace(/<!--[\s\S]*?-->/g, '')), strip(OLD.replace(/<!--[\s\S]*?-->/g, '')))
})

test('WO-717: idempotent, and XML without consumers is untouched', () => {
	const once = enforceScreenConsumerPolicy(OLD).xml
	assert.deepEqual(enforceScreenConsumerPolicy(once), { xml: once, changed: false, screens: 3 })
	const none = '<configuration><channels><channel><consumers/></channel></channels></configuration>'
	assert.deepEqual(enforceScreenConsumerPolicy(none), { xml: none, changed: false, screens: 0 })
})

test('WO-717: the ISO template is policy-clean (enforcing it is a no-op)', () => {
	const iso = read('config/casparcg.config.iso')
	const r = enforceScreenConsumerPolicy(iso)
	assert.ok(r.screens >= 1)
	assert.equal(r.changed, false, 'casparcg.config.iso must already carry vsync false + gpu-texture true')
})

test('WO-717: the file tool rewrites a stale config once, then leaves it; a missing file is not an error', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo717-'))
	const file = path.join(dir, 'casparcg.config')
	fs.writeFileSync(file, OLD)
	assert.match(enforceFile(file), /^fixed 3 /)
	assert.equal(fs.readFileSync(file, 'utf8'), enforceScreenConsumerPolicy(OLD).xml)
	assert.match(enforceFile(file), /already/)
	assert.deepEqual(fs.readdirSync(dir), ['casparcg.config'], 'no temp file left behind')
	assert.match(enforceFile(path.join(dir, 'missing.config')), /cannot read/)
	fs.rmSync(dir, { recursive: true, force: true })
})

test('WO-717 source pins: run.sh enforces before every launch; both XML write paths enforce', () => {
	const run = read('run.sh')
	const body = /run_caspar\(\) \{([\s\S]*?)\n\}/.exec(run)
	assert.ok(body, 'run_caspar() exists')
	assert.match(body[1], /enforce-screen-consumer-policy\.js" "\$CONFIG_PATH"/, 'run_caspar enforces on the launch config')
	assert.ok(body[1].indexOf('enforce-screen-consumer-policy') < body[1].indexOf('"$CASPAR_BIN"'),
		'before the binary starts')
	assert.match(read('src/api/routes-caspar-config.js'), /= enforceScreenConsumerPolicy\(rawXml\)/)
	assert.match(read('src/api/routes-project.js'), /enforceScreenConsumerPolicy\(payload\.casparcgConfig\)\.xml/)
})
