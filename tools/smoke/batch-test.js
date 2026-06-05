const { ConnectionManager } = require('../../src/caspar/connection-manager');
const CASPAR_HOST = process.env.HIGHASCG_CASPAR_HOST || process.env.CASPAR_HOST || '127.0.0.1';
const CASPAR_PORT = parseInt(process.env.HIGHASCG_CASPAR_PORT || process.env.CASPAR_PORT || '5250', 10);

(async () => {
  const cm = new ConnectionManager({
    host: CASPAR_HOST,
    port: CASPAR_PORT,
    config: { amcp_batch: true },
    log: (level, msg) => console.log(`[${level}] ${msg}`),
    healthIntervalMs: 0,
    healthConnectDelayMs: 0,
  });
  
  cm.on('status', async p => {
    if(p.connected) { 
      try {
        console.log('Sending batch...');
        const result = await cm.amcp.batchSend(['PLAY 1-10 AMB', 'PLAY 1-11 AMB'], { skipMixerPreCommit: true });
        console.log('Batch result:', JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Batch failed:', err);
      } finally {
        cm.stop();
        process.exit(0);
      }
    }
  });
  cm.start();
})();
