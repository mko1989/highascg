const { buildConfigXml } = require('../src/config/config-generator');
const { buildCasparGeneratorFlatConfig } = require('../src/config/build-caspar-generator-config');
const fs = require('fs');

const appConfig = JSON.parse(fs.readFileSync('/Users/marcin/.gemini/antigravity/highascg.config.json', 'utf8'));
try {
  const flat = buildCasparGeneratorFlatConfig(appConfig);
  const xml = buildConfigXml(flat);
  console.log("Success! XML length:", xml.length);
} catch (e) {
  console.error("ERROR:", e);
}
