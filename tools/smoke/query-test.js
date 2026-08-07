const { ConnectionManager } = require('../../src/caspar/connection-manager');
(async () => {
  const cm = new ConnectionManager({ host: '127.0.0.1', port: 5250, log: ()=>{} });
  cm.on('status', async p => {
    if(p.connected) { 
      try {
        const tlsResult = await cm.amcp.query.tls();
        console.log('TLS:', tlsResult.data[0]);
      } catch (err) {
      } finally {
        cm.stop();
        process.exit(0);
      }
    }
  });
  cm.start();
})();
