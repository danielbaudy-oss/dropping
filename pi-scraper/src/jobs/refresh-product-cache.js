/* Fetch full product data (all colors, sizes, stock) for all active products
   and store in dropping.product_cache. Frontend uses this for the edit modal. */

const db = require('../db');
const uniqlo = require('../stores/uniqlo');
const hmGroup = require('../stores/hm-group');
const mango = require('../stores/mango');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFullUniqlo(pc, region) {
  const pr = await uniqlo.fetchPricesAndStock(pc, region, '00');
  if (!pr) return null;

  // Build a full product shape like the frontend expects
  const cn = pc.replace('E', '').replace('-000', '');
  const colors = pr.colors.map((c) => ({
    code: c.code,
    name: c.name || '',
    image: `https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/${cn}/item/eugoods_${c.code}_${cn}_3x4.jpg`,
    available: c.sizes.some((s) => s.inStock),
    sizes: c.sizes
  }));

  return {
    productCode: pc,
    name: '', // Frontend will keep the name from the DB row
    image: colors[0]?.image || '',
    mainImage: colors[0]?.image || '',
    currentPrice: pr.currentPrice,
    originalPrice: pr.originalPrice,
    onSale: pr.onSale,
    currency: pr.colors[0]?.sizes[0]?.currency || 'EUR',
    currencySymbol: pr.colors[0]?.sizes[0]?.currencySymbol || '€',
    colors: colors,
    sizes: pr.sizes,
    region: region,
    store: 'uniqlo'
  };
}

async function fetchFullHMGroup(store, productUrl) {
  const pr =
    store === 'arket'
      ? await hmGroup.fetchArketCurrentPrice(productUrl)
      : await hmGroup.fetchCosCurrentPrice(productUrl);
  if (!pr) return null;
  return {
    currentPrice: pr.currentPrice,
    originalPrice: pr.originalPrice,
    onSale: pr.onSale,
    colors: pr.colors.map((c) => ({ code: c.code, name: '', image: '', available: true, sizes: c.sizes })),
    sizes: [...new Set(pr.colors.flatMap((c) => c.sizes.map((s) => s.sizeCode)))].map((s) => ({ code: s, name: s })),
    store: store
  };
}

async function fetchFullMango(productUrl) {
  const pr = await mango.fetchMangoCurrentPrice(productUrl);
  if (!pr) return null;
  return {
    currentPrice: pr.currentPrice,
    originalPrice: pr.originalPrice,
    onSale: pr.onSale,
    colors: pr.colors.map((c) => ({ code: c.code, name: '', image: '', available: true, sizes: c.sizes })),
    sizes: [...new Set(pr.colors.flatMap((c) => c.sizes.map((s) => s.sizeCode)))].map((s) => ({ code: s, name: s })),
    store: 'mango'
  };
}

async function upsertCache(productCode, region, store, data) {
  const { error } = await db.supabase
    .from('product_cache')
    .upsert({ product_code: productCode, region, store, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function run() {
  const products = await db.getAllActiveProducts();
  const groups = {};
  for (const p of products) {
    const k = `${p.store || 'uniqlo'}_${p.product_code}_${p.region}`;
    if (!groups[k]) {
      groups[k] = { pc: p.product_code, region: p.region, store: p.store || 'uniqlo', url: p.product_url };
    }
  }
  const keys = Object.keys(groups);
  console.log(`Refreshing product cache for ${keys.length} product groups`);

  let ok = 0;
  let fail = 0;
  for (const k of keys) {
    const g = groups[k];
    try {
      await sleep(1500);
      let data = null;
      if (g.store === 'uniqlo') data = await fetchFullUniqlo(g.pc, g.region);
      else if (g.store === 'arket' || g.store === 'cos') data = await fetchFullHMGroup(g.store, g.url);
      else if (g.store === 'mango') data = await fetchFullMango(g.url);

      if (data) {
        await upsertCache(g.pc, g.region, g.store, data);
        ok++;
        console.log(`✅ ${g.store}:${g.pc}`);
      } else {
        fail++;
        console.log(`❌ ${g.store}:${g.pc} (no data)`);
      }
    } catch (e) {
      fail++;
      console.log(`❌ ${g.store}:${g.pc} — ${e.message}`);
    }
  }
  console.log(`Done: ${ok} ok, ${fail} failed`);
}

run().then(async () => {
  try {
    const { closeBrowser } = require('../headless');
    await closeBrowser();
  } catch (e) {}
  process.exit(0);
}).catch(async (e) => {
  console.error(e);
  try {
    const { closeBrowser } = require('../headless');
    await closeBrowser();
  } catch (e) {}
  process.exit(1);
});
