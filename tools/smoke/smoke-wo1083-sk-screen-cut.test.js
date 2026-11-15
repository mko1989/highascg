'use strict'

/**
 * WO-1083 follow-up — Stage Skirmish: an LED wall picture standing over the active arena is cut like the room, so the
 * top-down camera always sees the soldiers. The kit's stage effects put each scene `screens` entry as a `screen:<id>`
 * quad on the scene root (never in world.statics, which the cut-away plane covered), and on the live room `led_wall_2`
 * (5 × 4 m, centre [-4.5, 3.5, -5]) stands in the middle of the `stage` arena — a black slab over the play when
 * programme 1 is black. client/screen-cut.js decides (pure, checked here on the live room's numbers); client/sk-world.js
 * gives those pictures the plane (pinned by source), game.js passes the arena rect and re-checks after new screens.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const CLIENT = path.join(ROOT, 'modules/toy-skirmish/client')
const read = (f) => fs.readFileSync(f, 'utf8')

/** The plan box of an upright, unrotated wall picture (scene `screens` entry, metres). */
const boxOf = (s) => ({ min: [s.p[0] - s.size[0] / 2, s.p[1] - s.size[1] / 2, s.p[2] - 0.02], max: [s.p[0] + s.size[0] / 2, s.p[1] + s.size[1] / 2, s.p[2] + 0.02] })
const S = 0.1
/* the live room (scene rev 405f970d98a2, 15.11.26): two pgm1 walls, the stage arena and one hall arena */
const WALL_1 = { id: 'led_wall_1', p: [2, 3.5, -9], size: [7, 4] } // the stage's back wall
const WALL_2 = { id: 'led_wall_2', p: [-4.5, 3.5, -5], size: [5, 4] } // stands in the stage arena
const STAGE = [-7.31, -9.14, -1.31, -1.16]
const TABLES = [4.138, 12.253, 10.528, 18.643]

test('which pictures the cut takes (client/screen-cut.js), on the live room\'s numbers', async () => {
	const C = await import(path.join(CLIENT, 'screen-cut.js'))
	assert.equal(C.screenOverArena(boxOf(WALL_2), STAGE, S), true, 'the wall in the middle of the stage arena is cut')
	assert.equal(C.screenOverArena(boxOf(WALL_1), STAGE, S), false, 'the wall along the far edge stays: a backdrop, it hides no floor')
	assert.equal(C.screenOverArena(boxOf(WALL_2), TABLES, S), false, 'playing in the hall, both walls show the show')
	assert.equal(C.screenOverArena(boxOf(WALL_1), TABLES, S), false)
	// the margins: 1 m on the sides and towards the camera (+Z), nothing behind the far edge's 0.5 m band
	const at = (x, z) => boxOf({ p: [x, 3.5, z], size: [0.4, 4] })
	assert.equal(C.screenOverArena(at(-7.31 - 0.2 - 0.95, -5), STAGE, S), true, 'just inside the side margin')
	assert.equal(C.screenOverArena(at(-7.31 - 0.2 - 1.05, -5), STAGE, S), false, 'just outside it')
	assert.equal(C.screenOverArena(at(-4, -1.16 + 0.95), STAGE, S), true, 'between the camera and the arena')
	assert.equal(C.screenOverArena(at(-4, -1.16 + 1.05), STAGE, S), false)
	assert.equal(C.screenOverArena(at(-4, -9.14 + 0.45), STAGE, S), false, 'in the backdrop band')
	assert.equal(C.screenOverArena(at(-4, -9.14 + 0.55), STAGE, S), true, 'in front of it')
	assert.equal(C.screenOverArena(boxOf(WALL_2), null, S), false, 'no arena, no cut')
	assert.equal(C.screenOverArena({ min: [NaN, 0, 0], max: [1, 1, 1] }, STAGE, S), false)
})

test('the wiring: the kit names its pictures screen:<id>; sk-world cuts those over the arena; game.js feeds it', () => {
	const kit = read(path.join(ROOT, 'modules/rc-game/client/stage-fx-wall.js'))
	assert.match(kit, /mesh\.name = `screen:\$\{s\.id\}`/, 'the kit\'s picture quads are named screen:<id> (the interface)')
	const w = read(path.join(CLIENT, 'sk-world.js'))
	assert.match(w, /import \{ screenOverArena \} from '\.\/screen-cut\.js'/)
	assert.match(w, /o\.name\.startsWith\('screen:'\)/)
	assert.match(w, /screenOverArena\(\{ min: box\.min\.toArray\(\), max: box\.max\.toArray\(\) \}, arenaRect, arenaS\) \? planes : null/)
	assert.match(w, /world\.setCut = \(y, s, rect = null\) => \{[\s\S]*?clipAll\(\)\s*clipScreens\(\)/)
	const g = read(path.join(CLIENT, 'game.js'))
	assert.match(g, /G\.world\.setCut\(G\.arena\.y, G\.s, G\.arena\.rect\)/)
	assert.match(g, /G\.fx\?\.load\(G\.scene\)\n\tG\.world\.clipScreens\(\)/)
})
