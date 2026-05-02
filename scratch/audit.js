const fs = require('fs');
const path = require('path');

const EXCLUDE = ['.git', 'node_modules', '.reference', 'dist', 'work', 'scratch', 'build'];

function getFiles(dir, allFiles = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const name = path.join(dir, file);
        if (EXCLUDE.some(e => name.includes(e))) return;
        if (fs.statSync(name).isDirectory()) {
            getFiles(name, allFiles);
        } else {
            if (name.endsWith('.js') || name.endsWith('.css') || name.endsWith('.html')) {
                allFiles.push(name);
            }
        }
    });
    return allFiles;
}

const files = getFiles('.');
const results = files.map(file => {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n').length;
    const relPath = path.relative('.', file);
    
    // Extract connections
    const connections = [];
    const requireRegex = /require\(['"](.+?)['"]\)/g;
    const importRegex = /import\s+.+?from\s+['"](.+?)['"]/g;
    const scriptRegex = /<script\s+src=['"](.+?)['"]/g;
    const linkRegex = /<link\s+href=['"](.+?)['"]/g;

    let match;
    while ((match = requireRegex.exec(content)) !== null) connections.push(match[1]);
    while ((match = importRegex.exec(content)) !== null) connections.push(match[1]);
    while ((match = scriptRegex.exec(content)) !== null) connections.push(match[1]);
    while ((match = linkRegex.exec(content)) !== null) connections.push(match[1]);

    return {
        file: relPath,
        lines,
        connections: [...new Set(connections)],
        flag: lines > 500
    };
});

fs.writeFileSync('scratch/audit_results.json', JSON.stringify(results, null, 2));
console.log('Audit complete');
