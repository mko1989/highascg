/** Sources panel DOM shell — tab chrome, list host, ingest footer markup. */

export const SOURCES_PANEL_HTML = `<div class="sources-tabs"><button class="sources-tab active" data-src-tab="media">Media</button><button class="sources-tab" data-src-tab="templates">Templates</button><button class="sources-tab" data-src-tab="placeholders" style="display:none">Placeholders</button><button class="sources-tab" data-src-tab="effects">Effects</button><button class="sources-tab" data-src-tab="live">Live</button><button class="sources-tab" data-src-tab="timelines">Timelines</button></div><div class="sources-project-media-bar" id="sources-project-media-bar" style="display:none"><div class="sources-project-media-bar__info"><span class="sources-project-media-bar__path" id="sources-project-media-path"></span></div><div class="sources-project-media-bar__actions"><label class="sources-project-media-bar__filter" title="Show only clips in this project folder"><input type="checkbox" id="sources-project-media-filter" /><span class="sources-project-media-bar__filter-label">project only</span></label><button type="button" class="sources-gather-btn" id="sources-gather-media" style="display:none" title="Move referenced clips into this project folder">Gather</button></div></div><div class="sources-search" style="display:none"><input type="text" placeholder="Filter…" id="sources-filter" /></div><div class="sources-list" id="sources-list"></div><div class="sources-live-footer" style="display:none"><button type="button" class="sources-refresh-btn" id="sources-live-refresh-btn" title="Refresh live sources from server">↻</button><button type="button" class="sources-live-add-btn" id="sources-live-add-btn">+</button></div><div class="sources-media-footer" style="display:none"><div class="sources-media-selection-bar" id="sources-media-selection-bar" style="display:none"><span class="sources-media-selection-bar__count" id="sources-selection-count">0 selected</span><button type="button" class="sources-media-action-btn" id="sources-copy-selected">Copy to…</button><button type="button" class="sources-media-action-btn" id="sources-move-selected">Move to…</button><button type="button" class="sources-media-action-btn sources-media-action-btn--danger" id="sources-delete-selected">Delete</button><button type="button" class="sources-media-action-btn sources-media-action-btn--ghost" id="sources-clear-selected">Clear</button></div><div class="sources-media-footer__row"><button type="button" class="sources-refresh-btn" id="sources-refresh-media">↻ Refresh</button><button type="button" class="sources-repl-media-btn" id="sources-repl-media-sync" style="display:none" title="" aria-label="Replication media sync"></button><div class="ingest-plus-wrap"><button type="button" class="ingest-plus-btn" id="ingest-plus-btn">+</button><div class="ingest-dropup-menu" style="display:none"><button class="ingest-menu-item" id="ingest-menu-file">Select File(s)</button><button class="ingest-menu-item" id="ingest-menu-mkdir">New Folder…</button><button class="ingest-menu-item ingest-menu-item--usb" id="ingest-menu-usb">Import USB…<span class="ingest-usb-badge" style="display:none"></span></button><button class="ingest-menu-item ingest-menu-item--placeholder" id="ingest-menu-placeholder" style="display:none">Add Placeholder…</button><div class="ingest-url-row"><input type="text" id="ingest-url" class="ingest-url-input" placeholder="Paste URL…" /><button type="button" id="ingest-url-btn" class="ingest-url-btn">⬇</button></div></div></div></div><div class="ingest-status-col"><div class="ingest-status" id="ingest-status"></div><div class="ingest-upload-progress" style="display:none"><div class="ingest-upload-progress__track"><div class="ingest-upload-progress__bar" style="width:0%"></div></div><span class="ingest-upload-progress__pct">0%</span></div><div class="repl-spread-progress" id="repl-spread-progress" style="display:none"><div class="repl-spread-progress__track"><div class="repl-spread-progress__bar" style="width:0%"></div></div><span class="repl-spread-progress__pct">0%</span></div></div></div><div id="sources-drag-overlay" class="sources-drag-overlay" style="display:none"><div class="sources-drag-overlay__content"><span>Drop to ingest</span></div></div>`

/**
 * @param {HTMLElement} root
 */
export function mountSourcesPanelShell(root) {
	root.innerHTML = SOURCES_PANEL_HTML
	return {
		tabs: root.querySelectorAll('.sources-tab'),
		filterInput: root.querySelector('#sources-filter'),
		listEl: root.querySelector('#sources-list'),
		projectMediaBar: root.querySelector('#sources-project-media-bar'),
		projectMediaPath: root.querySelector('#sources-project-media-path'),
		projectMediaFilter: root.querySelector('#sources-project-media-filter'),
		gatherMediaBtn: root.querySelector('#sources-gather-media'),
		mediaFooter: root.querySelector('.sources-media-footer'),
		selectionBar: root.querySelector('#sources-media-selection-bar'),
		selectionCountEl: root.querySelector('#sources-selection-count'),
		refreshBtn: root.querySelector('#sources-refresh-media'),
		replMediaBtn: root.querySelector('#sources-repl-media-sync'),
		copyBtn: root.querySelector('#sources-copy-selected'),
		moveBtn: root.querySelector('#sources-move-selected'),
		deleteBtn: root.querySelector('#sources-delete-selected'),
		clearSelBtn: root.querySelector('#sources-clear-selected'),
		plusBtn: root.querySelector('#ingest-plus-btn'),
		dropMenu: root.querySelector('.ingest-dropup-menu'),
		fileBtn: root.querySelector('#ingest-menu-file'),
		mkdirBtn: root.querySelector('#ingest-menu-mkdir'),
		usbBtn: root.querySelector('#ingest-menu-usb'),
		placeholderBtn: root.querySelector('#ingest-menu-placeholder'),
		usbBadge: root.querySelector('.ingest-usb-badge'),
		urlIn: root.querySelector('#ingest-url'),
		urlBtn: root.querySelector('#ingest-url-btn'),
		iStatus: root.querySelector('#ingest-status'),
		iProgWrap: root.querySelector('.ingest-upload-progress'),
		iBar: root.querySelector('.ingest-upload-progress__bar'),
		iPct: root.querySelector('.ingest-upload-progress__pct'),
		spreadProgWrap: root.querySelector('#repl-spread-progress'),
		spreadBar: root.querySelector('.repl-spread-progress__bar'),
		spreadPct: root.querySelector('.repl-spread-progress__pct'),
		liveFooter: root.querySelector('.sources-live-footer'),
		dragOverlay: root.querySelector('#sources-drag-overlay'),
		liveAddBtn: root.querySelector('#sources-live-add-btn'),
		liveRefreshBtn: root.querySelector('#sources-live-refresh-btn'),
	}
}
