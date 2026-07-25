const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

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

module.exports = { parseJsFile, resolveImport, extractFileDescription };
