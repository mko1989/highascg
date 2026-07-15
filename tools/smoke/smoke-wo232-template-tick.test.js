/**
 * WO-232.7 — template tick for webpage sources
 * Smoke tests: template checkbox + select in both modal and inspector components.
 * Verifies URL construction, .html deduplication, and initialization from template URLs.
 */

'use strict'

const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '../..')

describe('WO-232.7 — template tick for webpage sources', () => {
	describe('live-input-modal-shell.js (creation form)', () => {
		let shellCode
		before(() => {
			const filePath = path.join(repoRoot, 'client/components/live-input-modal-shell.js')
			shellCode = fs.readFileSync(filePath, 'utf8')
		})

		it('should include template checkbox element', () => {
			assert(shellCode.includes('browserUseTemplate'), 'browserUseTemplate checkbox not found')
			assert(shellCode.includes('live-input-browser-use-template'), 'checkbox input id not found')
			assert(shellCode.includes('Template'), 'Template label text not found')
		})

		it('should include template select element', () => {
			assert(shellCode.includes('browserTemplate'), 'browserTemplate select not found')
			assert(shellCode.includes('live-input-browser-template'), 'template select id not found')
			assert(shellCode.includes('— Select a template —'), 'template placeholder option not found')
		})

		it('should expose template checkbox and select in elements dict', () => {
			assert(shellCode.includes('browserUseTemplate,'), 'browserUseTemplate not in elements')
			assert(shellCode.includes('browserTemplate,'), 'browserTemplate not in elements')
			assert(shellCode.includes('templateSelectLabel,'), 'templateSelectLabel not in elements')
		})

		it('should hide template select by default', () => {
			assert(shellCode.includes("templateSelectLabel.style.display = 'none'"), 'template select label default hidden not found')
			assert(shellCode.includes("browserTemplate.style.display = 'none'"), 'template select default hidden not found')
		})
	})

	describe('live-input-modal-submit.js (form submission)', () => {
		let submitCode
		before(() => {
			const filePath = path.join(repoRoot, 'client/components/live-input-modal-submit.js')
			submitCode = fs.readFileSync(filePath, 'utf8')
		})

		it('should handle template checkbox state on submit', () => {
			assert(submitCode.includes('browserUseTemplate?.checked'), 'template checkbox state check not found')
		})

		it('should construct template URL with 127.0.0.1:4200/template/ prefix', () => {
			assert(submitCode.includes("http://127.0.0.1:4200/template/"), 'template URL prefix not found')
		})

		it('should deduplicate .html suffix in template names', () => {
			assert(submitCode.includes("templateName.endsWith('.html')"), '.html check not found')
			assert(submitCode.includes("templateName.slice(0, -5)"), '.html trimming not found')
		})

		it('should validate template name before URL construction', () => {
			assert(submitCode.includes("templateName = (elements.browserTemplate?.value || '').trim()"), 'template name extraction not found')
			assert(submitCode.includes("if (!templateName)"), 'template name validation not found')
		})

		it('should fall back to URL input when template unchecked', () => {
			assert(submitCode.includes("} else {"), 'else block for URL input not found')
			assert(submitCode.includes("(elements.browserUrl?.value || '').trim()"), 'URL input fallback not found')
		})
	})

	describe('live-input-modal.js (modal logic)', () => {
		let modalCode
		before(() => {
			const filePath = path.join(repoRoot, 'client/components/live-input-modal.js')
			modalCode = fs.readFileSync(filePath, 'utf8')
		})

		it('should include syncTemplateUI function', () => {
			assert(modalCode.includes('function syncTemplateUI()'), 'syncTemplateUI function not found')
		})

		it('should populate template select from stateStore templates', () => {
			assert(modalCode.includes("stateStore.getState()?.templates"), 'stateStore templates access not found')
			assert(modalCode.includes("for (const t of templates)"), 'template iteration not found')
		})

		it('should sync checkbox and select visibility', () => {
			assert(modalCode.includes('browserUseTemplate?.checked'), 'checkbox state check not found')
			assert(modalCode.includes("elements.browserUrl.style.display = useTemplate ? 'none' : 'block'"), 'URL visibility toggle not found')
			assert(modalCode.includes("elements.browserTemplate.style.display = useTemplate ? 'block' : 'none'"), 'select visibility toggle not found')
		})

		it('should attach change listener to template checkbox', () => {
			assert(modalCode.includes("elements.browserUseTemplate?.addEventListener('change', syncTemplateUI)"), 'template checkbox listener not found')
		})

		it('should call syncTemplateUI when kind changes to browser', () => {
			assert(modalCode.includes("if (k === 'browser') syncTemplateUI()"), 'syncTemplateUI call on kind change not found')
		})
	})

	describe('inspector-webpage-host.js (edit form)', () => {
		let inspectorCode
		before(() => {
			const filePath = path.join(repoRoot, 'client/components/inspector-webpage-host.js')
			inspectorCode = fs.readFileSync(filePath, 'utf8')
		})

		it('should include template checkbox in Page section', () => {
			assert(inspectorCode.includes('inspector-webpage-host__use-template'), 'template checkbox class not found')
			assert(inspectorCode.includes('inspector-webpage-host-use-template'), 'template checkbox id not found')
		})

		it('should include template select in Page section', () => {
			assert(inspectorCode.includes('inspector-webpage-host__template'), 'template select class not found')
		})

		it('should detect template URL on load', () => {
			assert(inspectorCode.includes("startsWith('http://127.0.0.1:4200/template/')"), 'template URL detection not found')
		})

		it('should extract template name from existing template URL', () => {
			assert(inspectorCode.includes("replace('http://127.0.0.1:4200/template/', '')"), 'template URL path replacement not found')
			assert(inspectorCode.includes("replace(/\\.html$/, '')"), 'template .html extraction not found')
		})

		it('should initialize checkbox checked when template URL detected', () => {
			assert(inspectorCode.includes("${isTemplateUrl ? 'checked' : ''}"), 'template checkbox initial state not found')
		})

		it('should preset select value when template URL detected', () => {
			assert(inspectorCode.includes('if (id === extractedTemplateName) opt.selected = true'), 'template select preset not found')
		})

		it('should sync UI visibility on checkbox change', () => {
			assert(inspectorCode.includes('const syncUI = ()'), 'syncUI function not found')
			assert(inspectorCode.includes("useTemplateCheckbox?.addEventListener('change', syncUI)"), 'template checkbox listener not found')
		})

		it('should pass stateStore to mountWebpageHostPageControls', () => {
			assert(inspectorCode.includes('stateStore,'), 'stateStore passed to mount function')
		})

		it('should construct template URL in reload with deduplication', () => {
			assert(inspectorCode.includes("templateName.endsWith('.html') ? templateName.slice(0, -5) : templateName"), 'template URL deduplication not found')
			assert(inspectorCode.includes("http://127.0.0.1:4200/template/"), 'template URL prefix in reload not found')
		})

		it('should allow Enter key on template select to reload', () => {
			assert(inspectorCode.includes("templateSelect?.addEventListener('keydown', (e) => {"), 'template select keydown listener not found')
			assert(inspectorCode.includes("if (e.key === 'Enter')"), 'Enter key check not found')
		})
	})

	describe('integration', () => {
		it('should have consistent template URL format across both components', () => {
			const shellCode = fs.readFileSync(path.join(repoRoot, 'client/components/live-input-modal-shell.js'), 'utf8')
			const submitCode = fs.readFileSync(path.join(repoRoot, 'client/components/live-input-modal-submit.js'), 'utf8')
			const inspectorCode = fs.readFileSync(path.join(repoRoot, 'client/components/inspector-webpage-host.js'), 'utf8')

			assert(submitCode.includes('http://127.0.0.1:4200/template/'), 'modal submit missing template URL prefix')
			assert(inspectorCode.includes('http://127.0.0.1:4200/template/'), 'inspector missing template URL prefix')
		})

		it('should deduplicate .html in both modal and inspector', () => {
			const submitCode = fs.readFileSync(path.join(repoRoot, 'client/components/live-input-modal-submit.js'), 'utf8')
			const inspectorCode = fs.readFileSync(path.join(repoRoot, 'client/components/inspector-webpage-host.js'), 'utf8')

			assert(submitCode.includes("templateName.endsWith('.html')"), 'modal submit missing .html check')
			assert(inspectorCode.includes("templateName.endsWith('.html')"), 'inspector missing .html check')
		})

		it('should handle empty template selection gracefully', () => {
			const submitCode = fs.readFileSync(path.join(repoRoot, 'client/components/live-input-modal-submit.js'), 'utf8')
			const inspectorCode = fs.readFileSync(path.join(repoRoot, 'client/components/inspector-webpage-host.js'), 'utf8')

			assert(submitCode.includes("if (!templateName)"), 'modal submit missing template name validation')
			assert(inspectorCode.includes("if (!templateName)"), 'inspector missing template name validation')
		})
	})
})
