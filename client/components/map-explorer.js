import { escapeHtml, escapeAttr } from '../lib/dom-escape.js'

const KIND_COLORS = {
    'subsystem': '#58a6ff',
    'application': '#3fb950',
    'module': '#d2a8ff',
    'file': '#8b949e',
    'function': '#f0883e',
    'route': '#a371f7',
    'ws-event': '#ff7b72',
    'script': '#79c0ff',
    'group': '#e3b341'
};

class SearchIndex {
    constructor(rootNode) {
        this.entries = [];
        this._buildIndex(rootNode, []);
    }

    _buildIndex(node, parentPath) {
        const path = [...parentPath, node];
        const searchText = [
            node.label,
            node.description || '',
            node.meta?.path || '',
            node.meta?.name || '',
            node.meta?.unit || '',
            node.id,
        ].join(' ').toLowerCase();

        this.entries.push({ node, path, searchText });

        if (node.children) {
            for (const child of node.children) {
                this._buildIndex(child, path);
            }
        }
    }

    search(query, limit = 50) {
        const q = query.toLowerCase().trim();
        if (!q) return [];

        const terms = q.split(/\s+/);
        const results = [];

        for (const entry of this.entries) {
            const allMatch = terms.every(t => entry.searchText.includes(t));
            if (allMatch) {
                let score = 0;
                const labelLower = entry.node.label.toLowerCase();
                if (labelLower === q) score = 100;
                else if (labelLower.startsWith(q)) score = 80;
                else if (labelLower.includes(q)) score = 60;
                else score = 40;

                if (entry.node.kind === 'function') score += 5;
                if (entry.node.kind === 'file') score += 3;
                if (entry.node.kind === 'route') score += 4;

                results.push({ ...entry, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }
}

class PanZoom {
    constructor(viewportEl, gridEl) {
        this.viewport = viewportEl;
        this.grid = gridEl;
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.minScale = 0.1;
        this.maxScale = 3;
        this.isPanning = false;
        this.startX = 0;
        this.startY = 0;
        
        this.onViewportChange = null;

        this.viewport.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
        this.viewport.addEventListener('mousedown', this.handleMouseDown.bind(this));
        window.addEventListener('mousemove', this.handleMouseMove.bind(this));
        window.addEventListener('mouseup', this.handleMouseUp.bind(this));
    }

    handleWheel(e) {
        if (e.ctrlKey || e.metaKey || !this.viewport.contains(e.target)) return;
        e.preventDefault();
        
        const delta = Math.exp(-e.deltaY / 500);
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * delta));

        const rect = this.viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const ratio = newScale / this.scale;
        
        this.translateX = cx - ratio * (cx - this.translateX);
        this.translateY = cy - ratio * (cy - this.translateY);
        this.scale = newScale;

        this.applyTransform();
    }

    handleMouseDown(e) {
        if (e.button !== 0 || e.target.closest('.map-card')) return;
        this.isPanning = true;
        this.startX = e.clientX - this.translateX;
        this.startY = e.clientY - this.translateY;
        this.grid.style.cursor = 'grabbing';
    }

    handleMouseMove(e) {
        if (!this.isPanning) return;
        this.translateX = e.clientX - this.startX;
        this.translateY = e.clientY - this.startY;
        this.applyTransform();
    }

    handleMouseUp() {
        if (this.isPanning) {
            this.isPanning = false;
            this.grid.style.cursor = '';
        }
    }

    setZoom(newScale) {
        newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
        
        const rect = this.viewport.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const ratio = newScale / this.scale;
        
        this.translateX = cx - ratio * (cx - this.translateX);
        this.translateY = cy - ratio * (cy - this.translateY);
        this.scale = newScale;
        this.applyTransform();
    }

    resetView() {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.applyTransform();
    }

    applyTransform() {
        this.grid.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        this.grid.style.transformOrigin = '0 0';
        
        const svgLayer = document.getElementById('map-edges');
        if (svgLayer) {
            svgLayer.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
            svgLayer.style.transformOrigin = '0 0';
        }
        
        if (this.onViewportChange) this.onViewportChange();
    }
}

class Minimap {
    constructor(containerEl, explorerInstance) {
        this.container = containerEl;
        this.canvas = document.createElement('canvas');
        this.canvas.width = 180;
        this.canvas.height = 120;
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        this.explorer = explorerInstance;
        
        this.container.addEventListener('click', (e) => this.handleClick(e));
    }

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const bounds = this.getGridBounds();
        if (!bounds) return;

        const scaleX = 170 / bounds.width;
        const scaleY = 110 / bounds.height;
        const scale = Math.min(scaleX, scaleY);
        
        const targetGridX = ((x - 5) / scale) + bounds.x;
        const targetGridY = ((y - 5) / scale) + bounds.y;
        
        const vp = this.explorer.viewportEl.getBoundingClientRect();
        const pz = this.explorer.panZoom;
        
        pz.translateX = (vp.width / 2) - (targetGridX * pz.scale);
        pz.translateY = (vp.height / 2) - (targetGridY * pz.scale);
        pz.applyTransform();
    }

    getGridBounds() {
        const cards = Array.from(this.explorer.gridEl.children);
        if (!cards.length) return null;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        cards.forEach(card => {
            const x = card.offsetLeft;
            const y = card.offsetTop;
            const w = card.offsetWidth;
            const h = card.offsetHeight;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + w > maxX) maxX = x + w;
            if (y + h > maxY) maxY = y + h;
        });
        
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, 180, 120);
        ctx.fillStyle = 'rgba(15, 15, 23, 0.85)';
        ctx.fillRect(0, 0, 180, 120);

