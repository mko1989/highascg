'use strict'
/**
 * WO-904: a whole-show undo snapshot (~38 ms for a 600 KB project) on every edit froze the Visuals output while any
 * value moved (an APC40 fader sends several CCs a frame → 190 ms frames). Edits only arm a settle timer; the snapshot
 * of a detached copy runs on a worker; Ctrl+Z / Ctrl+Y flush first so the last edit still counts.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'godot', 'client', 'core', 'project_undo.gd'), 'utf8')
const fn = (name) => src.slice(src.indexOf(`func ${name}(`), src.indexOf('\nfunc ', src.indexOf(`func ${name}(`) + 1))

describe('WO-904 undo snapshot off the edit path', () => {
	it('an edit only arms the settle timer', () => {
		const edit = fn('_on_edit')
		assert.doesNotMatch(edit, /Model\.snapshot|history\.record\(/)
		assert.match(edit, /_settle\.start\(\)/)
	})
	it('the snapshot runs on a worker from a detached copy', () => {
		const snap = fn('_snap_async')
		assert.match(snap, /Model\.detached\(Store\.project\)/)
		assert.match(snap, /WorkerThreadPool\.add_task\(func\(\) -> void: out\.append\(Model\.canon\(d\)\)/)
	})
	it('undo and redo flush pending edits first', () => {
		assert.match(fn('undo'), /^func undo\(\) -> bool:\n\t_flush\(\)/)
		assert.match(fn('redo'), /^func redo\(\) -> bool:\n\t_flush\(\)/)
	})
	it('a rebase drops a snapshot taken before it', () => {
		assert.match(fn('_on_project'), /_gen \+= 1/)
		assert.match(fn('_collect'), /if _task_gen == _gen/)
	})
})
