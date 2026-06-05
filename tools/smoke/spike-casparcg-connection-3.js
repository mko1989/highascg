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
      console.log('VERSION result keys:', Object.keys(result))
      if (result.error) console.log('error:', result.error)
      if (result.request) {
        console.log('request keys:', Object.keys(result.request))
        console.log('request.data:', result.request.data)
        console.log('request.responseCode:', result.request.responseCode)
      }
    } catch (e) {
      console.error('Error in commands:', e.message)
    }
    conn.disconnect()
    process.exit(0)
  })
}
runTest()
