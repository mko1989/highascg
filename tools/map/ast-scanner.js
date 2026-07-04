const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const MODULE_DESCRIPTIONS = {
    'api': 'API Router & Routes — REST API, request dispatch, settings, device-view CRUD',
    'server': 'HTTP server (:4200), WebSocket server, CORS, AMCP dispatch, catalog handlers',
    'caspar': 'TCP connection to CasparCG :5250, AMCP command builders, batch operations, query parsing',
    'engine': 'Scene take (LBG/PGM-only), transitions, timeline playback, multiview, PiP overlay, global border, project store',
    'state': 'Channel state from INFO/CLS, playback tracker, live scene reconciliation',
    'osc': 'UDP OSC from CasparCG — audio meters, playback position, profiler telemetry',
    'audio': 'ALSA mixer control, audio device enumeration, metering, live audio health',
    'media': 'Local media scan (ffmpeg probe), thumbnails, project media root, USB drive copy, CG look thumbnails',
    'replication': 'Leader/follower sync, AMCP fanout, playhead sync, media rsync, project push, failover',
    'streaming': 'FFmpeg streaming setup, NDI resolve, streaming channel status, UDP port management',
    'artnet': 'ArtNet DMX receiver, DMX-driven border effects, sACN/Art-Net output',
    'companion': 'Satellite preview client, button preview cache, companion config',
    'companion-bridge': 'Look-air frame contract, registry for Companion module communication',
    'preview': 'FFmpeg JPEG snapshot pipeline — activity tracking, cache, dirty detection, consumer management',
    'config': 'Config load/save, schema validation, reload signaling',
    'system': 'exFAT sync, network inventory, private volume sync, server update, operator snap',
    'utils': 'OS config (xrandr, nvidia), GPU topology (DRM, xrandr), DeckLink enum, persistence, logging, periodic sync, caspar restart',
    'sampling': 'DMX sampling ingress, output, worker for lighting fixture data',
    'plugins': 'Dynamic plugin loading system',
    'support': 'Diagnostic ZIP export — GPU snapshot, settings redaction, log collection',
    'bootstrap': 'Startup sequence — args, config, modules, shutdown, watchdogs, LED test pattern',
    'previs': 'Optional module — 3D model routes, scene registration',
    'tracking': 'Optional module — person detection registration stub',
    'autofollow': 'Optional module — stage auto-follow camera registration stub',
    'cg-studio': 'Template editor — HTTP server on :4300, GrapesJS, template scan, export',
    'share': 'Reserved for future shared code'
};

const COMPONENT_GROUPS = [
    { prefix: 'device-view-inspector-', label: 'Device View Inspectors', description: 'Per-connector-type inspector panels in Device View' },
    { prefix: 'device-view-caspar-render-', label: 'Device View Caspar Render', description: 'Rear panel rendering — backplane SVG, markers, simple mode' },
    { prefix: 'device-view-', label: 'Device View', description: 'Back-of-rack device graph — cables, destinations, mappings, snapshots' },
    { prefix: 'inspector-global-border-', label: 'Global Border Inspector', description: 'Global border effect editor sub-panels — effect, ArtNet, slices' },
    { prefix: 'inspector-', label: 'Inspector Panel', description: 'Main inspector panel and content editor sub-panels' },
    { prefix: 'scenes-', label: 'Scenes Editor', description: 'Scene editing, compose preview, preview runtime' },
    { prefix: 'scene-', label: 'Scene Components', description: 'Scene-specific UI components — layer row' },
    { prefix: 'timeline-', label: 'Timeline Editor', description: 'Timeline canvas, editor, transport, clip rendering, handlers' },
    { prefix: 'preview-', label: 'Preview Canvas', description: 'PGM/PRV preview rendering, draw routines, compose snapshots' },
    { prefix: 'audio-mixer-', label: 'Audio Mixer', description: 'Audio mixer faders, VU meters, console view, sync' },
    { prefix: 'multiview-', label: 'Multiview Editor', description: 'Multiview layout canvas, editor, interaction' },
    { prefix: 'pixel-map-', label: 'Pixel Map Editor', description: 'LED pixel map editor and canvas' },
    { prefix: 'previs-', label: '3D Previs', description: '3D preview, model loader, UV editor, texture mapping' },
    { prefix: 'settings-', label: 'Settings Modal', description: 'Settings tabs — hardware, ALSA mixer, live audio, templates, updates' },
    { prefix: 'sources-', label: 'Sources Panel', description: 'Media browser, live sources, effects, ingest, templates' },
    { prefix: 'header-bar-', label: 'Header Bar', description: 'Top toolbar — audio, streaming, replication, LED test, config strip' }
];

