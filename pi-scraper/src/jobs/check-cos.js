const { checkStore } = require('../price-check');
const { closeBrowser } = require('../headless');

checkStore('cos').then(() => closeBrowser()).then(() => process.exit(0)).catch((e) => {
  console.error(e);
  closeBrowser().then(() => process.exit(1));
});
