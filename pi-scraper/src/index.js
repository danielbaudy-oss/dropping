/* Manual runner — for testing. In production, cron runs individual job files. */

const command = process.argv[2];

const jobs = {
  uniqlo: () => require('./jobs/check-uniqlo'),
  arket: () => require('./jobs/check-arket'),
  cos: () => require('./jobs/check-cos'),
  mango: () => require('./jobs/check-mango'),
  sales: () => require('./jobs/check-uniqlo-sales')
};

if (!command || !jobs[command]) {
  console.log('Usage: node src/index.js <uniqlo|arket|cos|mango|sales>');
  process.exit(1);
}

jobs[command]();