        const cards = Array.from(this.explorer.gridEl.children);
        if (!cards.length) {
            this.container.classList.add('map-minimap--hidden');
            return;
        }

        const gridBounds = this.getGridBounds();
        if (!gridBounds || gridBounds.width === 0) return;

        const pz = this.explorer.panZoom;
        const vpRect = this.explorer.viewportEl.getBoundingClientRect();
        
        if (pz.scale === 1 && gridBounds.width <= vpRect.width && gridBounds.height <= vpRect.height) {
            this.container.classList.add('map-minimap--hidden');
            return;
        }
        
        this.container.classList.remove('map-minimap--hidden');

        const scaleX = 170 / gridBounds.width;
        const scaleY = 110 / gridBounds.height;
        const scale = Math.min(scaleX, scaleY);

        for (const card of cards) {
            const x = 5 + (card.offsetLeft - gridBounds.x) * scale;
            const y = 5 + (card.offsetTop - gridBounds.y) * scale;
            
            let kind = 'file';
            for (let c of card.classList) {
                if (c.startsWith('map-card--')) {
                    kind = c.replace('map-card--', '');
                }
            }
            
            ctx.fillStyle = KIND_COLORS[kind] || '#666';
            ctx.fillRect(x, y, Math.max(2, card.offsetWidth * scale), Math.max(2, card.offsetHeight * scale));
        }

        const vpX = (0 - pz.translateX) / pz.scale;
        const vpY = (0 - pz.translateY) / pz.scale;
        const vpW = vpRect.width / pz.scale;
        const vpH = vpRect.height / pz.scale;

        ctx.strokeStyle = '#8b5cf6';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
            5 + (vpX - gridBounds.x) * scale,
            5 + (vpY - gridBounds.y) * scale,
            vpW * scale,
            vpH * scale
        );
    }
}


class DependencyGraph {
    constructor(explorer) {
        this.explorer = explorer;
        this.svg = document.getElementById('map-edges');
        
        const showEdgesPref = localStorage.getItem('map-show-edges');
        const crossEdgesPref = localStorage.getItem('map-cross-edges');
        
        this.showDependencies = showEdgesPref === null ? true : showEdgesPref === 'true';
        this.showCrossModule = crossEdgesPref === 'true';
        
        this.toggleEdgesEl = document.getElementById('map-toggle-edges');
        this.toggleCrossEl = document.getElementById('map-toggle-cross-module');
        
        this.toggleEdgesEl.checked = this.showDependencies;
        this.toggleCrossEl.checked = this.showCrossModule;
        
        this.toggleEdgesEl.addEventListener('change', (e) => {
            this.showDependencies = e.target.checked;
            localStorage.setItem('map-show-edges', this.showDependencies);
            this.renderEdges();
        });
        
        this.toggleCrossEl.addEventListener('change', (e) => {
            this.showCrossModule = e.target.checked;
            localStorage.setItem('map-cross-edges', this.showCrossModule);
            this.renderEdges();
        });
        
        this.currentNodes = [];
        this.allFileNodesMap = new Map();
        
        // Window resize
        window.addEventListener('resize', () => {
            if (this.currentNodes.length > 0) this.renderEdges();
        });
    }
    
