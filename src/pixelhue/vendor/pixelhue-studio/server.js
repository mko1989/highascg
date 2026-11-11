import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PixelhueClient, fail } from './lib/pixelhue.js';
import { readInputs, applyInputs } from './lib/inputs.js';
import { discoverPixelhue } from './lib/discovery.js';
import { studioRoutes } from './lib/studio-routes.js';
import { applyMvrLayer } from './lib/mvr-layers.js';
import { readGallery, uploadPicture, streamThumb } from './lib/gallery.js';
import { manageGallery } from './lib/gallery-manage.js';
import { importEdid, exportEdid } from './lib/input-edid.js';
import { readInputAdvanced } from './lib/input-advanced.js';

const publicFiles = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/editor.js', ['editor.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']],
  ['/inputs.js', ['inputs.js', 'text/javascript']], ['/inputs.css', ['inputs.css', 'text/css']],
  ['/input-advanced.js', ['input-advanced.js', 'text/javascript']], ['/input-edid-ui.js', ['input-edid-ui.js', 'text/javascript']],
  ['/connection.css', ['connection.css', 'text/css']],
  ['/mvr-geometry.js', ['mvr-geometry.js', 'text/javascript']],
  ...['mvr-templates.js', 'mvr-sync.js', 'mvr-reconcile.js', 'mvr-sources.js', 'device-ui.js', 'device-maintenance-ui.js', 'device-extras-ui.js', 'source-backup-ui.js', 'self-test-ui.js', 'outputs-ui.js', 'output-advanced.js', 'audio-ui.js', 'screens-ui.js', 'screen-extras-ui.js', 'programming-ui.js', 'program-sync.js', 'layer-inspector.js', 'layer-effects-ui.js', 'layer-presets-ui.js', 'layer-tools.js', 'program-stage.js', 'group-geometry.js', 'source-tabs.js', 'presets-ui.js', 'ui.js', 'studio-panels.js', 'discovery-ui.js'].map(file => [`/${file}`, [file, 'text/javascript']]),
  ['/studio.css', ['studio.css', 'text/css']],
  ['/fonts/Rewir-Light.woff', ['fonts/Rewir-Light.woff', 'font/woff']],
  ['/fonts/Rewir-Light.ttf', ['fonts/Rewir-Light.ttf', 'font/ttf']],
  ['/fonts/OFL.txt', ['fonts/OFL.txt', 'text/plain']],
  ['/fonts/README.txt', ['fonts/README.txt', 'text/plain']],
]);

async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw fail('JSON content type required.', 415);
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 256_000) throw fail('Request is too large.', 413);
  }
  try { return JSON.parse(body); } catch { throw fail('Invalid JSON.'); }
}

