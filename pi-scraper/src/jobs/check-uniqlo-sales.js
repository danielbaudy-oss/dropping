/* Daily Uniqlo sales check.
   Finds new sale items that match each subscriber's filters and sends digest + item cards. */

const db = require('../db');
const { sendMessage, sendPhoto } = require('../telegram');
const sales = require('../stores/uniqlo-sales');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const startTime = Date.now();
  console.log('=== UNIQLO SALES CHECK ===');

  const subscribers = await db.getSaleSubscribers();
  if (subscribers.length === 0) {
    console.log('No sale alert subscribers');
    return;
  }
  console.log(`Subscribers: ${subscribers.length}`);

  const fetchGroups = {};
  for (const sub of subscribers) {
    const prefs = sub.salePrefs;
    const region = prefs.region || sub.region || 'es';
    const genders = !prefs.gender || prefs.gender === 'both' ? ['men', 'women'] : [prefs.gender];
    for (const g of genders) {
      const key = `${region}_${g}`;
      if (!fetchGroups[key]) fetchGroups[key] = { region, gender: g, subscribers: [] };
      fetchGroups[key].subscribers.push(sub);
    }
  }

  for (const key of Object.keys(fetchGroups)) {
    if (Date.now() - startTime > 10 * 60 * 1000) {
      console.log('⚠️ Time limit reached');
      break;
    }

    const group = fetchGroups[key];
    console.log(`Fetching: ${group.region}/${group.gender}`);
    await sleep(1500);
    const items = await sales.fetchSalePageProducts(group.region, group.gender);
    if (!items || items.length === 0) {
      console.log(`No items for ${key}`);
      continue;
    }

    const cacheKey = `sale_${group.region}_${group.gender}`;
    const seenCache = await db.getSaleCache(cacheKey);
    const seenCount = Object.keys(seenCache).length;
    console.log(`Previously seen: ${seenCount} | Current: ${items.length}`);

    /* Categorise items:
       - newItems:   not in cache at all → "NEW ON SALE"
       - deeperItems: in cache but current price < cached price → "BIGGER DISCOUNT"
       - seen same or higher: ignore
       Build the updated cache with current prices. */
    const newItems = [];
    const deeperItems = [];
    const newCache = {};
    for (const it of items) {
      newCache[it.productCode] = { price: it.salePrice, discount: it.discount };

      const prev = seenCache[it.productCode];
      // Handle legacy cache entries where value was just `true`
      const prevPrice = (prev && typeof prev === 'object') ? prev.price : null;

      if (!prev) {
        newItems.push(it);
      } else if (prevPrice !== null && it.salePrice < prevPrice) {
        it._prevPrice = prevPrice;
        it._prevDiscount = (prev && typeof prev === 'object') ? prev.discount : null;
        deeperItems.push(it);
      }
    }

    console.log(`New items: ${newItems.length} | Deeper discounts: ${deeperItems.length}`);
    await db.setSaleCache(cacheKey, newCache);

    // First run: silent cache build (nothing in cache yet)
    if (seenCount === 0 && items.length > 0) {
      console.log(`First run for ${key} — caching ${items.length} items silently`);
      continue;
    }

    if (newItems.length === 0 && deeperItems.length === 0) continue;

    const itemsToEnrich = [...newItems, ...deeperItems];
    console.log(`Checking stock for ${itemsToEnrich.length} items...`);
    await sales.enrichWithStock(itemsToEnrich, group.region);

    for (const sub of group.subscribers) {
      const prefs = sub.salePrefs;
      const filter = {
        gender: group.gender,
        categories: prefs.categories || [],
        sizes: sales.buildSizeFilters(prefs),
        minDiscount: 0
      };

      const matchingNew = newItems.filter((it) => sales.saleItemMatchesFilter(it, filter));
      const matchingDeeper = deeperItems.filter((it) => sales.saleItemMatchesFilter(it, filter));
      const totalMatching = matchingNew.length + matchingDeeper.length;
      if (totalMatching === 0) continue;

      console.log(`Sending digest + ${totalMatching} alerts to ${sub.chat_id} (${matchingNew.length} new, ${matchingDeeper.length} deeper)`);

      const today = new Date();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateStr = `${today.getDate()} ${months[today.getMonth()]}`;
      const gLabel = group.gender === 'women' ? "Women's" : "Men's";
      let digest = `🏷 *Uniqlo ${gLabel} Sale Update — ${dateStr}*\n\n`;
      if (matchingNew.length > 0) digest += `${matchingNew.length} new item${matchingNew.length > 1 ? 's' : ''} in your size\n`;
      if (matchingDeeper.length > 0) digest += `${matchingDeeper.length} bigger discount${matchingDeeper.length > 1 ? 's' : ''} on items already on sale`;
      await sendMessage(sub.chat_id, digest);
      await sleep(300);

      for (const item of matchingNew) {
        await sendSaleAlert(sub.chat_id, item, filter, 'new');
        await sleep(300);
      }
      for (const item of matchingDeeper) {
        await sendSaleAlert(sub.chat_id, item, filter, 'deeper');
        await sleep(300);
      }
    }
  }

  console.log(`=== SALES CHECK DONE (${Math.round((Date.now() - startTime) / 1000)}s) ===`);
}

