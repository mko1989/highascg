'use strict'

/**
 * WO-1103 — realistic human test puppets (owner 16.11: "try to create a woman and man avatars but try to make them as
 * much human like as possible"; "the hq avatars are for previz purposes only as a 'puppet'"). Proven here:
 *  - the API: `body` cartoon (default, persons unchanged but for body / heading) / woman / man / mixed, refusals, human
 *    heights from the same draw (the walk and looks under a seed are the same whatever the body), `walk: false` stands
 *    them where they are and `walk: true` walks on;
 *  - the shipped bodies (Microsoft Rocketbox, MIT): scenes, moves and textures exist, the licence manifest names every
 *    shipped file with its Rocketbox source at the pinned commit, THIRD_PARTY_NOTICES carries the MIT notice, the
 *    build recipe (fetch at that commit + bake + textures) is in the repo, every texture has a "keep" .import;
 *  - the Godot wiring (source text): the row's Look / Walk controls, the cards carry body + heading, the layer picks the
 *    human node for woman / man only.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const W = require(path.join(ROOT, 'src', 'tracking', 'puppet-wander'))
const { createPuppetPeople, PATH, BODIES, WOMAN_M, MAN_M, OWN_RE, OWN_M } = require(path.join(ROOT, 'src', 'tracking', 'puppet-people'))

const GRID = { width: 3, depth: 15, spacing: 1, x_offset: 11.05, y_offset: -3.5, z_offset: 0.639 }
const PEOPLE = 'godot/client/assets/people'

function mk() {
	let t = 1000
	const p = createPuppetPeople({ stage: () => GRID, now: () => t, timers: { setInterval: () => 1, clearInterval: () => {} } })
	const post = (b) => p.handle('POST', PATH, JSON.stringify(b))
	const walk = (n) => {
		for (let i = 0; i < n; i++) p.step((t += 33))
	}
	return { p, post, walk }
}

describe('WO-1103 human test puppets', () => {
	it('body: cartoon by default, woman / man / mixed, refusals; the walk and the looks do not depend on it', () => {
		assert.deepEqual(BODIES, ['cartoon', 'woman', 'man', 'mixed'])
		const runs = {}
		for (const body of [null, ...BODIES]) {
			const { p, post, walk } = mk()
			const r = post(body ? { enabled: true, count: 3, seed: 11, body } : { enabled: true, count: 3, seed: 11 })
			assert.equal(r.status, 200)
			assert.equal(JSON.parse(r.body).body, body || 'cartoon')
			walk(300)
			runs[body || 'default'] = p.persons()
		}
		const strip = (ps) => ps.map(({ x, y, vx, vy, heading, traits }) => ({ x, y, vx, vy, heading, traits }))
		for (const b of BODIES) assert.deepEqual(strip(runs[b]), strip(runs.default), `${b}: same walk, same looks`)
		assert.deepEqual(runs.default, runs.cartoon, 'no body = cartoon')
		assert.deepEqual(runs.cartoon.map((q) => q.body), ['cartoon', 'cartoon', 'cartoon'])
		assert.deepEqual(runs.mixed.map((q) => q.body), ['woman', 'man', 'woman'], 'mixed: by index')
		for (const q of runs.cartoon) assert.ok(q.height >= W.HEIGHT_M[0] && q.height <= W.HEIGHT_M[1], 'cartoon: the WO-1087 height')
		for (const [b, [lo, hi]] of [['woman', WOMAN_M], ['man', MAN_M]])
			for (const [i, q] of runs[b].entries()) {
				assert.ok(q.height >= lo && q.height <= hi, `${b} ${q.height} in ${lo}–${hi}`)
				const u = (runs.cartoon[i].height - W.HEIGHT_M[0]) / (W.HEIGHT_M[1] - W.HEIGHT_M[0])
				assert.ok(Math.abs(q.height - (lo + (hi - lo) * u)) < 0.001, 'mapped from the same draw')
			}
		assert.ok(Math.abs((WOMAN_M[0] + WOMAN_M[1]) / 2 - 1.68) < 0.005 && Math.abs((MAN_M[0] + MAN_M[1]) / 2 - 1.8) < 0.005, 'means ≈ 1.68 / 1.80 m')
		for (const q of runs.man) assert.ok(Number.isFinite(q.heading) && Math.abs(q.heading) <= Math.PI + 1e-9, 'heading in rad')
		const { p, post } = mk()
		assert.equal(post({ body: 'robot' }).status, 400)
		assert.equal(post({ body: 3 }).status, 400)
		assert.equal(post({ walk: 'no' }).status, 400)
		assert.equal(p.status().body, 'cartoon', 'a refusal changes nothing')
		assert.equal(post({ body: 'man' }).status, 200, 'set while off: kept for the next start')
		post({ enabled: true, count: 1, seed: 3 })
		assert.deepEqual([p.status().body, p.persons()[0].body, p.status().people[0].body], ['man', 'man', 'man'])
	})

	it('own:<slug>: an own character is a body name (the server never sees the model), heights in OWN_M', () => {
		const { p, post, walk } = mk()
		for (const bad of ['own:', 'own:../x', 'own:A', 'own:a/b', `own:${'a'.repeat(49)}`, 'own: x'])
			assert.equal(post({ body: bad }).status, 400, `${bad} refused`)
		assert.ok(OWN_RE.test('own:rb_f01') && OWN_RE.test(`own:${'a'.repeat(48)}`))
		assert.equal(post({ enabled: true, count: 3, seed: 11, body: 'own:rb_f01' }).status, 200)
		walk(100)
		for (const q of p.persons()) {
			assert.equal(q.body, 'own:rb_f01')
			assert.ok(q.height >= OWN_M[0] && q.height <= OWN_M[1], `${q.height} in OWN_M`)
		}
		const row = read('godot/client/features/previs/tracking/puppet_people_row.gd')
		assert.match(row, /Own\.list\(\)/, 'the Look list offers this machine\'s own characters')
		const own = read('godot/client/features/previs/tracking/human_own.gd')
		assert.match(own, /\.local\/share/, 'own characters live in the per-machine data folder')
		for (const f of ['human_own.gd', 'human_own_tex.gd', 'human_own_merge.gd', 'human_retarget.gd', 'human_rig_map.gd']) {
			const src = read(`godot/client/features/previs/tracking/${f}`)
			assert.doesNotMatch(src, /FileAccess\.WRITE|make_dir|ResourceSaver|save_png|write_to_filesystem/, `${f}: reads the model, writes nothing (no derivative in the repo, a project or media/)`)
		}
	})

	it('an own puppet is never distributed: ISO excludes + verifier, sync pairs, Syncthing, git', () => {
		const { spawnSync } = require('node:child_process')
		const os = require('node:os')
		for (const l of ['penguins-eggs-exclude-highascg-fragment.list', 'penguins-eggs-exclude-highascg-embed-server.list']) {
			const lines = read(`tools/eggs/live-usb/${l}`).split('\n')
			for (const w of ['home/*/.local/share/highascg/puppets', 'home/*/.local/share/highascg/puppets/*', 'home/*/.local/share/highascg'])
				assert.ok(lines.includes(w), `${l}: ${w}`)
		}
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1103-'))
		const verify = (lines) => {
			const f = path.join(tmp, `l${Math.random()}.txt`)
			fs.writeFileSync(f, lines.join('\n') + '\n')
			return spawnSync('bash', [path.join(ROOT, 'tools/eggs/live-usb/verify-iso-detection-runtime.sh'), f], { encoding: 'utf8' })
		}
		const clean = ['squashfs-root/home/casparcg/highascg/godot/client/assets/people/woman.scn']
		assert.equal(verify(clean).status, 0, 'the shipped MIT bodies pass')
		for (const bad of ['squashfs-root/home/casparcg/.local/share/highascg/puppets/ada/ada.glb',
			'squashfs-root/home/casparcg/.local/share/highascg/puppets/ada/.converted/ada.glb', 'squashfs-root/home/casparcg/Downloads/x/head.dna'])
			assert.equal(verify([...clean, bad]).status, 1, `${bad}: the ISO build fails`)
		fs.rmSync(tmp, { recursive: true, force: true })
		const { isExcluded } = require(path.join(ROOT, 'src', 'system', 'exfat-sync-map'))
		assert.ok(isExcluded('projects/show/rig/head.dna', []) && !isExcluded('projects/show/look.json', []), 'no stick / bridge pair copies a rig')
		assert.ok(read('.stignore').split('\n').includes('*.dna'), 'Syncthing')
		assert.ok(read('.gitignore').split('\n').includes('*.dna'), 'git')
	})

	it('walk: false stands them where they are, walk: true walks on', () => {
		const { p, post, walk } = mk()
		post({ enabled: true, count: 2, seed: 5, body: 'mixed' })
		walk(200)
		const moving = p.persons()
		assert.ok(moving.some((q) => Math.hypot(q.vx, q.vy) > 0.1), 'walking')
		assert.equal(JSON.parse(post({ walk: false }).body).walk, false)
		walk(1)
		const at = p.persons()
		walk(300)
		const still = p.persons()
		assert.deepEqual(still.map((q) => [q.x, q.y, q.vx, q.vy]), at.map((q) => [q.x, q.y, 0, 0]), 'standing, not moving')
		assert.deepEqual(still.map((q) => q.body), ['woman', 'man'])
		post({ walk: true })
		walk(300)
		assert.notDeepEqual(p.persons().map((q) => [q.x, q.y]), still.map((q) => [q.x, q.y]), 'walking on')
		const rect = W.stageRect(GRID)
		for (const q of p.persons()) assert.ok(W.inside(rect, q.x, q.y), 'still inside the stage')
	})

	it('the shipped bodies: files, "keep" imports, licence manifest, notices, build recipe', () => {
		const man = JSON.parse(read(`${PEOPLE}/LICENSES.json`))
		const COMMIT = '0943055db6ec570bcef9f2c8b41c9e5467c808f9' // the pinned Microsoft Rocketbox commit
		const shipped = fs.readdirSync(path.join(ROOT, PEOPLE)).filter((f) => /\.(scn|res|webp|glb)$/.test(f)).sort()
		for (const b of ['woman', 'man']) {
			for (const f of [`${b}.scn`, `${b}_moves.res`]) assert.ok(shipped.includes(f), `${f} shipped`)
			for (const m of ['body', 'head', 'body_n', 'head_n', 'body_s', 'head_s', 'hair']) assert.ok(shipped.includes(`${b}_${m}.webp`), `${b} ${m} map`)
		}
		assert.deepEqual(man.files.map((e) => e.file).sort(), shipped, 'one manifest row per shipped file, no stale rows')
		for (const e of man.files) {
			assert.equal(e.licence, 'MIT', `${e.file}: MIT`)
			assert.ok(e.from.length >= 1 && e.from.every((s) => s.asset && /Microsoft/.test(s.author) && s.source.startsWith(`https://github.com/microsoft/Microsoft-Rocketbox/tree/${COMMIT}/Assets/`)), `${e.file}: Rocketbox sources at the pinned commit`)
			if (e.file.endsWith('.webp')) assert.equal(read(`${PEOPLE}/${e.file}.import`).trim(), '[remap]\n\nimporter="keep"', `${e.file}: packed as is`)
			assert.ok(fs.statSync(path.join(ROOT, PEOPLE, e.file)).size < 3e6, `${e.file}: small`)
		}
		assert.match(man.licenceQuote, /Copyright \(c\) 2020 Microsoft — Permission is hereby granted, free of charge/)
		assert.equal(man.licenceUrl, `https://github.com/microsoft/Microsoft-Rocketbox/blob/${COMMIT}/LICENSE.md`)
		const notices = read('THIRD_PARTY_NOTICES')
		assert.match(notices, /Microsoft Rocketbox Avatar Library — godot\/client\/assets\/people\//)
		assert.match(notices, /Copyright \(c\) 2020 Microsoft\n\n {2}Permission is hereby granted, free of charge/, 'the MIT notice travels with the files')
		assert.doesNotMatch(notices, /MakeHuman system assets/, 'no stale section for files no longer shipped')
		for (const f of ['tools/people/rocketbox_build.sh', 'tools/people/rocketbox_bake.gd', 'tools/people/rocketbox_tex.py', 'tools/people/README.md'])
			assert.ok(fs.existsSync(path.join(ROOT, f)), `${f}: the recipe is in the repo`)
		assert.match(read('tools/people/rocketbox_build.sh'), new RegExp(`^COMMIT=${COMMIT}$`, 'm'), 'the recipe fetches the pinned commit')
	})

	it('Godot wiring: the row, the cards, the layer', () => {
		const row = read('godot/client/features/previs/tracking/puppet_people_row.gd')
		assert.match(row, /"Cartoon", "Woman", "Man", "Mixed"/)
		assert.match(row, /\{"body": /)
		assert.match(row, /\{"walk": /)
		const cards = read('godot/client/features/previs/tracking/person_cards_model.gd')
		assert.match(cards, /"body": str\(wp\.get\("body", "cartoon"\)\)/)
		const layer = read('godot/client/features/previs/tracking/person_avatars.gd')
		assert.match(layer, /Human\.wants\(/)
		const human = read('godot/client/features/previs/tracking/person_human.gd')
		assert.doesNotMatch(human, /ImageTexture\.create_from_image\(.*camera|texture_slot|lease/i, 'no camera picture on a puppet')
	})
})
