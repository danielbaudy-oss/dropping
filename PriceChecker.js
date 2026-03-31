/* ============================
   PRICE CHECKER (runs via store-specific triggers)
   ============================ */

var CSYM_PC = {
  GBP: '£', USD: '$', CHF: 'CHF', SEK: 'kr',
  DKK: 'kr', NOK: 'kr', PLN: 'zł', EUR: '€',
  CAD: '$', AUD: '$'
};

function getCurrSymbol(code) {
  return CSYM_PC[code] || '€';
}

/* ============================
   STORE-SPECIFIC CHECKERS (called by triggers)
   ============================ */

function checkUniqlo() { checkByStore('uniqlo'); }
function checkArket() { checkByStore('arket'); }
function checkCos() { checkByStore('cos'); }
function checkMango() { checkByStore('mango'); }

function checkByStore(store) {
  var all = getAllActiveProducts().filter(function(p) {
    return (p.store || 'uniqlo') === store;
  });
  if (all.length === 0) {
    Logger.log('No active ' + store + ' products');
    return;
  }
  Logger.log('=== ' + store.toUpperCase() + ' PRICE CHECK: ' + all.length + ' watchers ===');
  runPriceCheck(all);
}

/* ============================
   LEGACY — checks all stores at once
   ============================ */

function checkAllPrices() {
  var all = getAllActiveProducts();
  if (all.length === 0) return;
  Logger.log('=== CHECK ALL PRICES: ' + all.length + ' watchers ===');
  runPriceCheck(all);
}

/* ============================
   CORE PRICE CHECK ENGINE
   ============================ */

function runPriceCheck(products) {
  var startTime = Date.now();

  var groups = {};
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    var store = p.store || 'uniqlo';
    var k = store + '_' + p.product_code + '_' + p.region;
    if (!groups[k]) {
      groups[k] = {
        pc: p.product_code,
        region: p.region || 'es',
        store: store,
        productUrl: p.product_url,
        watchers: []
      };
    }
    groups[k].watchers.push(p);
  }

  var priceUpdates = [];
  var notifications = [];
  var historyEntries = [];

  var keys = Object.keys(groups);
  var checked = 0;
  var failed = 0;

  for (var k = 0; k < keys.length; k++) {
    if (Date.now() - startTime > 330000) {
      Logger.log('⚠️ Time limit: checked ' + checked + '/' + keys.length);
      break;
    }

    var g = groups[keys[k]];
    try {
      Utilities.sleep(2000);

      var pr = null;
      if (g.store === 'arket') {
        pr = fetchArketCurrentPrice(g.productUrl);
      } else if (g.store === 'cos') {
        pr = fetchCosCurrentPrice(g.productUrl);
      } else if (g.store === 'mango') {
        pr = fetchMangoCurrentPrice(g.productUrl);
      } else {
        pr = fetchCurrentPrice(g.pc, g.region, '00');
      }

      if (!pr) {
        Logger.log('⚠️ No data: ' + g.store + ':' + g.pc);
        failed++;
        continue;
      }

      historyEntries.push({
        pc: g.pc, region: g.region,
        price: pr.currentPrice, onSale: pr.onSale
      });

      for (var w = 0; w < g.watchers.length; w++) {
        var wt = g.watchers[w];
        var op = parseFloat(wt.last_price);

        var skuInfo = null;
        if (g.store === 'arket') {
          skuInfo = getArketSkuInfo(pr, wt.color_code, wt.size_code);
        } else if (g.store === 'cos') {
          skuInfo = getCosSkuInfo(pr, wt.color_code, wt.size_code);
        } else if (g.store === 'mango') {
          skuInfo = getMangoSkuInfo(pr, wt.color_code, wt.size_code);
        } else {
          skuInfo = getSkuInfo(pr, wt.color_code, wt.size_code);
        }

        var np = skuInfo ? skuInfo.price : pr.currentPrice;
        var inStock = skuInfo ? skuInfo.inStock : true;
        var lp = Math.min(parseFloat(wt.lowest_price) || 9999, np);

        if (np > 0) {
          priceUpdates.push({
            id: wt.id, price: np, lowest: lp,
            lastChecked: new Date().toISOString()
          });
        }

        if (np < op && np > 0 && inStock) {
          var hasTarget = wt.target_price && parseFloat(wt.target_price) > 0;
          var meetsTarget = !hasTarget || np <= parseFloat(wt.target_price);
          if (meetsTarget) {
            notifications.push({
              watcher: wt, oldPrice: op,
              newPrice: np, lowest: lp
            });
          }
        }
      }
      checked++;
    } catch (e) {
      Logger.log('❌ Error: ' + g.store + ':' + g.pc + ': ' + e);
      failed++;
    }
  }

  batchUpdatePrices(priceUpdates);
  batchAddHistory(historyEntries);

  for (var n = 0; n < notifications.length; n++) {
    var ntf = notifications[n];
    try {
      sendDrop(ntf.watcher, ntf.oldPrice, ntf.newPrice, ntf.lowest);
    } catch (e) {
      Logger.log('❌ Notification failed: ' + e);
    }
  }

  var elapsed = Math.round((Date.now() - startTime) / 1000);
  Logger.log('✅ Done: ' + checked + '/' + keys.length + ' checked, ' +
    failed + ' failed, ' + notifications.length + ' drops, ' + elapsed + 's');
}

