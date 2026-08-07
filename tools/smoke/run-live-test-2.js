const { ConnectionManager } = require('../../src/caspar/connection-manager');
(async () => {
  const cm = new ConnectionManager({ host: '127.0.0.1', port: 5250, healthIntervalMs: 500, healthConnectDelayMs: 0 });
  cm.on('status', p => {
    console.log('Status event:', p);
    if(p.connected) { console.log('Connected!'); cm.stop(); process.exit(0); }
  });
  cm.on('error', e => console.error('CM Error:', e));
  console.log('starting...');
  cm.start();
})();
