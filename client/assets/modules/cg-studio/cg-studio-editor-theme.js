/** Editor-only iframe background (not exported in getHtml/getCss). */
export const CANVAS_CHECKERBOARD_CSS = `
html, body {
	margin: 0;
	padding: 0;
	width: 100%;
	height: 100%;
	overflow: hidden;
	box-sizing: border-box;
}
*, *::before, *::after { box-sizing: border-box; }
body {
	background-color: #1a1a1a;
	background-image:
		linear-gradient(45deg, #222222 25%, transparent 25%),
		linear-gradient(-45deg, #222222 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #222222 75%),
		linear-gradient(-45deg, transparent 75%, #222222 75%);
	background-size: 20px 20px;
	background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}
`

export function injectGrapesThemeOverrides() {
	let style = document.getElementById('cg-studio-gjs-theme')
	if (!style) {
		style = document.createElement('style')
		style.id = 'cg-studio-gjs-theme'
	}
	document.head.appendChild(style)
	style.textContent = `
		#tab-cg-studio .gjs-editor,
		#panel-inspector .cg-studio-inspector-shell .gjs-editor {
			height: 100% !important;
			width: 100% !important;
			background: transparent !important;
			border: none !important;
		}
		#tab-cg-studio #gjs-pn-views-container,
		#tab-cg-studio .gjs-pn-views-container,
		#tab-cg-studio #gjs-pn-panels,
		#tab-cg-studio .gjs-pn-panels,
		#tab-cg-studio #gjs-pn-views,
		#tab-cg-studio .gjs-pn-views,
		#tab-cg-studio #gjs-pn-options,
		#tab-cg-studio .gjs-pn-options,
		#tab-cg-studio .gjs-pn-panel {
			display: none !important;
			width: 0 !important;
			height: 0 !important;
			opacity: 0 !important;
			pointer-events: none !important;
		}
		#tab-cg-studio .gjs-editor-contents {
			width: 100% !important;
			height: 100% !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			position: absolute !important;
		}
		#tab-cg-studio .gjs-cv-canvas {
			width: 100% !important;
			height: 100% !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			margin: 0 !important;
			padding: 0 !important;
			border: none !important;
			background: #141414 !important;
		}
		#tab-cg-studio .gjs-frame-wrapper {
			right: auto !important;
			bottom: auto !important;
			margin: 0 !important;
		}
		#tab-cg-studio .gjs-frame {
			box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px var(--border) !important;
		}
		#tab-cg-studio .gjs-one-bg,
		#panel-inspector .cg-studio-inspector-shell .gjs-one-bg { background-color: var(--bg-panel) !important; }
		#tab-cg-studio .gjs-two-color,
		#panel-inspector .cg-studio-inspector-shell .gjs-two-color { color: var(--text) !important; }
		#tab-cg-studio .gjs-three-bg,
		#panel-inspector .cg-studio-inspector-shell .gjs-three-bg { background-color: var(--bg-dark) !important; }
		#tab-cg-studio .gjs-four-color,
		#tab-cg-studio .gjs-four-color-h:hover,
		#panel-inspector .cg-studio-inspector-shell .gjs-four-color,
		#panel-inspector .cg-studio-inspector-shell .gjs-four-color-h:hover { color: var(--accent) !important; }
		#tab-cg-studio .gjs-sm-sector,
		#panel-inspector .cg-studio-inspector-shell .gjs-sm-sector { border-bottom: 1px solid var(--border) !important; }
		#tab-cg-studio .gjs-sm-title,
		#panel-inspector .cg-studio-inspector-shell .gjs-sm-title { background-color: var(--bg-elevated) !important; color: var(--text) !important; }
		#tab-cg-studio .gjs-field,
		#panel-inspector .cg-studio-inspector-shell .gjs-field { background-color: var(--bg-dark) !important; color: var(--text) !important; border: 1px solid var(--border) !important; }
		#tab-cg-studio .gjs-block,
		#panel-inspector .cg-studio-inspector-shell .gjs-block { background-color: var(--bg-elevated) !important; color: var(--text) !important; border: 1px solid var(--border) !important; }
	`
	document.head.appendChild(style)
}
