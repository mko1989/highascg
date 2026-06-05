const net = require('net');
const client = new net.Socket();
client.connect(5250, '127.0.0.1', () => {
  console.log('Connected');
  client.write("BEGIN\r\nPLAY 1-10 AMB\r\nPLAY 1-11 AMB\r\nCOMMIT\r\n");
});
client.on('data', data => {
  console.log('Received: ' + data.toString());
  setTimeout(() => { client.destroy(); process.exit(0); }, 500);
});
client.on('error', err => console.error(err));
