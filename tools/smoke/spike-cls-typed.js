const { CasparCG } = require('casparcg-connection');
(async () => {
  const ccg = new CasparCG({ host: '127.0.0.1', port: 5250 });
  try {
    const res = await ccg.cls();
    const data = await res.request;
    console.log(data.data[0]);
  } catch (e) {
    console.error(e);
  } finally {
    ccg.disconnect();
  }
})();
