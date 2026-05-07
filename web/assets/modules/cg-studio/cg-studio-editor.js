/**
 * GrapesJS integration for HighAsCG Template Editor.
 */

// Browser runtime in HighAsCG has no bundler/import-map for bare specifiers.
// Optional modules expose npm deps via `/vendor/*` mounts from `Modules.buildVendorDirs`.
import grapesjs from '/vendor/grapesjs/dist/grapes.mjs'

export async function initEditor(container) {
	// 1. Create layout
	const header = document.createElement('div')
	header.className = 'cg-studio-toolbar'
	
	const nameInp = document.createElement('input')
	nameInp.type = 'text'
	nameInp.placeholder = 'Template Name (e.g. lowerthird)'
	nameInp.className = 'header-project__name'
	nameInp.style.marginRight = '8px'

	const saveBtn = document.createElement('button')
	saveBtn.className = 'header-btn'
	saveBtn.textContent = '💾 Save & Deploy'

	const statusSpan = document.createElement('span')
	statusSpan.style.cssText = 'font-size: 11px; align-self: center; opacity: 0.7;'

	header.append(nameInp, saveBtn, statusSpan)

	const editorWrap = document.createElement('div')
	editorWrap.style.cssText = 'flex: 1; display: flex; position: relative; min-height: 0;'
	
	const canvasWrap = document.createElement('div')
	canvasWrap.style.cssText = 'flex: 1; position: relative;'
	
	// We will render GrapesJS panels into this hidden div, 
	// and then when selected, we append them to the HighAsCG inspector.
	const hiddenPanels = document.createElement('div')
	hiddenPanels.style.display = 'none'

	editorWrap.append(canvasWrap, hiddenPanels)
	container.append(header, editorWrap)

	// 2. Initialize GrapesJS
	const editor = grapesjs.init({
		container: canvasWrap,
		height: '100%',
		width: '100%',
		storageManager: false, // We handle storage via API
		panels: { defaults: [] }, // Disable default panels
		blockManager: { appendTo: hiddenPanels },
		styleManager: { appendTo: hiddenPanels },
		traitManager: { appendTo: hiddenPanels },
		selectorManager: { appendTo: hiddenPanels },
		canvas: {
			width: '1920px',
			height: '1080px',
			styles: []
		}
	})

	editor.on('load', () => {
		// 1. Force transparent body/html inside the iframe canvas
		const doc = editor.Canvas.getDocument();
		if (doc) {
			const style = doc.createElement('style');
			style.textContent = `
				body { background-color: transparent !important; margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
				html { background-color: transparent !important; width: 100%; height: 100%; }
				* { box-sizing: border-box; }
			`;
			doc.head.appendChild(style);
		}

		// 2. Force the wrapper (the body component) to be transparent in its internal style
		const wrapper = editor.getWrapper()
		if (wrapper) {
			wrapper.set('style', { 'background-color': 'transparent' })
		}

		// 3. Dynamic Zoom: Fit the 1080p frame into 75% of the available height
		const fitZoom = () => {
			const canvasEl = editor.Canvas.getElement();
			if (canvasEl) {
				const h = canvasEl.offsetHeight;
				if (h > 0) {
					// We want the 1080px frame to be 75% of 'h'
					const targetH = h * 0.75;
					const zoom = (targetH / 1080) * 100;
					editor.Canvas.setZoom(zoom);
				}
			}
		};
		fitZoom();
		// Also refit on window resize
		window.addEventListener('resize', fitZoom);
	})

	// Add basic blocks
	const bm = editor.BlockManager
	bm.add('text', {
		label: 'Text',
		content: '<div style="padding:10px; font-family: sans-serif; font-size: 32px; color: white;">Insert text here</div>',
	})
	bm.add('box', {
		label: 'Box',
		content: '<div style="width:200px; height:100px; background-color: #007bff;"></div>',
	})

	// 3. Save logic
	saveBtn.onclick = async () => {
		const tplName = nameInp.value.trim()
		if (!tplName) {
			alert('Please provide a template name.')
			return
		}
		saveBtn.disabled = true
		statusSpan.textContent = 'Saving...'
		try {
			const projectData = editor.getProjectData()
			const html = editor.getHtml()
			const css = editor.getCss()

			const res = await fetch('/api/cg-studio/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: tplName, projectData, html, css })
			})
			if (!res.ok) throw new Error(await res.text())
			
			statusSpan.textContent = 'Saved to /template/' + tplName
			setTimeout(() => { statusSpan.textContent = '' }, 3000)
		} catch (e) {
			console.error(e)
			statusSpan.textContent = 'Error: ' + e.message
		} finally {
			saveBtn.disabled = false
		}
	}

	// 4. Hook into HighAsCG Inspector
	// Listen for our external render event
	window.addEventListener('highascg-inspector-render-external', (e) => {
		const { root, selection } = e.detail
		if (selection?.type === 'cg-studio') {
			e.detail.handled = true
			
			// Build a container for GrapesJS tools
			root.innerHTML = ''
			
			const title = document.createElement('h3')
			title.style.cssText = 'padding: 8px 12px; margin: 0; font-size: 12px; text-transform: uppercase; opacity: 0.6; border-bottom: 1px solid var(--border-color);'
			title.textContent = 'Template Properties'
			root.appendChild(title)

			// Move panels from hidden area to the inspector
			hiddenPanels.style.display = 'block'
			hiddenPanels.style.height = '100%'
			hiddenPanels.style.overflow = 'auto'
			root.appendChild(hiddenPanels)
		} else {
			// If it's not our selection, put panels back in hiding
			if (hiddenPanels.parentNode !== editorWrap) {
				hiddenPanels.style.display = 'none'
				editorWrap.appendChild(hiddenPanels)
			}
		}
	})

	// Dispatch selection from GrapesJS
	editor.on('component:selected', (component) => {
		// Tell HighAsCG that we selected something
		window.dispatchEvent(new CustomEvent('dashboard-select', { detail: null })) // clear dashboard selection
		window.dispatchEvent(new CustomEvent('scene-layer-select', { detail: null }))
		
		// Wait a tick for previous selections to clear, then claim it
		setTimeout(() => {
			const evt = new CustomEvent('highascg-inspector-render-external', { 
				detail: { 
					root: document.getElementById('panel-inspector-scroll'), 
					selection: { type: 'cg-studio', component },
					handled: false
				} 
			})
			// Actually, HighAsCG requires a real state update. But we can just fake it by dispatching our event
			// to the global window and letting inspector-panel pick it up. Wait, `inspector-panel` 
			// doesn't have a generic `update(data)` hook exposed. 
			// We'll just render it directly into `#panel-inspector-scroll` if the tab is active.
			
			const targetRoot = document.getElementById('panel-inspector-scroll')
			if (targetRoot) {
				targetRoot.innerHTML = ''
				const title = document.createElement('h3')
				title.style.cssText = 'padding: 8px 12px; margin: 0; font-size: 12px; text-transform: uppercase; opacity: 0.6; border-bottom: 1px solid var(--border-color);'
				title.textContent = 'Template Properties'
				targetRoot.appendChild(title)

				hiddenPanels.style.display = 'block'
				hiddenPanels.style.height = '100%'
				hiddenPanels.style.overflow = 'auto'
				targetRoot.appendChild(hiddenPanels)
			}
		}, 0)
	})

	editor.on('component:deselected', () => {
		// Return panels to hiding
		if (hiddenPanels.parentNode !== editorWrap) {
			hiddenPanels.style.display = 'none'
			editorWrap.appendChild(hiddenPanels)
		}
	})

	// Add basic CSS for GrapesJS panels inside our dark theme
	const style = document.createElement('style')
	style.textContent = `
		.gjs-one-bg { background-color: var(--bg-panel) !important; }
		.gjs-two-color { color: var(--text) !important; }
		.gjs-three-bg { background-color: var(--bg-dark) !important; }
		.gjs-four-color, .gjs-four-color-h:hover { color: var(--accent) !important; }

		.gjs-pn-views-container { background-color: var(--bg-panel) !important; border-left: 1px solid var(--border) !important; }
		.gjs-pn-panels { background-color: var(--bg-panel) !important; border-bottom: 1px solid var(--border) !important; }
		
		.gjs-sm-sector { border-bottom: 1px solid var(--border) !important; }
		.gjs-sm-title { background-color: var(--bg-elevated) !important; color: var(--text) !important; }
		.gjs-sm-label { color: var(--text-muted) !important; }
		
		.gjs-field { background-color: var(--bg-dark) !important; color: var(--text) !important; border: 1px solid var(--border) !important; border-radius: var(--radius) !important; }
		.gjs-field input, .gjs-field select { color: inherit !important; }
		
		.gjs-clm-tags-field { background-color: var(--bg-dark) !important; border: 1px solid var(--border) !important; }
		.gjs-clm-tag { background-color: var(--bg-elevated) !important; color: var(--text) !important; }
		
		.gjs-block { background-color: var(--bg-elevated) !important; color: var(--text) !important; border: 1px solid var(--border) !important; }
		.gjs-block:hover { border-color: var(--accent) !important; }
		
		.gjs-traits-label { color: var(--text-muted) !important; }
		
		/* Scrollbar styling for GrapesJS */
		.gjs-pn-views-container::-webkit-scrollbar { width: 8px; }
		.gjs-pn-views-container::-webkit-scrollbar-track { background: var(--bg-dark); }
		.gjs-pn-views-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
		.gjs-pn-views-container::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

		/* Canvas and Frame styling */
		.gjs-cv-canvas {
			background-color: var(--color-bg-darker, #111) !important;
			background-image: none !important;
			top: 0 !important;
			width: 100% !important;
			height: 100% !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			overflow: auto !important; /* Allow scroll if canvas is larger than view */
		}
		
		/* The actual frame inside the canvas */
		.gjs-frame {
			box-shadow: 0 0 40px rgba(0,0,0,0.8), 0 0 0 1px var(--border-color) !important;
			background-color: transparent !important;
			background: none !important;
			/* Let GrapesJS handle dimensions via canvas config and zoom transform */
			position: relative !important;
			margin: 100px !important; 
			flex-shrink: 0 !important;
		}
		
		/* Ensure the iframe body itself is transparent */
		.gjs-frame-body {
			background-color: transparent !important;
			background: none !important;
		}

		/* CasparCG specific: checkerboard or dark background for preview is NOT wanted in the actual body,
		   but we can show it in the editor if needed. For now, keep it clean. */
	`
	document.head.appendChild(style)
}