const LIB_GROUPS = [
    { prefix: 'device-view-gpu-port-', label: 'GPU Port Logic', description: 'GPU port discovery, merging, layout, topology' },
    { prefix: 'device-view-', label: 'Device View Logic', description: 'Cable resolve, host channels, refresh, GPU source inherit' },
    { prefix: 'audio-mixer-', label: 'Audio Mixer Logic', description: 'Meter loops, peaks, state, bus meters, fader bind' },
    { prefix: 'live-audio-', label: 'Live Audio Logic', description: 'Audio inputs, routing, play targets, state' },
    { prefix: 'previs-', label: 'Previs Logic', description: 'Scene, model loader, UV mapper, texture, state' },
    { prefix: 'scene-state-', label: 'Scene State', description: 'Scene state helpers, look logic, layer logic, persistence' },
    { prefix: 'scenes-preview-', label: 'Scenes Preview', description: 'Preview global border, look stack, push scene, snapshot' },
    { prefix: 'project-', label: 'Project Logic', description: 'Files, hardware, media, import, load, state' },
    { prefix: 'replication-', label: 'Replication UI', description: 'Media spread, status banner, UI state' },
    { prefix: 'timeline-', label: 'Timeline Logic', description: 'State, clip interp, clip layout, track heights' },
    { prefix: 'pip-overlay-', label: 'PiP Overlay', description: 'AMCP commands, registry' },
    { prefix: 'optional-modules-', label: 'Optional Modules', description: 'Client manifest, meta, registry' },
    { prefix: 'lower-third-', label: 'Lower Thirds', description: 'CG data, roster import' },
    { prefix: 'streaming-', label: 'Streaming Logic', description: 'Channel state' },
    { prefix: 'companion-', label: 'Companion Logic', description: 'Button preview, location parse' },
    { prefix: 'compose-preview-', label: 'Compose Preview', description: 'URL builder' },
    { prefix: 'global-border-', label: 'Global Border', description: 'ArtNet map, WebSocket' },
    { prefix: 'mapping-', label: 'Mapping Logic', description: 'Node service, state' },
    { prefix: 'app-', label: 'App Core', description: 'Runtime, status, toast, scene deck, multiview sync, WS handlers' },
    { prefix: 'audio-', label: 'Audio Utils', description: 'Channel layouts, routes, volume scale' }
];

function extractFileDescription(sourceCode) {
    const lines = sourceCode.split('\n');
    let inJsDoc = false;
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('//')) {
            return line.replace(/^\/\/\s*/, '');
        }
        if (line.startsWith('/*')) {
            inJsDoc = true;
            if (line.includes('*/')) {
                return line.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim();
            }
            continue;
        }
        if (inJsDoc) {
            if (line.includes('*/')) break;
            if (line.startsWith('*')) {
                const text = line.replace(/^\*\s*/, '');
                if (text && !text.startsWith('@')) return text;
            }
        }
        if (line.length > 0 && !inJsDoc) break;
    }
    return '';
}

function resolveImport(target, fromFile, repoRoot) {
    if (target.startsWith('.')) {
        const abs = path.resolve(path.dirname(fromFile), target);
        let resolved = path.relative(repoRoot, abs);
        if (!resolved.endsWith('.js') && !resolved.endsWith('.json') && !resolved.endsWith('.css') && !resolved.endsWith('.html')) {
            resolved += '.js';
        }
        return { target, resolved, internal: true };
    }
    const builtin = ['fs', 'path', 'http', 'https', 'child_process', 'crypto', 'os', 'events', 'util', 'stream'].includes(target) || target.startsWith('node:');
    if (builtin) return { target, resolved: target, builtin: true };
    return { target, resolved: target, external: true };
}