async function sendSaleAlert(chatId, item, filter, kind) {
  const s = item.currencySymbol || '€';
  const header = kind === 'deeper' ? '📉 *BIGGER DISCOUNT*' : '🏷 *NEW ON SALE*';
  let text = `${header}\n\n*${item.name}*\n`;

  if (kind === 'deeper' && item._prevPrice != null) {
    text += `Was: ${s}${item.basePrice.toFixed(2)} → earlier: ${s}${item._prevPrice.toFixed(2)}\n`;
    text += `*Now: ${s}${item.salePrice.toFixed(2)}* (-${item.discount}%)\n`;
  } else {
    text += `Was: ${s}${item.basePrice.toFixed(2)}\n*Now: ${s}${item.salePrice.toFixed(2)}* (-${item.discount}%)\n`;
  }

  const hasColorBreakdown = item.colorStock && Object.keys(item.colorStock).length > 0 && filter;
  let firstOnSaleColor = '';

  if (hasColorBreakdown) {
    const filterSizes = filter.sizes || [];
    const cNames = item.colorNames || {};
    const onSale = item.colorOnSale || {};

    const sizeColorMap = {};
    for (const cc of Object.keys(item.colorStock)) {
      if (Object.keys(onSale).length > 0 && !onSale[cc]) continue;
      if (!firstOnSaleColor) firstOnSaleColor = cc;
      const colorName = cNames[cc] || cc;
      const sizesForColor = item.colorStock[cc];
      for (const sc of Object.keys(sizesForColor)) {
        if (!sizesForColor[sc]) continue;
        const sizeName = sales.SALE_SIZE_MAP[sc] || sc;
        let matchesFilter = filterSizes.length === 0;
        if (!matchesFilter) {
          for (const fs of filterSizes) {
            if (sc === fs || sizeName === fs) {
              matchesFilter = true;
              break;
            }
          }
        }
        if (matchesFilter) {
          if (!sizeColorMap[sizeName]) sizeColorMap[sizeName] = [];
          if (!sizeColorMap[sizeName].includes(colorName)) sizeColorMap[sizeName].push(colorName);
        }
      }
    }

    const sizeKeys = Object.keys(sizeColorMap);
    if (sizeKeys.length > 0) {
      text += '\n';
      for (const sk of sizeKeys) {
        text += `*${sk}* — ${sizeColorMap[sk].join(', ')}\n`;
      }
    }
  }

  let url = item.url || '';
  if (firstOnSaleColor) {
    url = url.replace('/00', '/01');
    if (!url.includes('colorDisplayCode')) {
      url += (url.includes('?') ? '&' : '?') + `colorDisplayCode=${firstOnSaleColor}`;
    }
  }
  text += `\n[View on Uniqlo](${url})`;

  try {
    if (item.image) {
      await sendPhoto(chatId, item.image, text);
    } else {
      await sendMessage(chatId, text);
    }
  } catch (e) {
    console.error(`Sale alert failed for ${chatId}: ${e.message}`);
    try {
      await sendMessage(chatId, text);
    } catch (e2) {}
  }
}

run().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
