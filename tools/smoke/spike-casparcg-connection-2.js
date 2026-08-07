'use strict'
const { CasparCG } = require('casparcg-connection')

async function runTest() {
  const conn = new CasparCG({
    host: '127.0.0.1',
    port: 5250,
    autoConnect: true,
  })
  
  conn.on('data', (response, error) => {
    console.log('Raw Data received:', JSON.stringify(response))
    if (error) console.log('Error:', error)
  })

  conn.on('connect', async () => {
    console.log('✅ Connected to CasparCG')
    try {
      const result = await conn.version({})
      console.log('VERSION result:', JSON.stringify(result, null, 2))
    } catch (e) {
      console.error('Error in commands:', e.message)
    }
    conn.disconnect()
    process.exit(0)
  })
  
  conn.on('error', (err) => console.error('Connection error:', err.message))
}
runTest()
