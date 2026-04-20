/* Core price check engine — used by all store-specific jobs */

const db = require('./db');
const { sendMessage, sendPhoto } = require('./telegram');
const { getCurrSymbol } = require('./currency');
const uniqlo = require('./stores/uniqlo');
const hmGroup = require('./stores/hm-group');
const mango = require('./stores/mango');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPrice(store, group) {
  try {
    if (store === 'arket') return await hmGroup.fetchArketCurrentPrice(group.productUrl);
    if (store === 'cos') return await hmGroup.fetchCosCurrentPrice(group.productUrl);
    if (store === 'mango') return await mango.fetchMangoCurrentPrice(group.productUrl);
    return await uniqlo.fetchCurrentPrice(group.pc, group.region, '00');
  } catch (e) {
    console.error(`  fetch error: ${e.message}`);
    return null;
  }
}

function getSkuInfo(store, pr, colorCode, sizeCode) {
  if (store === 'arket') return hmGroup.getArketSkuInfo(pr, colorCode, sizeCode);
  if (store === 'cos') return hmGroup.getCosSkuInfo(pr, colorCode, sizeCode);
  if (store === 'mango') return mango.getMangoSkuInfo(pr, colorCode, sizeCode);
  return uniqlo.getSkuInfo(pr, colorCode, sizeCode);
}

/* ============================
   Main price check — for one store or all
   ============================ */

async function checkStore(store) {
  const products = await db.getActiveProductsByStore(store);
  if (products.length === 0) {
    console.log(`No active ${store} products`);
    return;
  }
  console.log(`=== ${store.toUpperCase()} PRICE CHECK: ${products.length} watchers ===`);
  await runPriceCheck(products);
}

async function runPriceCheck(products) {
  const startTime = Date.now();

  // Group by store + product_code + region to minimise fetches
  const groups = {};
  for (const p of products) {
    const store = p.store || 'uniqlo';
    const k = `${store}_${p.product_code}_${p.region}`;
    if (!groups[k]) {
      groups[k] = {
        pc: p.product_code,
        region: p.region || 'es',
        store,
        productUrl: p.product_url,
        watchers: []
      };
    }
    groups[k].watchers.push(p);
  }

  const priceUpdates = [];
  const notifications = [];
  const historyEntries = [];

  const keys = Object.keys(groups);
  let checked = 0;
  let failed = 0;

  for (const k of keys) {
    if (Date.now() - startTime > 10 * 60 * 1000) {
      console.log(`⚠️ Time limit reached: ${checked}/${keys.length}`);
      break;
    }

    const g = groups[k];
    try {
      await sleep(2000);
      const pr = await fetchPrice(g.store, g);
      if (!pr) {
        console.log(`⚠️ No data: ${g.store}:${g.pc}`);
        failed++;
        continue;
      }

      historyEntries.push({
        pc: g.pc,
        region: g.region,
        price: pr.currentPrice,
        onSale: pr.onSale
      });

      for (const wt of g.watchers) {
        const op = parseFloat(wt.last_price);
        const skuInfo = getSkuInfo(g.store, pr, wt.color_code, wt.size_code);
        const np = skuInfo ? skuInfo.price : pr.currentPrice;
        const inStock = skuInfo ? skuInfo.inStock : true;
        const lp = Math.min(parseFloat(wt.lowest_price) || 9999, np);

        if (np > 0) {
          priceUpdates.push({
            id: wt.id,
            price: np,
            lowest: lp
          });
        }

        if (np < op && np > 0 && inStock) {
          const hasTarget = wt.target_price && parseFloat(wt.target_price) > 0;
          const meetsTarget = !hasTarget || np <= parseFloat(wt.target_price);
          if (meetsTarget) {
            notifications.push({ watcher: wt, oldPrice: op, newPrice: np, lowest: lp });
          }
        }
      }
      checked++;
    } catch (e) {
      console.error(`❌ Error: ${g.store}:${g.pc}: ${e.message}`);
      failed++;
    }
  }

  await db.batchUpdatePrices(priceUpdates);
  await db.batchAddHistory(historyEntries);

  for (const ntf of notifications) {
    try {
      await sendDrop(ntf.watcher, ntf.oldPrice, ntf.newPrice, ntf.lowest);
    } catch (e) {
      console.error(`❌ Notification failed: ${e.message}`);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(
    `✅ Done: ${checked}/${keys.length} checked, ${failed} failed, ${notifications.length} drops, ${elapsed}s`
  );
}

async function sendDrop(w, op, np, lp) {
  const s = getCurrSymbol(w.currency);
  const d = Math.round((1 - np / op) * 100);
  const store = w.store || 'uniqlo';
  const storeName = store === 'arket' ? 'ARKET' : store === 'cos' ? 'COS' : store === 'mango' ? 'Mango' : 'Uniqlo';

  let productLink = '';
  if (store === 'arket' || store === 'cos') {
    productLink = w.product_url || '';
    if (productLink && !productLink.startsWith('http')) {
      productLink = `https://www.${store}.com${productLink}`;
    }
  } else if (store === 'mango') {
    productLink = w.product_url || '';
    if (productLink && !productLink.startsWith('http')) {
      productLink = `https://shop.mango.com${productLink}`;
    }
  } else {
    productLink = uniqlo.buildProductUrl(w.product_code, w.region, w.color_code, w.size_code);
  }

  const sizeLabel = store === 'arket' || store === 'cos' || store === 'mango' ? w.size_code : uniqlo.getSizeName(w.size_code);

  let t = `*PRICE DROP* (${storeName})\n\n*${w.name}*\n`;
  if (w.color_name) t += `${w.color_name}\n`;
  if (w.size_code) t += `Size: ${sizeLabel}\n`;
  t += `\nWas: ${s}${op.toFixed(2)}`;
  t += `\n*Now: ${s}${np.toFixed(2)}* (-${d}%)`;
  t += `\nLowest: ${s}${lp.toFixed(2)}`;

  if (w.target_price && np <= parseFloat(w.target_price)) {
    t += '\n\n🎯 *Below your target price!*';
  }
  t += `\n\n[Open on ${storeName}](${productLink})`;

  try {
    if (w.image_url) {
      await sendPhoto(w.chat_id, w.image_url, t);
    } else {
      await sendMessage(w.chat_id, t);
    }
    await db.logNotification(w.chat_id, w.product_code, op, np);
  } catch (e) {
    console.error(`❌ Failed to notify ${w.chat_id}: ${e.message}`);
  }
}

module.exports = { checkStore, runPriceCheck, sendDrop };
