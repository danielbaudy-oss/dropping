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
    const seenCodes = await db.getSaleCache(cacheKey);
    console.log(`Previously seen: ${Object.keys(seenCodes).length} | Current: ${items.length}`);

    const newItems = [];
    const allCodes = {};
    for (const it of items) {
      allCodes[it.productCode] = true;
      if (!seenCodes[it.productCode]) newItems.push(it);
    }

    console.log(`New items: ${newItems.length}`);
    await db.setSaleCache(cacheKey, allCodes);

    // First run: silent cache build
    if (Object.keys(seenCodes).length === 0 && newItems.length > 0) {
      console.log(`First run for ${key} — caching ${items.length} items silently`);
      continue;
    }

    if (newItems.length === 0) continue;

    console.log(`Checking stock for ${newItems.length} new items...`);
    await sales.enrichWithStock(newItems, group.region);

    for (const sub of group.subscribers) {
      const prefs = sub.salePrefs;
      const filter = {
        gender: group.gender,
        categories: prefs.categories || [],
        sizes: sales.buildSizeFilters(prefs),
        minDiscount: 0
      };

      const matching = newItems.filter((it) => sales.saleItemMatchesFilter(it, filter));
      if (matching.length === 0) continue;

      console.log(`Sending digest + ${matching.length} alerts to ${sub.chat_id}`);

      const today = new Date();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateStr = `${today.getDate()} ${months[today.getMonth()]}`;
      const gLabel = group.gender === 'women' ? "Women's" : "Men's";
      const digest = `🏷 *Uniqlo ${gLabel} Sale Update — ${dateStr}*\n\n${matching.length} new item${matching.length > 1 ? 's' : ''} in your size`;
      await sendMessage(sub.chat_id, digest);
      await sleep(300);

      for (const item of matching) {
        await sendSaleAlert(sub.chat_id, item, filter);
        await sleep(300);
      }
    }
  }

  console.log(`=== SALES CHECK DONE (${Math.round((Date.now() - startTime) / 1000)}s) ===`);
}

async function sendSaleAlert(chatId, item, filter) {
  const s = item.currencySymbol || '€';
  let text = `🏷 *NEW ON SALE*\n\n*${item.name}*\nWas: ${s}${item.basePrice.toFixed(2)}\n*Now: ${s}${item.salePrice.toFixed(2)}* (-${item.discount}%)\n`;

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