    setAllFiles(allNodes) {
        const flat = [];
        const flatten = (n) => {
            if (n.kind === 'file') flat.push(n);
            if (n.children) n.children.forEach(flatten);
        };
        flatten(allNodes);
        for (const n of flat) {
            this.allFileNodesMap.set(n.meta.path, n);
            this.allFileNodesMap.set(n.id, n);
        }
    }

    clear() {
        // preserve defs
        const defs = this.svg.querySelector('defs');
        this.svg.innerHTML = '';
        if (defs) this.svg.appendChild(defs);
        this.currentNodes = [];
    }

    renderEdges(nodes = this.currentNodes) {
        this.currentNodes = nodes;
        this.clear();
        
        if (!this.showDependencies || nodes.length === 0) return;
        
        const hasFiles = nodes.some(n => n.kind === 'file');
        if (!hasFiles) return;

        const drawnSet = new Set();
        
        for (const node of nodes) {
            if (node.kind !== 'file' || !node.meta?.imports) continue;
            
            const fromEl = document.querySelector(`.map-card[data-node-id="${node.id}"]`);
            if (!fromEl) continue;
            
            for (const imp of node.meta.imports) {
                let toNodeId = null;
                let edgeType = 'internal';
                
                if (imp.builtin || imp.external) {
                    edgeType = 'external';
                    // We don't render external for now unless requested
                    continue;
                }
                
                if (imp.internal) {
                    const targetFileNode = this.allFileNodesMap.get(imp.resolved);
                    if (targetFileNode) {
                        toNodeId = targetFileNode.id;
                        // check if target is in current view
                        if (!nodes.find(n => n.id === targetFileNode.id)) {
                            edgeType = 'cross-module';
                            if (!this.showCrossModule) continue;
                        }
                    }
                }
                
                if (!toNodeId) continue;
                
                const toEl = document.querySelector(`.map-card[data-node-id="${toNodeId}"]`);
                if (!toEl) continue;
                
                const edgeKey = `${node.id}->${toNodeId}`;
                if (drawnSet.has(edgeKey)) continue;
                drawnSet.add(edgeKey);
                
                this.drawEdge(fromEl, toEl, edgeType);
            }
        }
    }
    
    getCardAnchor(cardEl, side) {
        const rect = cardEl.getBoundingClientRect();
        const gridRect = document.getElementById('map-grid').getBoundingClientRect();
        
        if (side === 'right') return { x: rect.right - gridRect.left, y: rect.top + rect.height / 2 - gridRect.top };
        if (side === 'left')  return { x: rect.left - gridRect.left, y: rect.top + rect.height / 2 - gridRect.top };
        if (side === 'bottom') return { x: rect.left + rect.width / 2 - gridRect.left, y: rect.bottom - gridRect.top };
        if (side === 'top') return { x: rect.left + rect.width / 2 - gridRect.left, y: rect.top - gridRect.top };
    }

