const { checkStore } = require('../price-check');

checkStore('uniqlo').then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