function walkSyncFiles(dir, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file.startsWith('.sync-conflict-')) continue;
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkSyncFiles(fullPath, fileList);
        } else {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

function buildImportGraph(allFiles) {
    const importedByMap = {}; 
    for (const f of allFiles) {
        if (f.meta && f.meta.imports) {
            for (const imp of f.meta.imports) {
                if (imp.internal) {
                    if (!importedByMap[imp.resolved]) importedByMap[imp.resolved] = [];
                    if (!importedByMap[imp.resolved].includes(f.meta.path)) {
                        importedByMap[imp.resolved].push(f.meta.path);
                    }
                }
            }
        }
    }
    
    for (const f of allFiles) {
        if (f.meta) {
            f.meta.importedBy = importedByMap[f.meta.path] || [];
            f.meta.importedByCount = f.meta.importedBy.length;
            f.meta.importCount = f.meta.imports ? f.meta.imports.length : 0;
        }
    }
}

function scanServerModules(repoRoot) {
    const srcDir = path.join(repoRoot, 'src');
    const modules = [];
    const allFiles = [];

    const srcDirs = fs.readdirSync(srcDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    
    for (const modName of srcDirs) {
        const modPath = path.join(srcDir, modName);
        const jsFiles = walkSyncFiles(modPath).filter(f => f.endsWith('.js'));
        
        const modNode = {
            id: `mod:${modName}`,
            label: modName,
            kind: "module",
            description: MODULE_DESCRIPTIONS[modName] || `Source module: ${modName}`,
            meta: { fileCount: jsFiles.length },
            children: []
        };
        
        for (const filePath of jsFiles) {
            const fileNode = parseJsFile(filePath, repoRoot);
            modNode.children.push(fileNode);
            allFiles.push(fileNode);
        }
        modules.push(modNode);
    }
    
    // Top-level files
    const topLevelFiles = ['index.js', 'src/module-registry.js', 'src/repo-paths.js'];
    for (const fileRel of topLevelFiles) {
        const filePath = path.join(repoRoot, fileRel);
        if (fs.existsSync(filePath)) {
            const fileNode = parseJsFile(filePath, repoRoot);
            modules.push(fileNode);
            allFiles.push(fileNode);
        }
    }
    
    buildImportGraph(allFiles);
    return { modules, allFiles };
}

function groupClientFiles(files, prefixList, repoRoot, groupPrefixId) {
    const groupsMap = {};
    const ungrouped = {
        id: `group:${groupPrefixId}-misc`, label: 'Misc', kind: 'group', description: 'Components not matching any prefix', children: []
    };
    const modalsGroup = {
        id: `group:${groupPrefixId}-modals`, label: 'Modals', kind: 'group', description: 'All modal dialogs', children: []
    };

    for (const g of prefixList) {
        groupsMap[g.prefix] = {
            id: `group:${groupPrefixId}-${g.prefix.replace(/-$/, '')}`,
            label: g.label,
            kind: 'group',
            description: g.description,
            children: []
        };
    }

    for (const file of files) {
        const fileNode = parseJsFile(file, repoRoot);
        const basename = path.basename(file);
        
        let matched = false;
        for (const g of prefixList) {
            if (basename.startsWith(g.prefix)) {
                groupsMap[g.prefix].children.push(fileNode);
                matched = true;
                break;
            }
        }
        
        if (!matched) {
            if (basename.endsWith('-modal.js')) {
                modalsGroup.children.push(fileNode);
            } else {
                ungrouped.children.push(fileNode);
            }
        }
    }

    const result = [];
    for (const g of prefixList) {
        if (groupsMap[g.prefix].children.length > 0) result.push(groupsMap[g.prefix]);
    }
    if (modalsGroup.children.length > 0) result.push(modalsGroup);
    if (ungrouped.children.length > 0) result.push(ungrouped);
    return result;
}

function scanClientModules(repoRoot) {
    const componentsDir = path.join(repoRoot, 'client', 'components');
    const libDir = path.join(repoRoot, 'client', 'lib');
    const stylesDir = path.join(repoRoot, 'client', 'styles');

    const componentFiles = walkSyncFiles(componentsDir).filter(f => f.endsWith('.js'));
    const libFiles = walkSyncFiles(libDir).filter(f => f.endsWith('.js') || f.endsWith('.json'));
    const cssFiles = walkSyncFiles(stylesDir).filter(f => f.endsWith('.css'));

    const componentGroups = groupClientFiles(componentFiles, COMPONENT_GROUPS, repoRoot, 'comp');
    const libGroups = groupClientFiles(libFiles, LIB_GROUPS, repoRoot, 'lib');

    const allClientNodes = [];
    
    const clientChildren = [
        {
            id: 'group:client-components',
            label: 'components/',
            kind: 'module',
            description: 'UI components grouped by prefix',
            children: componentGroups
        },
        {
            id: 'group:client-lib',
            label: 'lib/',
            kind: 'module',
            description: 'Library and utility files grouped by prefix',
            children: libGroups
        }
    ];

    // Collect all file nodes to run the import graph builder
    for (const g of componentGroups) allClientNodes.push(...g.children);
    for (const g of libGroups) allClientNodes.push(...g.children);

    // Direct files
    const directFiles = ['client/app.js', 'client/index.html', 'client/setup.html', 'client/styles.css'];
    for (const f of directFiles) {
        const absPath = path.join(repoRoot, f);
        if (fs.existsSync(absPath)) {
            const node = parseJsFile(absPath, repoRoot);
            clientChildren.push(node);
            allClientNodes.push(node);
        }
    }

    // Styles
    const styleGroup = {
        id: 'group:client-styles',
        label: 'styles/',
        kind: 'module',
        description: 'CSS stylesheets',
        children: []
    };
    for (const css of cssFiles) {
        const node = parseJsFile(css, repoRoot); // parseJsFile will fail ast but still return node
        styleGroup.children.push(node);
    }
    if (styleGroup.children.length > 0) {
        clientChildren.push(styleGroup);
    }

    buildImportGraph(allClientNodes);

    return { clientChildren, allClientNodes };
}

function parseJsFile(filePath, repoRoot) {
    const relPath = path.relative(repoRoot, filePath);
    const source = fs.readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    const bytes = Buffer.byteLength(source, 'utf8');
    
    const fileNode = {
        id: `file:${relPath}`,
        label: path.basename(filePath),
        kind: "file",
        description: extractFileDescription(source),
        meta: {
            path: relPath,
            absPath: filePath,
            lines: lines.length,
            bytes,
            imports: [],
            exports: [],
            routeCount: 0,
            wsEvents: []
        },
        children: []
    };
    
    if (lines.length > 1000) fileNode.meta.large = true;
    
    if (!filePath.endsWith('.js')) {
        return fileNode; // Don't parse css/html/json
    }

    let ast;
    try {
        ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });
    } catch (e) {
        try {
            ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script', locations: true });
        } catch (e2) {
            fileNode.meta.parseError = true;
            fileNode.meta.errorMsg = e2.message;
            return fileNode;
        }
    }
    
    const isRouteFile = path.basename(filePath).startsWith('routes-');
    
    walk.simple(ast, {
        CallExpression(node) {
            if (node.callee.name === 'require' && node.arguments.length > 0 && node.arguments[0].type === 'Literal') {
                const target = node.arguments[0].value;
                fileNode.meta.imports.push({...resolveImport(target, filePath, repoRoot), line: node.loc.start.line});
            }
            
            if (isRouteFile && node.callee.type === 'MemberExpression') {
                const prop = node.callee.property.name;
                if (['get', 'post', 'put', 'delete', 'patch', 'options'].includes(prop)) {
                    if (node.arguments.length > 0 && node.arguments[0].type === 'Literal') {
                        const routePath = node.arguments[0].value;
                        const method = prop.toUpperCase();
                        let handler = "anonymous";
                        const lastArg = node.arguments[node.arguments.length - 1];
                        if (lastArg.type === 'Identifier') handler = lastArg.name;
                        
                        fileNode.children.push({
                            id: `route:${method}:${routePath}`,
                            label: `${method} ${routePath}`,
                            kind: "route",
                            meta: { method, path: routePath, handler, line: node.loc.start.line, file: relPath }
                        });
                        fileNode.meta.routeCount++;
                    }
                }
            }
            
            if (node.callee.name === 'broadcast' || node.callee.name === 'wsBroadcast' || node.callee.name === '_wsBroadcast') {
                if (node.arguments.length > 0 && node.arguments[0].type === 'Literal') {
                    const evt = node.arguments[0].value;
                    if (!fileNode.meta.wsEvents.includes(evt)) fileNode.meta.wsEvents.push(evt);
                    fileNode.children.push({
                        id: `ws:${evt}`, label: `ws: ${evt}`, kind: "ws-event",
                        meta: { name: evt, direction: "server->client", file: relPath, line: node.loc.start.line }
                    });
                }
            }
            
            if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'send') {
                if (node.arguments.length > 0 && node.arguments[0].type === 'CallExpression') {
                    const call = node.arguments[0];
                    if (call.callee.type === 'MemberExpression' && call.callee.property.name === 'stringify') {
                        if (call.arguments.length > 0 && call.arguments[0].type === 'ObjectExpression') {
                            const typeProp = call.arguments[0].properties.find(p => p.key && (p.key.name === 'type' || p.key.value === 'type'));
                            if (typeProp && typeProp.value && typeProp.value.type === 'Literal') {
                                const evt = typeProp.value.value;
                                if (!fileNode.meta.wsEvents.includes(evt)) fileNode.meta.wsEvents.push(evt);
                                fileNode.children.push({
                                    id: `ws:${evt}`, label: `ws: ${evt}`, kind: "ws-event",
                                    meta: { name: evt, direction: "server->client", file: relPath, line: node.loc.start.line }
                                });
                            }
                        }
                    }
                }
            }
        },
        ImportDeclaration(node) {
            if (node.source && node.source.type === 'Literal') {
                const target = node.source.value;
                fileNode.meta.imports.push({...resolveImport(target, filePath, repoRoot), line: node.loc.start.line});
            }
        },
        AssignmentExpression(node) {
            if (node.left.type === 'MemberExpression') {
                const obj = node.left.object;
                const prop = node.left.property;
                if (obj.name === 'module' && prop.name === 'exports') {
                    extractExportRhs(node.right, 'module.exports', fileNode, lines);
                } else if (obj.name === 'exports' && prop.name) {
                    extractExportRhs(node.right, prop.name, fileNode, lines);
                }
            }
        },
        ExportNamedDeclaration(node) {
            if (node.declaration) {
                if (node.declaration.type === 'FunctionDeclaration') {
                    addExport(fileNode, node.declaration.id.name, 'function', node.declaration, lines);
                } else if (node.declaration.type === 'ClassDeclaration') {
                    addExport(fileNode, node.declaration.id.name, 'class', node.declaration, lines);
                } else if (node.declaration.type === 'VariableDeclaration') {
                    for (const decl of node.declaration.declarations) {
                        const kind = (decl.init && (decl.init.type === 'FunctionExpression' || decl.init.type === 'ArrowFunctionExpression')) ? 'function' : 'constant';
                        addExport(fileNode, decl.id.name, kind, decl.init || decl, lines);
                    }
                }
            } else if (node.specifiers) {
                for (const spec of node.specifiers) {
                    addExport(fileNode, spec.exported.name, 'constant', spec, lines);
                }
            }
        },
        ExportDefaultDeclaration(node) {
            let name = 'default';
            if (node.declaration.id && node.declaration.id.name) name = node.declaration.id.name;
            const kind = (node.declaration.type === 'FunctionDeclaration' || node.declaration.type === 'FunctionExpression' || node.declaration.type === 'ArrowFunctionExpression') ? 'function' : 
                         (node.declaration.type === 'ClassDeclaration' || node.declaration.type === 'ClassExpression') ? 'class' : 'constant';
            addExport(fileNode, name, kind, node.declaration, lines);
        }
    });

    return fileNode;
}

