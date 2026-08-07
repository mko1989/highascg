'use strict'
const { CasparCG } = require('casparcg-connection')

async function runTest() {
  const conn = new CasparCG({
    host: '127.0.0.1',
    port: 5250,
    autoConnect: true,
  })
  
  conn.on('connect', async () => {
    console.log('✅ Connected to CasparCG')
    try {
      const result = await conn.version({})
      console.dir(result, { depth: null })
    } catch (e) {
      console.error('Exception:', e.message)
    }
    conn.disconnect()
    process.exit(0)
  })
}
runTest()