/* ============================
   BATCH SHEET OPERATIONS
   ============================ */

function batchUpdatePrices(updates) {
  if (updates.length === 0) return;
  var s = getSheet('Products');
  var d = s.getDataRange().getValues();
  var h = d[0];
  var idIdx = getColumnIndex(h, 'id');
  var lpIdx = getColumnIndex(h, 'last_price');
  var lwIdx = getColumnIndex(h, 'lowest_price');
  var lcIdx = getColumnIndex(h, 'last_checked');

  if (idIdx === -1 || lpIdx === -1 || lwIdx === -1) {
    Logger.log('❌ batchUpdatePrices: missing columns');
    return;
  }

  var lookup = {};
  for (var i = 0; i < updates.length; i++) {
    lookup[String(updates[i].id)] = updates[i];
  }

  var changed = false;
  for (var i = 1; i < d.length; i++) {
    var u = lookup[String(d[i][idIdx])];
    if (u) {
      d[i][lpIdx] = u.price;
      d[i][lwIdx] = u.lowest;
      if (lcIdx !== -1) d[i][lcIdx] = u.lastChecked;
      changed = true;
    }
  }

  if (changed) {
    s.getRange(1, 1, d.length, d[0].length).setValues(d);
  }
}

function batchAddHistory(entries) {
  if (entries.length === 0) return;
  var s = getSheet('PriceHistory');
  var rows = [];
  var now = new Date().toISOString();
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    rows.push([e.pc, e.region, e.price, e.onSale ? 'TRUE' : 'FALSE', now]);
  }
  s.getRange(s.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
}

/* ============================
   NOTIFICATIONS
   ============================ */

function sendDrop(w, op, np, lp) {
  var s = getCurrSymbol(w.currency);
  var d = Math.round((1 - np / op) * 100);
  var store = w.store || 'uniqlo';
  var storeName = store === 'arket' ? 'ARKET' : store === 'cos' ? 'COS' : store === 'mango' ? 'Mango' : 'Uniqlo';

  // Build product link
  var productLink = '';
  if (store === 'arket' || store === 'cos') {
    productLink = w.product_url || '';
    if (productLink && productLink.indexOf('http') !== 0) {
      productLink = 'https://www.' + store + '.com' + productLink;
    }
  } else if (store === 'mango') {
    productLink = w.product_url || '';
    if (productLink && productLink.indexOf('http') !== 0) {
      productLink = 'https://shop.mango.com' + productLink;
    }
  } else {
    productLink = buildProductUrl(w.product_code, w.region, w.color_code, w.size_code);
  }

  // Size label
  var sizeLabel = (store === 'arket' || store === 'cos' || store === 'mango')
    ? w.size_code
    : getSizeName(w.size_code);

  var t = '*PRICE DROP* (' + storeName + ')\n\n*' + w.name + '*\n' +
    (w.color_name ? w.color_name + '\n' : '') +
    (w.size_code ? 'Size: ' + sizeLabel + '\n' : '') +
    '\nWas: ' + s + op.toFixed(2) +
    '\n*Now: ' + s + np.toFixed(2) + '* (-' + d + '%)' +
    '\nLowest: ' + s + lp.toFixed(2);

  if (w.target_price && np <= parseFloat(w.target_price)) {
    t += '\n\n🎯 *Below your target price!*';
  }

  t += '\n\n[Open on ' + storeName + '](' + productLink + ')';

  try {
    if (w.image_url) {
      sendPhoto(w.chat_id, w.image_url, t);
    } else {
      sendMessage(w.chat_id, t);
    }
    logNotification(w.chat_id, w.product_code, op, np);
  } catch (e) {
    Logger.log('❌ Failed to notify ' + w.chat_id + ': ' + e);
  }
}