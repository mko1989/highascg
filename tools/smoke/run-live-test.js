const { ConnectionManager } = require('../../src/caspar/connection-manager');
(async () => {
  const cm = new ConnectionManager({ host: '127.0.0.1', port: 5250 });
  cm.on('status', p => {
    if(p.connected) { console.log('Connected!'); cm.stop(); }
  });
  cm.on('error', e => console.error('CM Error:', e));
  cm.start();
})();
