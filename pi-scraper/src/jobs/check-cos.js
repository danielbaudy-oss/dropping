const { checkStore } = require('../price-check');

checkStore('cos').then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
