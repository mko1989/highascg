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
      const sendResult = await conn.version({})
      if (sendResult.error) {
         console.error('Send error:', sendResult.error)
      } else {
         const response = await sendResult.request
         console.log('Response shape:')
         console.dir(response, { depth: null })
      }
    } catch (e) {
      console.error('Exception:', e.message)
    }
    conn.disconnect()
    process.exit(0)
  })
}
runTest()
