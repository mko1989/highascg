const fs = require('fs');
const path = require('path');
const { MODULE_DESCRIPTIONS, COMPONENT_GROUPS, LIB_GROUPS } = require('./ast-scanner-metadata');
const { parseJsFile } = require('./ast-scanner-parse');

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