function extractExportRhs(rhs, exportName, fileNode, lines) {
    if (rhs.type === 'FunctionExpression' || rhs.type === 'ArrowFunctionExpression') {
        const name = (rhs.id && rhs.id.name) || (exportName !== 'module.exports' ? exportName : 'anonymous');
        addExport(fileNode, name, 'function', rhs, lines);
    } else if (rhs.type === 'ObjectExpression') {
        for (const prop of rhs.properties) {
            if (prop.type === 'Property') {
                const name = prop.key.name || prop.key.value;
                const kind = (prop.value.type === 'FunctionExpression' || prop.value.type === 'ArrowFunctionExpression') ? 'function' : 'constant';
                addExport(fileNode, name, kind, prop.value, lines);
            }
        }
    } else if (rhs.type === 'ClassExpression' || (rhs.type === 'Identifier' && isUpperCamel(rhs.name))) {
        const name = (rhs.id && rhs.id.name) || (exportName !== 'module.exports' ? exportName : 'AnonymousClass');
        addExport(fileNode, name, 'class', rhs, lines);
    } else {
        if (exportName !== 'module.exports') {
            addExport(fileNode, exportName, 'constant', rhs, lines);
        }
    }
}

function isUpperCamel(str) {
    return str && /^[A-Z][a-z0-9]/.test(str);
}