export function createApp({ discover = discoverPixelhue } = {}) {
  let client = null;
  let queue = Promise.resolve();
  function exclusive(action) {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  }
  return http.createServer(async (request, response) => {
    const json = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      // Only the UI served by this process may operate it, including when LAN binding is enabled.
      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}`) throw fail('Cross-origin request refused.', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site request refused.', 403);
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/discovery') {
          return json(200, await discover({ seed: url.searchParams.get('seed') || undefined, scan: url.searchParams.get('scan') === '1' }));
        }
        if (request.method === 'POST' && url.pathname === '/api/connect') {
          const options = await readJson(request);
          if (!options || typeof options !== 'object') throw fail('Connection settings required.');
          return json(200, await exclusive(async () => {
            const next = new PixelhueClient();
            const state = await next.connect(options);
            client = next;
            return state;
          }));
        }
        if (request.method === 'GET' && url.pathname === '/api/state') {
          return json(200, await exclusive(() => {
            if (!client) throw fail('Connect to a device first.', 409);
            return client.read();
          }));
        }
        if (request.method === 'PUT' && url.pathname === '/api/windows') {
          const body = await readJson(request);
          return json(200, await exclusive(() => {
            if (!client || body?.session !== client.session) {
              throw fail('Connection changed. Refresh before applying your layout.', 409);
            }
            return client.apply(body.changes);
          }));
        }
        if (request.method === 'PUT' && url.pathname === '/api/mvr-layers') {
          const body = await readJson(request);
          return json(200, await exclusive(() => {
            if (!client || body?.session !== client.session) throw fail('Connection changed. Refresh before changing MVR windows.', 409);
            return applyMvrLayer(client, body);
          }));
        }
        // Gallery (WO-027): list, raw image upload (proxied as multipart to picture/import), thumbnails.
        if (url.pathname.startsWith('/api/gallery')) {
          const session = url.searchParams.get('session');
          const guard = () => { if (!client || session !== client.session) throw fail('Connection changed. Reconnect before using the gallery.', 409); };
          if (request.method === 'GET' && url.pathname === '/api/gallery') return json(200, await exclusive(() => { guard(); return readGallery(client); }));
          if (request.method === 'GET' && url.pathname === '/api/gallery/thumb') {
            await exclusive(() => { guard(); return streamThumb(client, Number(url.searchParams.get('id')), response); });
            return;
          }
          if (request.method === 'PUT' && url.pathname === '/api/gallery/manage') { const body = await readJson(request); return json(200, await exclusive(() => { guard(); return manageGallery(client, body); })); }
          if (request.method === 'PUT' && url.pathname === '/api/gallery/upload') {
            const chunks = []; let size = 0;
            for await (const chunk of request) { size += chunk.length; if (size > 64_000_000) throw fail('Image is larger than 64 MB.', 413); chunks.push(chunk); }
            const q = name => url.searchParams.get(name);
            return json(200, await exclusive(() => { guard(); return uploadPicture(client, { type: Number(q('type')), name: q('name'), width: Number(q('width')), height: Number(q('height')),
              mime: (request.headers['content-type'] || '').split(';')[0], buffer: Buffer.concat(chunks) }); }));
          }
        }
        if (url.pathname === '/api/edid' && ['GET', 'PUT'].includes(request.method)) { // EDID file export / import (WO-037)
          const session = url.searchParams.get('session'), id = Number(url.searchParams.get('id'));
          const guard = () => { if (!client || session !== client.session) throw fail('Connection changed. Reconnect before using EDID files.', 409); };
          if (request.method === 'GET') { await exclusive(() => { guard(); return exportEdid(client, id, response); }); return; }
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 32768) throw fail('EDID file is too large.', 413); chunks.push(chunk); }
          return json(200, await exclusive(() => { guard(); return importEdid(client, id, Buffer.concat(chunks), readInputAdvanced); }));
        }
        if (request.method === 'GET' && url.pathname === '/api/inputs') {
          return json(200, await exclusive(() => {
            if (!client) throw fail('Connect to a device first.', 409);
            if (url.searchParams.get('session') !== client.session) throw fail('Connection changed. Refresh the Multiviewer tab or reconnect before loading inputs.', 409);
            return readInputs(client);
          }));
        }
        if (request.method === 'PUT' && url.pathname === '/api/inputs') {
          const body = await readJson(request);
          return json(200, await exclusive(() => {
            if (!client || body?.session !== client.session) throw fail('Connection changed. Reconnect before applying inputs.', 409);
            return applyInputs(client, body.changes);
          }));
        }
        const resource = studioRoutes[url.pathname];
        if (resource && ['GET', 'PUT'].includes(request.method)) {
          const body = request.method === 'PUT' ? await readJson(request) : null;
          return json(200, await exclusive(() => {
            if (!client) throw fail('Connect to a device first.', 409);
            const session = body?.session ?? url.searchParams.get('session');
            if (session !== client.session) throw fail('Connection changed. Reconnect before using these controls.', 409);
            if (body && !resource.write) throw fail('This resource is read-only.', 405);
            return body ? resource.write(client, body) : resource.read(client);
          }));
        }
        throw fail('API route not found.', 404);
      }
      const file = publicFiles.get(url.pathname);
      if (!file || request.method !== 'GET') throw fail('Not found.', 404);
      const data = await readFile(new URL(`./public/${file[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': file[1].startsWith('text/') ? `${file[1]}; charset=utf-8` : file[1], 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      response.end(data);
    } catch (error) {
      json(error.status || 500, { error: error.message, ...(error.snapshot ? { snapshot: error.snapshot } : {}) });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3210);
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => console.log(`Pixelhue Studio: http://${host}:${port}`))
    .on('error', (error) => { console.error(error.message); process.exitCode = 1; });
}
