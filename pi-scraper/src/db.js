/* Supabase client wrapper — all DB access goes through here.
   Uses the service role key (full access) since this is a backend worker. */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'dropping' },
  auth: { persistSession: false }
});

/* ============================
   PRODUCTS
   ============================ */

async function getActiveProductsByStore(store) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'watching')
    .eq('store', store);
  if (error) throw error;
  return data || [];
}

async function getAllActiveProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('status', 'watching');
  if (error) throw error;
  return data || [];
}

async function updateProductPrice(id, price, lowest) {
  const { error } = await supabase
    .from('products')
    .update({
      last_price: price,
      lowest_price: lowest,
      last_checked: new Date().toISOString()
    })
    .eq('id', id);
  if (error) throw error;
}

async function batchUpdatePrices(updates) {
  // Supabase doesn't support bulk update in one call without upsert;
  // sequential is fine for typical volumes
  for (const u of updates) {
    await updateProductPrice(u.id, u.price, u.lowest);
  }
}

/* ============================
   PRICE HISTORY
   ============================ */

async function addPriceHistory(productCode, region, price, onSale) {
  const { error } = await supabase
    .from('price_history')
    .insert({
      product_code: productCode,
      region: region,
      price: price,
      on_sale: onSale,
      checked_at: new Date().toISOString()
    });
  if (error) throw error;
}

async function batchAddHistory(entries) {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    product_code: e.pc,
    region: e.region,
    price: e.price,
    on_sale: e.onSale,
    checked_at: new Date().toISOString()
  }));
  const { error } = await supabase.from('price_history').insert(rows);
  if (error) throw error;
}

/* ============================
   NOTIFICATIONS
   ============================ */

async function logNotification(chatId, productCode, oldPrice, newPrice) {
  const { error } = await supabase
    .from('notifications')
    .insert({
      chat_id: chatId,
      product_code: productCode,
      old_price: oldPrice,
      new_price: newPrice
    });
  if (error) console.error('logNotification failed:', error.message);
}

/* ============================
   SALE SUBSCRIBERS & CACHE
   ============================ */

async function getSaleSubscribers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('sale_alerts', true);
  if (error) throw error;
  return (data || []).map((u) => ({
    ...u,
    salePrefs: u.sale_prefs || {}
  }));
}

async function getSaleCache(key) {
  const { data, error } = await supabase
    .from('sale_cache')
    .select('product_codes')
    .eq('cache_key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.product_codes : {};
}

async function setSaleCache(key, codesObj) {
  const { error } = await supabase
    .from('sale_cache')
    .upsert({
      cache_key: key,
      product_codes: codesObj,
      updated_at: new Date().toISOString()
    });
  if (error) throw error;
}

/* ============================
   CONFIG
   ============================ */

async function getConfig(key) {
  const { data, error } = await supabase
    .from('config')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

module.exports = {
  supabase,
  getActiveProductsByStore,
  getAllActiveProducts,
  updateProductPrice,
  batchUpdatePrices,
  addPriceHistory,
  batchAddHistory,
  logNotification,
  getSaleSubscribers,
  getSaleCache,
  setSaleCache,
  getConfig
};