function addExport(fileNode, name, kind, nodeAst, lines) {
    const isAsync = nodeAst.async || false;
    const params = (nodeAst.params || []).map(p => p.name || '...').filter(Boolean);
    
    if (name && typeof name === 'string' && !fileNode.meta.exports.includes(name)) {
        fileNode.meta.exports.push(name);
    }
    
    let label = name || 'anonymous';
    if (kind === 'function') label += `(${params.join(', ')})`;
    
    let jsdoc = '';
    if (nodeAst && nodeAst.loc) {
        let currLine = nodeAst.loc.start.line - 2;
        if (currLine >= 0 && lines[currLine] && lines[currLine].includes('*/')) {
            let docLines = [];
            while (currLine >= 0 && !lines[currLine].includes('/**')) {
                docLines.unshift(lines[currLine].replace(/^\s*\*\s?/, '').replace(/\*\//, '').trim());
                currLine--;
            }
            if (currLine >= 0) docLines.unshift(lines[currLine].replace(/^\s*\/\*\*\s?/, '').trim());
            jsdoc = docLines.join(' ').trim().split('.')[0];
            if (jsdoc) jsdoc += '.'; 
        }
    }

    fileNode.children.push({
        id: `fn:${fileNode.meta.path}:${name || 'anon'}`,
        label,
        kind,
        description: jsdoc,
        meta: {
            name: name || 'anonymous',
            line: nodeAst && nodeAst.loc ? nodeAst.loc.start.line : 0,
            endLine: nodeAst && nodeAst.loc ? nodeAst.loc.end.line : 0,
            params: params.length ? params : undefined,
            async: isAsync || undefined,
            exported: true,
            jsdoc: jsdoc || undefined
        }
    });
}

function crossReferenceWorkOrders(allNodes, workOrderDir) {
    if (!fs.existsSync(workOrderDir)) return;
    
    function getFiles(dir, files = []) {
        for (const file of fs.readdirSync(dir)) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                getFiles(fullPath, files);
            } else if (fullPath.endsWith('.md')) {
                files.push(path.relative(workOrderDir, fullPath));
            }
        }
        return files;
    }
    const woFiles = getFiles(workOrderDir);
    const woIndex = {}; 

    for (const woFile of woFiles) {
        const basename = path.basename(woFile);
        const match = basename.match(/^(\d+[a-z]?)_WO_/);
        if (!match) continue;
        const woNum = match[1];
        const content = fs.readFileSync(path.join(workOrderDir, woFile), 'utf8');
        const title = (content.split('\n').find(l => l.startsWith('# ')) || '').replace(/^#\s*/, '') || basename;

        for (const node of allNodes) {
            const searchTerms = [
                node.label,
                node.meta && node.meta.name,
                node.meta && node.meta.path,
                node.meta && node.meta.path && node.meta.path.split('/').pop()
            ].filter(Boolean);

            for (const term of searchTerms) {
                if (term.length < 4) continue;
                if (content.includes(term)) {
                    if (!woIndex[node.id]) woIndex[node.id] = [];
                    woIndex[node.id].push({ wo: `WO-${woNum}`, title, file: woFile });
                    break;
                }
            }
        }
    }

    for (const node of allNodes) {
        if (woIndex[node.id]) {
            node.meta = node.meta || {};
            node.meta.relatedWOs = woIndex[node.id];
        }
    }
}

module.exports = { scanServerModules, scanClientModules, crossReferenceWorkOrders };
