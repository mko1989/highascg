'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '../..')

test('WO-227: mixer-group--dense class is defined in JS component', () => {
	const jsFile = path.join(projectRoot, 'client/components/audio-mixer-console-input-groups.js')
	const content = fs.readFileSync(jsFile, 'utf8')
	assert.match(content, /mixer-group--dense/, 'mixer-group--dense class not found in audio-mixer-console-input-groups.js')
})

test('WO-227: mixer-group--dense class is styled in CSS', () => {
	const cssFile = path.join(projectRoot, 'client/styles/07c2-audio-mixer-view-console-layout.css')
	const content = fs.readFileSync(cssFile, 'utf8')
	assert.match(content, /\.mixer-group--dense/, 'mixer-group--dense styles not found in 07c2-audio-mixer-view-console-layout.css')
})

test('WO-227: mixer-group--dense has overflow-x:auto for horizontal scroll', () => {
	const cssFile = path.join(projectRoot, 'client/styles/07c2-audio-mixer-view-console-layout.css')
	const content = fs.readFileSync(cssFile, 'utf8')
	assert.match(content, /\.mixer-group--dense.*overflow-x\s*:\s*auto/s, 'overflow-x:auto not found in mixer-group--dense styles')
})

test('WO-227: mixer-group--dense strips have reduced width', () => {
	const cssFile = path.join(projectRoot, 'client/styles/07c2-audio-mixer-view-console-layout.css')
	const content = fs.readFileSync(cssFile, 'utf8')
	assert.match(content, /\.mixer-group--dense\s+\.audio-mixer-view__strip\s*{[\s\S]*?width\s*:\s*80px/m, 'strip width reduction not found in mixer-group--dense styles')
})

test('WO-227: dense class is only added when strips > 4', () => {
	const jsFile = path.join(projectRoot, 'client/components/audio-mixer-console-input-groups.js')
	const content = fs.readFileSync(jsFile, 'utf8')
	assert.match(content, /list\.length\s*>\s*4/, 'Condition for adding mixer-group--dense (> 4 strips) not found')
})
