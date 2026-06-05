'use strict'
const { CasparCG } = require('casparcg-connection')
const { AmcpConnectionAdapter } = require('../../src/caspar/amcp-connection-adapter')

async function runTest() {
  const conn = new CasparCG({
    host: '127.0.0.1',
    port: 5250,
    autoConnect: true,
  })
  const adapter = new AmcpConnectionAdapter(conn)
  
  conn.on('connect', async () => {
    console.log('✅ Connected to CasparCG')
    try {
      const versionResult = await adapter.sendRaw('VERSION')
      console.log('VERSION result:', versionResult)
      
      const clsResult = await adapter.sendRaw('CLS')
      console.log('CLS result type:', Array.isArray(clsResult.data) ? 'array' : typeof clsResult.data, 'data length:', clsResult.data.length)
      if (Array.isArray(clsResult.data)) console.log('First line:', clsResult.data[0])
    } catch (e) {
      console.error('Exception:', e.message)
    }
    conn.disconnect()
    process.exit(0)
  })
}
runTest()
