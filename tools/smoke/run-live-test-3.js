const assert = require('node:assert/strict')
const { ConnectionManager } = require('../../src/caspar/connection-manager');
(async () => {
  const cm = new ConnectionManager({ host: '127.0.0.1', port: 5250, healthIntervalMs: 0, healthConnectDelayMs: 0 });
  await new Promise(r => {
    cm.on('status', p => { if(p.connected) r() })
    cm.start()
  })
  console.log('Connected!');
  
  try {
    const r = await cm.amcp.version()
    console.log('r=', r)
    assert.equal(r.ok, true)
    const line = Array.isArray(r.data) ? r.data.join('\n') : String(r.data || '')
    assert.match(line, /casparcg|Caspar|\d+\.\d+/i, `expected version text, got: ${line.slice(0, 200)}`)
    console.log('VERSION SUCCESS');
  } catch (e) {
    console.error('Test error:', e);
  } finally {
    cm.stop()
    process.exit(0)
  }
})();