    drawEdge(fromEl, toEl, type) {
        const from = this.getCardAnchor(fromEl, 'right');
        const to = this.getCardAnchor(toEl, 'left');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        // Simple Bezier
        const dx = to.x - from.x;
        const midX = from.x + Math.max(Math.abs(dx) * 0.5, 40);
        
        const d = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
        
        path.setAttribute('d', d);
        path.setAttribute('class', `map-edge map-edge--${type}`);
        path.setAttribute('data-from', fromEl.getAttribute('data-node-id'));
        path.setAttribute('data-to', toEl.getAttribute('data-node-id'));
        path.setAttribute('marker-end', 'url(#map-arrowhead)');
        
        // Hover events for edges
        path.addEventListener('mouseenter', () => {
            path.classList.add('map-edge--highlighted');
            fromEl.classList.add('map-card--connected');
            toEl.classList.add('map-card--connected');
        });
        
        path.addEventListener('mouseleave', () => {
            path.classList.remove('map-edge--highlighted');
            fromEl.classList.remove('map-card--connected');
            toEl.classList.remove('map-card--connected');
        });

        this.svg.appendChild(path);
    }
    
    handleCardHover(cardEl, isHover) {
        if (!this.showDependencies || this.currentNodes.length === 0) return;
        
        const nodeId = cardEl.getAttribute('data-node-id');
        const edges = Array.from(this.svg.querySelectorAll('.map-edge'));
        const cards = Array.from(document.querySelectorAll('.map-card'));
        
        if (isHover) {
            let hasConnections = false;
            edges.forEach(edge => {
                if (edge.getAttribute('data-from') === nodeId || edge.getAttribute('data-to') === nodeId) {
                    edge.classList.add('map-edge--highlighted');
                    const otherId = edge.getAttribute('data-from') === nodeId ? edge.getAttribute('data-to') : edge.getAttribute('data-from');
                    const otherCard = cards.find(c => c.getAttribute('data-node-id') === otherId);
                    if (otherCard) otherCard.classList.add('map-card--connected');
                    hasConnections = true;
                } else {
                    edge.classList.add('map-edge--dimmed');
                }
            });
            
            if (hasConnections) {
                cards.forEach(c => {
                    if (c !== cardEl && !c.classList.contains('map-card--connected')) {
                        c.classList.add('map-card--dimmed');
                    }
                });
            }
        } else {
            edges.forEach(edge => {
                edge.classList.remove('map-edge--highlighted');
                edge.classList.remove('map-edge--dimmed');
            });
            cards.forEach(c => {
                c.classList.remove('map-card--connected');
                c.classList.remove('map-card--dimmed');
            });
        }
    }
}

class MapExplorer {
    constructor(rootEl, dataUrl = 'assets/map-data.json') {
        this.rootEl = rootEl;
        this.dataUrl = dataUrl;
        this.data = null;
        this.currentNode = null;
        this.path = [];
        
        this.gridEl = document.getElementById('map-grid');
        this.viewportEl = document.getElementById('map-viewport');
        this.breadcrumbEl = document.getElementById('map-breadcrumb');
        this.loadingEl = document.getElementById('map-loading');
        this.sidebarEl = document.getElementById('map-sidebar');
        
        this.searchOverlay = document.getElementById('map-search-overlay');
        this.searchInput = document.getElementById('map-search-input');
        this.searchResults = document.getElementById('map-search-results');
        
        this.zoomInBtn = document.getElementById('map-zoom-in');
        this.zoomResetBtn = document.getElementById('map-zoom-reset');
        this.zoomOutBtn = document.getElementById('map-zoom-out');
        this.zoomLevelLabel = document.getElementById('map-zoom-level');
        

        
        this.panZoom = new PanZoom(this.viewportEl, this.gridEl);
        this.minimap = new Minimap(document.getElementById('map-minimap'), this);
        this.dependencyGraph = new DependencyGraph(this);
        
        this.panZoom.onViewportChange = () => {
            this.zoomLevelLabel.textContent = `${Math.round(this.panZoom.scale * 100)}%`;
            this.minimap.render();
        };

        this.searchIndex = null;
        this.searchDebounce = null;
        this.searchActiveIndex = -1;

        this.bindEvents();
    }

    bindEvents() {
        window.addEventListener('popstate', () => this.handleHashChange());
        
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.openSearch();
                return;
            }
            
