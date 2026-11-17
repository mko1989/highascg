// mqdecode.js <latest.json> [out.json] — decode the captured console frames with the Narvil project's patch
const R = '/home/casparcg/highascg/'
const store = require(R + 'src/fixtures/gdtf-store'); const { decodeVisual } = require(R + 'src/fixtures/gdtf-visual')
const fs = require('fs')
const cap = JSON.parse(fs.readFileSync(process.argv[2])); const patch = JSON.parse(fs.readFileSync(R + 'projects/narvil.json')).fixtures.patch
const out = []
for (const fx of patch) {
	const v = store.visual(fx.typeId, fx.mode); if (!v) { out.push({ name: fx.name, err: 'no plan' }); continue }
	const buf = Buffer.from(cap.u[String(fx.universe)] || new Array(512).fill(0))
	const d = decodeVisual(v.plan || v, buf, fx.address)
	const plan = v.plan || v
	let pan = null, tilt = null
	for (const c of plan.axes) { const a = (c.functions || []).map((f) => f.attribute).find((x) => x === 'Pan' || x === 'Tilt'); if (a === 'Pan' && d.axes[c.geometry] != null) pan = d.axes[c.geometry]; if (a === 'Tilt' && d.axes[c.geometry] != null) tilt = d.axes[c.geometry] }
	const B = Object.values(d.beams); const lit = B.filter((b) => b.i > 0.004)
	const w = lit.reduce((s, b) => s + b.i, 0)
	let col = B.filter((b) => Math.max(...b.c) > 0)
	const tinted = col.filter((b) => Math.min(...b.c) < 0.999); if (tinted.length) col = tinted // a beam with no emitter of its own reads white
	const c = col.length ? [0, 1, 2].map((k) => +(col.reduce((s, b) => s + b.c[k], 0) / col.length).toFixed(3)) : [0, 0, 0]
	out.push({ name: fx.name, kind: fx.name.replace(/ \d+$/, ''), u: fx.universe, a: fx.address, pose: fx.pose, pan, tilt, i: +(B.length ? Math.max(...B.map((b) => b.i)) : 0).toFixed(3), mean: +(B.length ? w / B.length : 0).toFixed(3), c, zoom: B[0]?.zoom, gobo: B[0]?.gobo || '', cells: B.length, litCells: lit.length })
}
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out))
else { const k = {}; for (const o of out) (k[o.kind] ||= []).push(o); for (const [n, a] of Object.entries(k)) console.log(n, a.length, 'lit', a.filter((o) => o.i > 0).length, JSON.stringify(a.slice(0, 2).map(({ pose, name, kind, ...r }) => r))) }
