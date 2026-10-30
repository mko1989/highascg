'use strict'

/**
 * WO-846: regenerate work/work-orders/INDEX.md from the WO headers. Never hand-edit it. (Tools that need the data
 * call wo-lib `readWorkOrders()` — no JSON copy, it would only double every rg hit.)
 *
 * INDEX.md is what an agent reads (or rg's) first: one line per WO, grouped by primary area, deprecated last.
 * Line shape (stable, grep-friendly):  `- 845 DONE [amcp+audio,media] AMCP client… → 845_WO_sweep_amcp….md`
 *
 * CLI: node tools/wo/build-index.js [--check]   (--check: exit 1 when the files on disk are stale)
 */

const fs = require('fs')
const path = require('path')
const { WO_DIR, AREAS, readWorkOrders } = require('./wo-lib')

const INDEX_MD = path.join(WO_DIR, 'INDEX.md')
const TITLE_MAX = 80

function line(r) {
	const [primary, ...rest] = r.area.length ? r.area : ['?']
	const tag = rest.length ? `${primary}+${rest.join(',')}` : primary
	const title = r.title.length > TITLE_MAX ? r.title.slice(0, TITLE_MAX - 1).trimEnd() + '…' : r.title
	return `- ${r.wo} ${r.status || '?'} [${tag}] ${title} → ${r.file}`
}

/** @param {ReturnType<typeof readWorkOrders>} rows */
function renderIndex(rows) {
	const live = rows.filter((r) => !r.file.startsWith('deprecated/'))
	const dead = rows.filter((r) => r.file.startsWith('deprecated/'))
	const count = (s) => live.filter((r) => r.status === s).length
	const out = [
		'# Work-order index (generated — `node tools/wo/build-index.js`, do not edit)',
		'',
		`${live.length} live WOs (${count('OPEN')} open, ${count('IN PROGRESS')} in progress, ${count('DONE')} done) and ` +
			`${dead.length} deprecated. Line: \`- <WO> <STATUS> [<area>+<other areas>] <title> → <file>\`; paths are`,
		'relative to `work/work-orders/`. Search it instead of the WO files: `rg -i "<keyword>" work/work-orders/INDEX.md`;',
		'not done: `rg " (OPEN|IN PROGRESS) " work/work-orders/INDEX.md`; one area: `rg "\\[audio" …`. Then open the file.',
		'Deprecated WOs live in `deprecated/` and are NOT a source of truth — follow the successor named in their status.',
		'',
	]
	for (const [area, desc] of Object.entries(AREAS)) {
		const inArea = live.filter((r) => r.area[0] === area)
		if (!inArea.length) continue
		out.push(`## ${area} — ${desc} (${inArea.length})`, '', ...inArea.map(line), '')
	}
	const noArea = live.filter((r) => !AREAS[r.area[0]])
	if (noArea.length) out.push('## Unclassified', '', ...noArea.map(line), '')
	out.push(`## Deprecated (${dead.length})`, '', ...dead.map(line), '')
	return out.join('\n')
}

function build({ check = false } = {}) {
	const rows = readWorkOrders()
	const md = renderIndex(rows)
	const stale = (fs.existsSync(INDEX_MD) ? fs.readFileSync(INDEX_MD, 'utf8') : '') !== md
	if (!check) fs.writeFileSync(INDEX_MD, md)
	return { rows, stale }
}

module.exports = { renderIndex, build, INDEX_MD }

if (require.main === module) {
	const check = process.argv.includes('--check')
	const { rows, stale } = build({ check })
	if (check && stale) {
		console.error('[wo-index] STALE — run: node tools/wo/build-index.js')
		process.exit(1)
	}
	console.log(`[wo-index] ${check ? 'up to date' : 'wrote INDEX.md'} (${rows.length} WOs)`)
}