            if (this.searchOverlay.open) {
                if (e.key === 'Escape') {
                    this.closeSearch();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.moveSearchHighlight(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.moveSearchHighlight(-1);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.selectSearchResult();
                }
                return;
            }
            
            if (e.key === 'Escape') {
                if (!this.sidebarEl.classList.contains('map-sidebar--collapsed')) {
                    this.hideSidebar();
                } else {
                    this.navigateUp();
                }
            } else if (e.key === 'Backspace' && document.activeElement.tagName !== 'INPUT') {
                this.navigateUp();
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                this.handleArrowNavigation(e.key);
            } else if (e.key === '+' || e.key === '=') {
                this.panZoom.setZoom(this.panZoom.scale * 1.2);
            } else if (e.key === '-') {
                this.panZoom.setZoom(this.panZoom.scale / 1.2);
            } else if (e.key === '0') {
                this.panZoom.resetView();
            } else if (e.key === ' ' && document.activeElement.classList.contains('map-card')) {
                e.preventDefault();
                const id = document.activeElement.getAttribute('data-node-id');
                let node = null;
                const searchNode = (n) => {
                    if (n.id === id) return n;
                    if (n.children) {
                        for (let c of n.children) {
                            let found = searchNode(c);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                node = searchNode(this.currentNode);
                if (node) this.showSidebar(node);
            }
        });
        
        this.sidebarEl.addEventListener('click', (e) => {
            if (e.target.classList.contains('map-sidebar__close')) {
                this.hideSidebar();
            }
        });

        document.getElementById('map-search-trigger').addEventListener('click', () => this.openSearch());
        
        this.searchOverlay.addEventListener('click', (e) => {
            if (e.target === this.searchOverlay) this.closeSearch();
        });
        
        this.searchInput.addEventListener('input', () => {
            clearTimeout(this.searchDebounce);
            this.searchDebounce = setTimeout(() => this.performSearch(), 100);
        });

        this.searchResults.addEventListener('click', (e) => {
            const item = e.target.closest('.map-search__result');
            if (item) {
                const index = parseInt(item.getAttribute('data-index'), 10);
                this.searchActiveIndex = index;
                this.selectSearchResult();
            }
        });

        this.zoomInBtn.addEventListener('click', () => this.panZoom.setZoom(this.panZoom.scale * 1.2));
        this.zoomOutBtn.addEventListener('click', () => this.panZoom.setZoom(this.panZoom.scale / 1.2));
        this.zoomResetBtn.addEventListener('click', () => this.panZoom.resetView());

    }

    handleArrowNavigation(key) {
        const cards = Array.from(this.gridEl.children);
        if (cards.length === 0) return;
        
        const focused = document.activeElement;
        let currentIndex = cards.indexOf(focused);
        
        if (currentIndex === -1) {
            cards[0].focus();
            return;
        }

        if (key === 'Home') currentIndex = 0;
        else if (key === 'End') currentIndex = cards.length - 1;
        else {
            const gap = 16;
            const containerWidth = this.gridEl.clientWidth;
            const cardWidth = cards[0].offsetWidth;
            const cols = Math.max(1, Math.floor((containerWidth + gap) / (cardWidth + gap)));
            
            if (key === 'ArrowRight') currentIndex = Math.min(currentIndex + 1, cards.length - 1);
            else if (key === 'ArrowLeft') currentIndex = Math.max(currentIndex - 1, 0);
            else if (key === 'ArrowDown') currentIndex = Math.min(currentIndex + cols, cards.length - 1);
            else if (key === 'ArrowUp') currentIndex = Math.max(currentIndex - cols, 0);
        }

        cards[currentIndex].focus();
        cards[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    openSearch() {
        this.searchOverlay.showModal();
        this.searchInput.value = '';
        this.searchResults.innerHTML = '';
        this.searchActiveIndex = -1;
    }

    closeSearch() {
        this.searchOverlay.close();
    }

    performSearch() {
        const query = this.searchInput.value;
        const results = this.searchIndex.search(query);
        this.currentSearchResults = results;
        this.searchActiveIndex = results.length > 0 ? 0 : -1;
        this.renderSearchResults();
    }

    highlightText(text, query) {
        const raw = String(text ?? '');
        if (!query) return escapeHtml(raw);
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0) return escapeHtml(raw);

        const regex = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
        let out = '';
        let last = 0;
        let m;
        const re = new RegExp(regex.source, regex.flags);
        while ((m = re.exec(raw)) !== null) {
            out += escapeHtml(raw.slice(last, m.index));
            out += `<mark class="map-search__highlight">${escapeHtml(m[1])}</mark>`;
            last = m.index + m[0].length;
        }
        out += escapeHtml(raw.slice(last));
        return out;
    }

    renderSearchResults() {
        const query = this.searchInput.value;
        this.searchResults.innerHTML = this.currentSearchResults.map((res, idx) => {
            const pathStr = res.path.map(n => escapeHtml(n.label)).join(' › ');
            return `
                <div class="map-search__result ${idx === this.searchActiveIndex ? 'map-search__result--active' : ''}" role="option" data-index="${idx}">
                    <div class="map-search__result-content">
                        <span class="map-search__result-label">${this.highlightText(res.node.label, query)}</span>
                        <span class="map-search__result-path">${pathStr}</span>
                    </div>
                    <span class="map-search__result-kind">${escapeHtml(res.node.kind)}</span>
                </div>
            `;
        }).join('');
        
        const activeEl = this.searchResults.querySelector('.map-search__result--active');
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest' });
        }
    }

    moveSearchHighlight(dir) {
        if (!this.currentSearchResults || this.currentSearchResults.length === 0) return;
        this.searchActiveIndex += dir;
        if (this.searchActiveIndex < 0) this.searchActiveIndex = this.currentSearchResults.length - 1;
        if (this.searchActiveIndex >= this.currentSearchResults.length) this.searchActiveIndex = 0;
        this.renderSearchResults();
    }

    selectSearchResult() {
        if (this.searchActiveIndex >= 0 && this.currentSearchResults[this.searchActiveIndex]) {
            const entry = this.currentSearchResults[this.searchActiveIndex];
            this.closeSearch();
            
            // disable flat graph on drill down from search
            this.isFlatGraph = false;
            this.flatGraphBtn.classList.remove('active');
            
            this.navigateToPath(entry.path.map(n => n.id));
            if (entry.node.children && entry.node.children.length === 0) {
                this.showSidebar(entry.node);
            }
        }
    }

    async init() {
        try {
            const res = await fetch(this.dataUrl);
            if (!res.ok) throw new Error('Failed to load data');
            this.data = await res.json();
            this.searchIndex = new SearchIndex(this.data.root);
            this.dependencyGraph.setAllFiles(this.data.root);
            this.loadingEl.classList.add('map-loading--hidden');
            this.handleHashChange();
        } catch (e) {
            console.error(e);
            this.loadingEl.innerHTML = `<p>Error loading map data.</p>`;
        }
    }

    handleHashChange() {
        const hash = window.location.hash.replace(/^#\//, '');
        if (!hash) {
            this.navigateToPath([this.data.root.id], false);
            return;
        }
        
        const pathIds = hash.split('/').map(decodeURIComponent);
        if (pathIds[0] !== this.data.root.id) {
            pathIds.unshift(this.data.root.id);
        }
        this.navigateToPath(pathIds, false);
    }

    updateHash() {
        const hashPath = this.path.map(n => encodeURIComponent(n.id)).join('/');
        window.history.pushState({}, '', `#/${hashPath}`);
    }

    buildPathFromIds(ids) {
        const path = [];
        let curr = this.data.root;
        for (let id of ids) {
            if (curr.id === id) {
                path.push(curr);
            } else {
                curr = curr.children?.find(c => c.id === id);
                if (curr) path.push(curr);
                else break;
            }
        }
        return path;
    }

    navigateToPath(pathIds, isBack = false) {
        const newPath = this.buildPathFromIds(pathIds);
        if (newPath.length === 0) return;

        const targetNode = newPath[newPath.length - 1];
        
        if (this.currentNode && this.currentNode.id === targetNode.id) {
            return;
        }

        if (this.currentNode) {
            this.animateCardsOut(isBack).then(() => {
                this.currentNode = targetNode;
                this.path = newPath;
                this.renderLevel(targetNode, isBack);
                this.renderBreadcrumb();
            });
        } else {
            this.currentNode = targetNode;
            this.path = newPath;
            this.renderLevel(targetNode, isBack);
            this.renderBreadcrumb();
        }
        document.title = `HighAsCG Map — ${targetNode.label}`;
    }

    drillInto(node) {
        this.path.push(node);
        this.updateHash();
        this.navigateToPath(this.path.map(n => n.id));
    }

    navigateUp() {
        if (this.path.length <= 1) return;
        this.path.pop();
        this.updateHash();
        
        
        this.navigateToPath(this.path.map(n => n.id), true);
    }

    animateCardsOut(isBack) {
        return new Promise(resolve => {
            this.dependencyGraph.clear();
            const cards = Array.from(this.gridEl.children);
            if (cards.length === 0) return resolve();

            cards.forEach(card => {
                card.classList.add(isBack ? 'map-card--back-leaving' : 'map-card--leaving');
            });

            setTimeout(resolve, 200);
        });
    }
    


    renderLevel(node, isBack = false) {
        this.panZoom.resetView(); 
        this.gridEl.innerHTML = '';
        this.dependencyGraph.clear();
        
        if (node !== this.data?.root) {
            const titleEl = document.createElement('div');
            titleEl.className = 'map-level-title';
            titleEl.textContent = node.label;
            this.viewportEl.appendChild(titleEl);
            setTimeout(() => {
                if (titleEl.parentNode) titleEl.remove();
            }, 800);
        }
        
        this.gridEl.classList.remove('map-grid--flat-graph');
        
        let nodesToRender = node.children || [];
        
        const statsEl = document.getElementById('map-header-stats');
        if (statsEl) {
            statsEl.innerHTML = `<span class="map-header__count">${nodesToRender.length} nodes</span><span class="map-header__depth">· Layer ${this.path.length}</span>`;
        }
        
        if (nodesToRender.length === 0) {
            this.gridEl.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--map-text-muted); padding: 48px;">
                <div style="font-size: 32px; margin-bottom: 16px;">🌱</div>
                No children found for this node.
            </div>`;
            requestAnimationFrame(() => this.minimap.render());
            return;
        }
        
        this.gridEl.style.width = '';
        this.gridEl.style.height = '';

        nodesToRender.forEach((child, index) => {
            const badgeCount = child.children ? child.children.length : 0;
            const childBadge = badgeCount > 0 ? `<span class="map-card__badge" title="${badgeCount} children">${badgeCount} ch</span>` : '';
            
            let depBadges = '';
            if (child.kind === 'file') {
                const imports = child.meta?.importCount || 0;
                const importedBy = child.meta?.importedByCount || 0;
                if (imports > 0) depBadges += `<span class="map-card__badge map-card__badge--imports" title="Imports ${imports} files">← ${imports}</span>`;
                if (importedBy > 0) depBadges += `<span class="map-card__badge map-card__badge--imported-by" title="Imported by ${importedBy} files">→ ${importedBy}</span>`;
            }
            
            const card = document.createElement('article');
            card.className = `map-card map-card--${child.kind}`;
            
            if (child.meta?.importedByCount >= 10) {
                card.classList.add('map-card--hotspot');
            }
            
            card.tabIndex = 0;
            card.setAttribute('data-node-id', child.id);
            card.setAttribute('role', 'treeitem');
            
            card.innerHTML = `
                <div class="map-card__content">
                    <h3 class="map-card__label" title="${escapeAttr(child.label)}">${escapeHtml(child.label)}</h3>
                    <p class="map-card__description" title="${escapeAttr(child.description || '')}">${escapeHtml(child.description || '')}</p>
                    <div class="map-card__badges">${childBadge}${depBadges}</div>
                </div>
            `;
            


            card.addEventListener('click', () => {
                if (child.children && child.children.length > 0) {
                    this.drillInto(child);
                } else {
                    this.showSidebar(child);
                }
            });

            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    card.click();
                }
            });
            
            card.addEventListener('mouseenter', () => this.dependencyGraph.handleCardHover(card, true));
            card.addEventListener('mouseleave', () => this.dependencyGraph.handleCardHover(card, false));

            const animationClass = isBack ? 'map-card--back-entering' : 'map-card--entering';
            card.classList.add(animationClass);
            card.style.animationDelay = `${Math.min(index * 20, 200)}ms`;

            this.gridEl.appendChild(card);
        });

        requestAnimationFrame(() => {
            setTimeout(() => {
                this.minimap.render();
                this.dependencyGraph.renderEdges(nodesToRender);
            }, 250); // wait for enter animation
        });
    }

    renderBreadcrumb() {
        this.breadcrumbEl.innerHTML = '';
        this.path.forEach((node, index) => {
            const span = document.createElement('span');
            span.className = 'map-breadcrumb__segment';
            span.textContent = node.label;
            span.title = node.description || '';
            
            span.addEventListener('click', () => {
                if (index < this.path.length - 1) {

                    
                    const newPathIds = this.path.slice(0, index + 1).map(n => n.id);
                    this.updateHash();
                    this.navigateToPath(newPathIds, true);
                }
            });

            this.breadcrumbEl.appendChild(span);
            
            if (index < this.path.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'map-breadcrumb__separator';
                sep.textContent = ' › ';
                this.breadcrumbEl.appendChild(sep);
            }
        });
    }

    showSidebar(node) {
        let metaHtml = '';
        if (node.meta) {
            metaHtml = '<dl>';
            for (const [key, value] of Object.entries(node.meta)) {
                let displayVal;
                if (key === 'relatedWOs') {
                    displayVal = value.map(v => `${escapeHtml(v.wo)}: ${escapeHtml(v.title)}`).join('<br>');
                } else if (key === 'imports' || key === 'importedBy') {
                    displayVal = escapeHtml(`${value.length} items`);
                } else {
                    const raw = Array.isArray(value) ? value.join(', ') : value;
                    displayVal = escapeHtml(String(raw ?? ''));
                }
                metaHtml += `<dt>${escapeHtml(key)}</dt><dd><code>${displayVal}</code></dd>`;
            }
            metaHtml += '</dl>';
        }

        this.sidebarEl.innerHTML = `
            <button class="map-sidebar__close" aria-label="Close">&times;</button>
            <header class="map-sidebar__header">
                <h2 class="map-sidebar__title">${escapeHtml(node.label)}</h2>
                <span class="map-sidebar__kind">${escapeHtml(node.kind)}</span>
                <button class="map-sidebar__copy-link" title="Copy link to this node">🔗 Copy Link</button>
            </header>
            <p class="map-sidebar__description">${escapeHtml(node.description || '')}</p>
            <section class="map-sidebar__meta">
                ${metaHtml}
            </section>
        `;

        this.sidebarEl.classList.remove('map-sidebar--collapsed');
        
        this.sidebarEl.querySelector('.map-sidebar__copy-link').addEventListener('click', () => {
            this.copyNodeLink(node);
        });
    }

    buildPathToNode(node) {
        const search = (curr, target, currentPath) => {
            if (curr.id === target.id) return [...currentPath, curr];
            if (!curr.children) return null;
            for (const child of curr.children) {
                const found = search(child, target, [...currentPath, curr]);
                if (found) return found;
            }
            return null;
        };
        return search(this.data.root, node, []) || [];
    }

    copyNodeLink(node) {
        const path = this.buildPathToNode(node);
        const hash = '#/' + path.map(n => encodeURIComponent(n.id)).join('/');
        const url = window.location.origin + '/map' + hash;
        navigator.clipboard.writeText(url).then(() => {
            this.showToast('Link copied!');
        });
    }

    showToast(msg) {
        let container = document.getElementById('map-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'map-toast-container';
            container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.style.cssText = 'background:rgba(139,92,246,0.9);color:white;padding:12px 20px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.5);opacity:0;transform:translateY(10px);transition:all 0.3s;';
        toast.textContent = msg;
        container.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    hideSidebar() {
        this.sidebarEl.classList.add('map-sidebar--collapsed');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const explorer = new MapExplorer(document.getElementById('map-root'));
    explorer.init();
});
