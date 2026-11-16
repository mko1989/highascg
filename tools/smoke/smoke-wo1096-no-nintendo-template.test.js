'use strict'

/**
 * WO-1096 guard: the WO-232 game template (template/mario, vendored from reruns/mario) shipped Nintendo's
 * Super Mario Bros. sprite sheets and sound effects. The MIT licence covered only the engine code, so the
 * owner dropped the template ("Mario template: drop"). This smoke fails if it comes back: the folder, a
 * Nintendo character name in a template path, or any of the removed sprite/sound files under another name
 * (matched by SHA-256, so a rename or a move inside template/ is still caught).
 *
 * template/shaders/ is out of scope for the name check: SH-MARIO is a Shadertoy shader handled by the
 * WO-1096 shader licence split, not this template. The content-hash check covers the whole template/ tree.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..', '..')
const TEMPLATE_DIR = path.join(REPO_ROOT, 'template')

/** SHA-256 of the removed Nintendo files (git HEAD before WO-1096: template/mario/sprites/*, sounds/*.wav). */
const NINTENDO_ASSET_SHA256 = new Map([
	['def80c69067e925cbf14d3ac2601c77beefce40e9eb3944b41e6a126561e0262', 'sounds/breakblock.wav'],
	['8f336b9857810d104f10e81ec3cb626e57fb8790babbf1a0025788040e38c5f8', 'sounds/bump.wav'],
	['b94e81c94fae7f28fa20de96c1b7710271cc3fee538d0673272000587d51c38f', 'sounds/coin.wav'],
	['0ab68ae00b476f4f75ae9b6b30ff2f8d30af88ba1d7bf282206bc1deb8c7a5c5', 'sounds/fireball.wav'],
	['fd660d39a39f7f90ed58c63f97b4a133f80bfcdb9fbb5a319d142b1fb570f557', 'sounds/flagpole.wav'],
	['dc76b01e4b46817d36dc7f767e0bf78f5aa47074aeba1a7ab73079235963db39', 'sounds/itemAppear.wav'],
	['9a1c26efa3447fbcbe0f1892d0569e0dded82dd3ff107e72d66d04c5753d6e51', 'sounds/jump-small.wav'],
	['8de33b3f7ec8fc3207921f95a927a4889c7a5cc86a9beff805cd8707bf5d1a15', 'sounds/jump-super.wav'],
	['41f7305578610aa409a69fae8094f2f5b809f28661eb649dfe2fc6f415daafc4', 'sounds/kick.wav'],
	['9934dbf26c48c4219d3770c5eedd5f1fc1a1e616c98d0413fae0ba9d4533f005', 'sounds/mariodie.wav'],
	['bd8f36627e83b155584b7b038ce1155ea8632760c521e2ec9fffbeed5b22c772', 'sounds/pipe.wav'],
	['af56b835aa2f6fc773b2c5c8b4fc3ae034dffb84ae5b61193d6b149301dd211b', 'sounds/powerup.wav'],
	['44f78f4ffdfa3b8566efb8dbe48a188e391b471eefa20aec175e16ba6a3ee105', 'sounds/stage_clear.wav'],
	['91e68666743fedfd4641fdba7251c008e66ff50ea496ebda951aead1cd7024fe', 'sounds/stomp.wav'],
	['5a691e8f783fd96795a8768927e46f3c789ee7ca6ea6c0c09f4edc9f1509146d', 'sprites/enemy.png'],
	['94125764ef6a4ca6a5f7333c897c4f950058d512f946a633fb613d0a345cb70b', 'sprites/enemyr.png'],
	['7ed185982eab4d7f2739f84de68a819373bc253c95632db468629098f40d1d9b', 'sprites/items.png'],
	['166976fcc80c2df5fc05d63e87793e8eb8dd2d8e5bceb7d9b23ca35a204f705b', 'sprites/player.png'],
	['fb87b44c2af76a33be11529b6b6cde1886f186516a290f365fe86da46eea0b54', 'sprites/playerl.png'],
	['d35080a0e4594fb94570a2e84237f05959d0bd95b962445698b9bd2513eb0675', 'sprites/tiles.png'],
])

const NINTENDO_NAME_RE = /mario|luigi|goomba|koopa|bowser|nintendo/i

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name)
		if (ent.isDirectory()) walk(p, out)
		else if (ent.isFile()) out.push(p)
	}
	return out
}

test('WO-1096: template/mario is gone (Nintendo sprites/sounds; owner dropped the template)', () => {
	assert.equal(fs.existsSync(path.join(TEMPLATE_DIR, 'mario')), false, 'template/mario must not exist')
})

test('WO-1096: no template path outside template/shaders names a Nintendo character', () => {
	const offenders = walk(TEMPLATE_DIR)
		.map((f) => path.relative(TEMPLATE_DIR, f))
		.filter((rel) => !rel.startsWith('shaders' + path.sep))
		.filter((rel) => NINTENDO_NAME_RE.test(rel))
	assert.deepEqual(offenders, [], `Nintendo-named template paths: ${offenders.join(', ')}`)
})

test('WO-1096: none of the removed Nintendo sprite/sound files is back anywhere under template/', () => {
	const offenders = []
	for (const f of walk(TEMPLATE_DIR)) {
		if (!/\.(png|gif|bmp|webp|wav|ogg|mp3|flac|m4a)$/i.test(f)) continue
		const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
		if (NINTENDO_ASSET_SHA256.has(sha)) {
			offenders.push(`${path.relative(TEMPLATE_DIR, f)} (= ${NINTENDO_ASSET_SHA256.get(sha)})`)
		}
	}
	assert.deepEqual(offenders, [], `removed Nintendo assets found: ${offenders.join(', ')}`)
})

test('WO-1096: hash table holds the 20 removed sprite/sound files as SHA-256 hex', () => {
	assert.equal(NINTENDO_ASSET_SHA256.size, 20)
	for (const sha of NINTENDO_ASSET_SHA256.keys()) assert.match(sha, /^[0-9a-f]{64}$/)
})
