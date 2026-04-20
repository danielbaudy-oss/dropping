const { checkStore } = require('../price-check');

checkStore('arket').then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
