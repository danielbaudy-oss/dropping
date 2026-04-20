/* Verify we can reach Supabase and read dropping schema */

const db = require('./db');

async function main() {
  console.log('=== CONNECTION TEST ===');
  const products = await db.getAllActiveProducts();
  console.log(`Found ${products.length} active products:`);
  for (const p of products) {
    console.log(`  [${p.store}] ${p.name} (chat_id: ${p.chat_id})`);
  }
  const subs = await db.getSaleSubscribers();
  console.log(`Sale subscribers: ${subs.length}`);
  const token = await db.getConfig('bot_token');
  console.log(`bot_token: ${token ? '✅ found' : '❌ missing'}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
