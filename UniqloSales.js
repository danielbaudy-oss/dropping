/* ============================
   UNIQLO SALES MONITOR
   Strategy: HTML → extract IDs → batch API → compare cache → notify
   ============================ */

var SALE_CATEGORY_PATTERNS = {
  tops: /t-shirt|tee|polo|shirt|blouse|sweater|sweatshirt|hoodie|cardigan|knit|vest|tank|top|fleece|henley|jersey|jumper|airism.*crew|heattech.*crew|parka.*sweat|hemd|pullover|oberteil|strick|camiseta|camisa|sudadera|punto|maglia|maglione|felpa/i,
  bottoms: /pant|trouser|chino|jogger|short(?!s?\s*sleeve)|skirt|legging|cargo|sweatpant|hose|rock|pantalon|falda|pantaloni|gonna/i,
  jeans: /jean|denim/i,
  outerwear: /jacket|coat|parka|blazer|gilet|down|windbreaker|anorak|bomber|blouson|overcoat|puffertech|blocktech|jacke|mantel|weste|daunen|chaqueta|abrigo|chaleco|giacca|cappotto|gilet/i,
  accessories: /sock|hat|cap|scarf|stole|glove|belt|bag|underwear|boxer|brief|trunk|heattech.*inner|airism.*inner|shoe|trainer|sandal|deck\s|socke|handschuh|schal|m[uü]tze|tasche|schuh|calcet[ií]n|gorro|bufanda|guante|bolsa|zapato|calzino|cappello|sciarpa|guanto|borsa|scarpa/i
};

var SALE_SIZE_MAP = {
  '001': 'XXS', '002': 'XS', '003': 'S', '004': 'M', '005': 'L',
  '006': 'XL', '007': 'XXL', '008': '3XL', '999': 'One Size',
  '028': '28', '029': '29', '030': '30', '031': '31', '032': '32',
  '033': '33', '034': '34', '036': '36'
};

function categorizeSaleProduct(name) {
  if (!name) return 'other';
  for (var cat in SALE_CATEGORY_PATTERNS) {
    if (SALE_CATEGORY_PATTERNS[cat].test(name)) return cat;
  }
  return 'other';
}


/* ============================
   STEP 3: NORMALISE API ITEMS
   ============================ */

function normaliseSaleApiItems(apiItems, region, lang, gender) {
  var items = [];
  for (var i = 0; i < apiItems.length; i++) {
    var r = apiItems[i];

    var pc = r.productId || '';
    if (!pc) continue;

    var name = r.name || '';

    // Prices
    var basePrice = 0, promoPrice = 0, currency = 'EUR', symbol = '€';
    if (r.prices) {
      if (r.prices.base) {
        basePrice = r.prices.base.value || 0;
        if (r.prices.base.currency) {
          currency = r.prices.base.currency.code || currency;
          symbol = r.prices.base.currency.symbol || symbol;
        }
      }
      if (r.prices.promo) {
        promoPrice = r.prices.promo.value || 0;
      }
    }
    if (!promoPrice) promoPrice = basePrice;
    if (!basePrice) basePrice = promoPrice;

    // Only include items actually on sale
    var onSale = promoPrice > 0 && promoPrice < basePrice;
    if (!onSale) continue;

    var discount = basePrice > 0 ? Math.round((1 - promoPrice / basePrice) * 100) : 0;

    // Image
    var image = '';
    var repColor = r.representativeColorDisplayCode || '';
    if (r.images && r.images.main) {
      if (repColor && r.images.main[repColor]) {
        image = r.images.main[repColor].image || '';
      } else {
        var imgKeys = Object.keys(r.images.main);
        if (imgKeys.length > 0 && r.images.main[imgKeys[0]]) {
          image = r.images.main[imgKeys[0]].image || '';
        }
      }
    }

    // Sizes
    var sizes = [];
    if (r.sizes && Array.isArray(r.sizes)) {
      for (var s = 0; s < r.sizes.length; s++) {
        var sz = r.sizes[s];
        var sizeName = sz.name || SALE_SIZE_MAP[sz.displayCode] || sz.displayCode || '';
        sizes.push({
          code: sz.displayCode || '',
          name: sizeName,
          inStock: true // listing API doesn't include stock — assume in stock
        });
      }
    }

    // Colors
    var colors = [];
    if (r.colors && Array.isArray(r.colors)) {
      for (var c = 0; c < r.colors.length; c++) {
        colors.push({
          code: r.colors[c].displayCode || '',
          name: r.colors[c].name || ''
        });
      }
    }

    // Gender from API
    var genderCat = (r.genderCategory || '').toUpperCase();

    var category = categorizeSaleProduct(name);

    items.push({
      productCode: pc,
      name: name,
      basePrice: basePrice,
      salePrice: promoPrice,
      discount: discount,
      currency: currency,
      currencySymbol: symbol,
      image: image,
      sizes: sizes,
      colors: colors,
      category: category,
      gender: gender,
      genderCategory: genderCat,
      region: region,
      url: 'https://www.uniqlo.com/' + region + '/' + (lang || 'en') + '/products/' + pc + '/00'
    });
  }
  return items;
}

/* ============================
   COMBINED FETCH (HTML IDs → API data)
   ============================ */

function fetchSalePageProducts(region, gender) {
  var lang = UNIQLO_LANGS[region] || 'en';
  var clientId = UNIQLO_CLIENTS[region] || 'uq.' + region + '.web-spa';
  var allItems = [];
  var offset = 0;
  var limit = 100;
  var total = 999;

  Logger.log('Sale: fetching ' + region + '/' + gender + ' via API');

  while (offset < total) {
    var apiUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang +
      '/products?flagCodes=discount&offset=' + offset + '&limit=' + limit +
      '&imageRatio=3x4&httpFailure=true';

    try {
      var r = UrlFetchApp.fetch(apiUrl, {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.uniqlo.com/' + region + '/',
          'x-fr-clientid': clientId
        }
      });

      if (r.getResponseCode() !== 200) break;

      var data = JSON.parse(r.getContentText());
      if (data.status !== 'ok' || !data.result) break;

      total = (data.result.pagination && data.result.pagination.total) || 0;
      var items = data.result.items || [];
      if (items.length === 0) break;

      allItems = allItems.concat(items);
      offset += items.length;

      Logger.log('Sale API: fetched ' + allItems.length + '/' + total);

      if (offset < total) Utilities.sleep(500);
    } catch (e) {
      Logger.log('Sale API error: ' + e);
      break;
    }
  }

  if (allItems.length === 0) {
    Logger.log('Sale: no items from API');
    return [];
  }

  // Filter by gender using genderCategory from API
  var genderUpper = gender === 'men' ? 'MEN' : 'WOMEN';
  var filtered = [];
  for (var i = 0; i < allItems.length; i++) {
    var gc = (allItems[i].genderCategory || '').toUpperCase();
    if (gc === genderUpper || gc === 'UNISEX') {
      filtered.push(allItems[i]);
    }
  }

  Logger.log('Sale: ' + filtered.length + ' items for ' + gender + ' (from ' + allItems.length + ' total)');

  var items = normaliseSaleApiItems(filtered, region, lang, gender);
  return items;
}

/* ============================
   FILTER MATCHING
   ============================ */

function saleItemMatchesFilter(item, filter) {
  // Gender filter
  if (filter.gender && filter.gender !== 'both') {
    if (item.gender !== filter.gender) return false;
  }

  // Size filter — only skip for items that genuinely have no standard sizing
  // (accessories with "One Size", or items with no sizes at all)
  var hasOnlyOneSize = (!item.sizes || item.sizes.length === 0);
  if (!hasOnlyOneSize && item.sizes) {
    hasOnlyOneSize = item.sizes.length === 1 && (item.sizes[0].name === 'One Size' || item.sizes[0].code === '999');
  }
  var skipSizeFilter = (item.category === 'accessories' && hasOnlyOneSize) || hasOnlyOneSize;

  if (!skipSizeFilter && filter.sizes && filter.sizes.length > 0 && item.sizes && item.sizes.length > 0) {
    var hasMatchingSize = false;
    for (var s = 0; s < item.sizes.length; s++) {
      var sc = item.sizes[s].code;
      var sn = item.sizes[s].name;
      // "One Size" always passes
      if (sn === 'One Size' || sc === '999') { hasMatchingSize = true; break; }
      // Must be in stock AND match a user size
      if (!item.sizes[s].inStock) continue;
      for (var f = 0; f < filter.sizes.length; f++) {
        var fs = filter.sizes[f];
        if (sc === fs || sn === fs || SALE_SIZE_MAP[sc] === fs || SIZE_NAMES[sc] === fs) {
          hasMatchingSize = true;
          break;
        }
      }
      if (hasMatchingSize) break;
    }
    if (!hasMatchingSize) return false;
  }

  return true;
}

/* Returns only the user's sizes that are in stock, for use in notifications.
   For accessories/one-size/unfiltered categories, returns all in-stock sizes. */
function getRelevantSizes(item, filter) {
  if (!item.sizes || item.sizes.length === 0) return [];

  var hasOnlyOneSize = (!item.sizes || item.sizes.length === 0);
  if (!hasOnlyOneSize && item.sizes) {
    hasOnlyOneSize = item.sizes.length === 1 && (item.sizes[0].name === 'One Size' || item.sizes[0].code === '999');
  }
  var skipSizeFilter = (item.category === 'accessories' && hasOnlyOneSize) || hasOnlyOneSize;
  var result = [];

  for (var s = 0; s < item.sizes.length; s++) {
    var sz = item.sizes[s];
    if (!sz.inStock) continue;

    var sc = sz.code;
    var sn = sz.name;

    // One Size — always include
    if (sn === 'One Size' || sc === '999') { result.push(sz); continue; }

    // No filter or skip filter — include all in-stock
    if (skipSizeFilter || !filter.sizes || filter.sizes.length === 0) { result.push(sz); continue; }

    // Check if this size matches user's filter
    for (var f = 0; f < filter.sizes.length; f++) {
      var fs = filter.sizes[f];
      if (sc === fs || sn === fs || SALE_SIZE_MAP[sc] === fs || SIZE_NAMES[sc] === fs) {
        result.push(sz);
        break;
      }
    }
  }
  return result;
}

function buildSizeFilters(prefs) {
  var sizes = [];
  var seen = {};
  var fields = ['size_tops', 'size_bottoms', 'size_jeans'];
  for (var f = 0; f < fields.length; f++) {
    var val = prefs[fields[f]];
    if (!val) continue;
    var arr = Array.isArray(val) ? val : [val];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && !seen[arr[i]]) {
        seen[arr[i]] = true;
        sizes.push(arr[i]);
      }
    }
  }
  return sizes;
}

/* Debug: inspect a specific product's color/price/stock data */
function debugProduct() {
  var productCode = 'E474536-000';
  var region = 'es';
  var lang = UNIQLO_LANGS[region] || 'en';
  var clientId = UNIQLO_CLIENTS[region] || 'uq.' + region + '.web-spa';

  Logger.log('=== DEBUG PRODUCT ' + productCode + ' ===');

  // 1. Fetch from listing API (what normaliseSaleApiItems sees)
  var listUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang +
    '/products?offset=0&limit=10&httpFailure=true&productIds=' + productCode;
  try {
    var lr = UrlFetchApp.fetch(listUrl, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
        'Referer': 'https://www.uniqlo.com/' + region + '/', 'x-fr-clientid': clientId }
    });
    if (lr.getResponseCode() === 200) {
      var ld = JSON.parse(lr.getContentText());
      if (ld.result && ld.result.items && ld.result.items[0]) {
        var item = ld.result.items[0];
        Logger.log('Listing API name: ' + item.name);
        Logger.log('Listing API colors:');
        if (item.colors) {
          for (var c = 0; c < item.colors.length; c++) {
            Logger.log('  code=' + item.colors[c].displayCode + ' name=' + (item.colors[c].name || 'NO NAME'));
          }
        }
        Logger.log('Listing API prices: base=' + (item.prices && item.prices.base ? item.prices.base.value : '?') +
          ' promo=' + (item.prices && item.prices.promo ? item.prices.promo.value : 'none'));
      }
    }
  } catch (e) { Logger.log('Listing API error: ' + e); }

  // 2. Fetch l2s API for BOTH price groups (00 and 01)
  var priceGroups = ['00', '01'];
  for (var pg = 0; pg < priceGroups.length; pg++) {
    var apiUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang +
      '/products/' + productCode + '/price-groups/' + priceGroups[pg] + '/l2s?withPrices=true&withStocks=true&httpFailure=true';
    Logger.log('\n--- Price Group ' + priceGroups[pg] + ' ---');
    try {
      var r = UrlFetchApp.fetch(apiUrl, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
          'Referer': 'https://www.uniqlo.com/' + region + '/', 'x-fr-clientid': clientId }
      });
      if (r.getResponseCode() === 200) {
        var data = JSON.parse(r.getContentText());
        if (data.status === 'ok' && data.result) {
          var l2s = data.result.l2s || [];
          var prices = data.result.prices || {};
          var stocks = data.result.stocks || {};

          Logger.log('l2s entries: ' + l2s.length);
          var colorInfo = {};
          for (var j = 0; j < l2s.length; j++) {
            var l2 = l2s[j];
            var cc = l2.color ? l2.color.displayCode : '?';
            var sc = l2.size ? l2.size.displayCode : '?';
            var cn = l2.color ? l2.color.name : '';
            var pr = prices[l2.l2Id];
            var st = stocks[l2.l2Id];
            var base = (pr && pr.base) ? pr.base.value : 0;
            var promo = (pr && pr.promo) ? pr.promo.value : 0;
            var inStock = st ? st.statusCode !== 'STOCK_OUT' : false;
            var onSale = promo > 0 && promo < base;

            if (!colorInfo[cc]) colorInfo[cc] = { name: cn, sizes: [], onSale: false };
            if (cn && !colorInfo[cc].name) colorInfo[cc].name = cn;
            colorInfo[cc].sizes.push({ size: sc, base: base, promo: promo, onSale: onSale, inStock: inStock });
            if (onSale) colorInfo[cc].onSale = true;
          }

          var colorKeys = Object.keys(colorInfo);
          for (var k = 0; k < colorKeys.length; k++) {
            var ci = colorInfo[colorKeys[k]];
            Logger.log('Color ' + colorKeys[k] + ' (' + (ci.name || 'NO NAME') + ') — onSale: ' + ci.onSale);
            for (var s = 0; s < ci.sizes.length; s++) {
              var sz = ci.sizes[s];
              Logger.log('  size=' + sz.size + ' base=' + sz.base + ' promo=' + sz.promo + ' onSale=' + sz.onSale + ' inStock=' + sz.inStock);
            }
          }
        } else {
          Logger.log('API status not ok or no result');
        }
      } else {
        Logger.log('HTTP ' + r.getResponseCode());
      }
    } catch (e) { Logger.log('l2s API error: ' + e); }
  }

  Logger.log('\n=== DONE ===');
}
function debugSaleFilter() {
  var subscribers = getSaleSubscribers();
  if (subscribers.length === 0) { Logger.log('No subscribers'); return; }
  
  var sub = subscribers[0];
  var prefs = sub.salePrefs;
  Logger.log('=== SALE FILTER DEBUG ===');
  Logger.log('Prefs: ' + JSON.stringify(prefs));
  
  var filterSizes = buildSizeFilters(prefs);
  Logger.log('Filter sizes: ' + JSON.stringify(filterSizes));
  
  var region = prefs.region || sub.region || 'es';
  var gender = prefs.gender || 'men';
  Logger.log('Region: ' + region + ' Gender: ' + gender);
  
  var items = fetchSalePageProducts(region, gender);
  Logger.log('Total sale items: ' + items.length);
  
  if (items.length === 0) return;
  
  // Enrich first 3 with stock
  var testItems = items.slice(0, 3);
  enrichWithStock(testItems, region);
  
  var filter = {
    gender: gender,
    categories: prefs.categories || [],
    sizes: filterSizes,
    minDiscount: 0
  };
  
  for (var i = 0; i < testItems.length; i++) {
    var item = testItems[i];
    Logger.log('');
    Logger.log('--- Item: ' + item.name + ' (cat: ' + item.category + ') ---');
    Logger.log('Sizes from API:');
    for (var s = 0; s < item.sizes.length; s++) {
      var sz = item.sizes[s];
      Logger.log('  code=' + sz.code + ' name=' + sz.name + ' inStock=' + sz.inStock);
    }
    
    var matches = saleItemMatchesFilter(item, filter);
    Logger.log('Matches filter: ' + matches);
    
    var relevant = getRelevantSizes(item, filter);
    var relNames = relevant.map(function(r) { return r.name; });
    Logger.log('Relevant sizes: ' + JSON.stringify(relNames));
  }
  
  Logger.log('=== DONE ===');
}

/* Test: sends a real sale notification to your Telegram using the first matching item */
function testSaleNotification() {
  var subscribers = getSaleSubscribers();
  if (subscribers.length === 0) { Logger.log('No subscribers'); return; }
  
  var sub = subscribers[0];
  var prefs = sub.salePrefs;
  var region = prefs.region || sub.region || 'es';
  var gender = prefs.gender || 'men';
  var filterSizes = buildSizeFilters(prefs);
  var filter = { gender: gender, categories: prefs.categories || [], sizes: filterSizes, minDiscount: 0 };
  
  var items = fetchSalePageProducts(region, gender);
  if (items.length === 0) { Logger.log('No sale items found'); return; }
  
  enrichWithStock(items.slice(0, 10), region);
  var matching = [];
  for (var i = 0; i < Math.min(items.length, 10); i++) {
    if (saleItemMatchesFilter(items[i], filter)) matching.push(items[i]);
  }
  if (matching.length === 0) { Logger.log('No matching items in first 10'); return; }

  // Digest header
  var today = new Date();
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var dateStr = today.getDate() + ' ' + months[today.getMonth()];
  var gLabel = gender === 'women' ? "Women's" : "Men's";
  sendMessage(sub.chat_id, '🏷 *Uniqlo ' + gLabel + ' Sale Update — ' + dateStr + '*\n\n' +
    matching.length + ' new item' + (matching.length > 1 ? 's' : '') + ' in your size');
  Utilities.sleep(300);

  for (var m = 0; m < matching.length; m++) {
    Logger.log('Sending test alert for: ' + matching[m].name);
    sendSaleAlert(sub.chat_id, matching[m], filter);
    Utilities.sleep(300);
  }
  Logger.log('Done — check Telegram');
}
/* ============================
   STOCK CHECK — for new sale items
   ============================ */

function enrichWithStock(items, region) {
  if (!items || items.length === 0) return items;
  
  var lang = UNIQLO_LANGS[region] || 'en';
  var clientId = UNIQLO_CLIENTS[region] || 'uq.' + region + '.web-spa';
  
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var sizeStock = {};
    var colorStock = {};
    var colorNames = {};
    var colorOnSale = {};

    // Pull color names from listing API data first
    if (item.colors) {
      for (var c = 0; c < item.colors.length; c++) {
        if (item.colors[c].code && item.colors[c].name) {
          colorNames[item.colors[c].code] = cleanColorName(item.colors[c].name);
        }
      }
    }

    // Check both price groups — sale colors often live in group 01
    var priceGroups = ['00', '01'];
    for (var pg = 0; pg < priceGroups.length; pg++) {
      var apiUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang +
        '/products/' + item.productCode + '/price-groups/' + priceGroups[pg] + '/l2s?withPrices=true&withStocks=true&httpFailure=true';
      
      try {
        var r = UrlFetchApp.fetch(apiUrl, {
          muteHttpExceptions: true,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
            'Referer': 'https://www.uniqlo.com/' + region + '/',
            'x-fr-clientid': clientId
          }
        });
        
        if (r.getResponseCode() === 200) {
          var data = JSON.parse(r.getContentText());
          if (data.status === 'ok' && data.result) {
            var stocks = data.result.stocks || {};
            var prices = data.result.prices || {};
            var l2s = data.result.l2s || [];

            for (var j = 0; j < l2s.length; j++) {
              var l2 = l2s[j];
              var sc = l2.size ? l2.size.displayCode : '';
              var cc = l2.color ? l2.color.displayCode : '';
              var st = stocks[l2.l2Id];
              var pr = prices[l2.l2Id];
              var inStock = st ? st.statusCode !== 'STOCK_OUT' : false;
              
              if (sc) {
                if (!sizeStock[sc] || inStock) sizeStock[sc] = inStock;
              }
              if (cc && sc) {
                if (!colorStock[cc]) colorStock[cc] = {};
                colorStock[cc][sc] = inStock;
              }
              if (cc && l2.color && l2.color.name && !colorNames[cc]) {
                colorNames[cc] = cleanColorName(l2.color.name);
              }
              if (cc && pr) {
                var base = (pr.base && pr.base.value) || 0;
                var promo = (pr.promo && pr.promo.value) || 0;
                if (promo > 0 && promo < base) {
                  colorOnSale[cc] = true;
                }
              }
            }
          }
        }
      } catch (e) {
        Logger.log('Stock check failed for ' + item.productCode + ' pg' + priceGroups[pg] + ': ' + e);
      }
      Utilities.sleep(150);
    }

    // Update item size stock
    for (var s = 0; s < item.sizes.length; s++) {
      var code = item.sizes[s].code;
      if (sizeStock[code] !== undefined) {
        item.sizes[s].inStock = sizeStock[code];
      }
    }
    item.colorStock = colorStock;
    item.colorNames = colorNames;
    item.colorOnSale = colorOnSale;
  }
  return items;
}

/* Strip leading number code from color names like "62 BLUE" → "Blue" */
function cleanColorName(name) {
  if (!name) return '';
  var cleaned = name.replace(/^\d+\s+/, '');
  // Title case
  return cleaned.charAt(0).toUpperCase() + cleaned.substring(1).toLowerCase();
}

/* ============================
   MAIN CHECKER — called by trigger
   ============================ */
/* ============================
   MAIN CHECKER — called by trigger
   ============================ */

function checkUniqloSales() {
  var startTime = Date.now();
  Logger.log('=== UNIQLO SALES CHECK ===');

  var subscribers = getSaleSubscribers();
  if (subscribers.length === 0) {
    Logger.log('No sale alert subscribers');
    return;
  }
  Logger.log('Subscribers: ' + subscribers.length);

  // Group by region+gender to minimise fetches
  var fetchGroups = {};
  for (var i = 0; i < subscribers.length; i++) {
    var sub = subscribers[i];
    var prefs = sub.salePrefs;
    var region = prefs.region || sub.region || 'es';
    var genders = [];
    if (!prefs.gender || prefs.gender === 'both') genders = ['men', 'women'];
    else genders = [prefs.gender];

    for (var g = 0; g < genders.length; g++) {
      var key = region + '_' + genders[g];
      if (!fetchGroups[key]) fetchGroups[key] = { region: region, gender: genders[g], subscribers: [] };
      fetchGroups[key].subscribers.push(sub);
    }
  }

  var groupKeys = Object.keys(fetchGroups);
  for (var k = 0; k < groupKeys.length; k++) {
    if (Date.now() - startTime > 300000) {
      Logger.log('⚠️ Time limit reached');
      break;
    }

    var group = fetchGroups[groupKeys[k]];
    Logger.log('Fetching: ' + group.region + '/' + group.gender);

    Utilities.sleep(1500);
    var items = fetchSalePageProducts(group.region, group.gender);
    if (!items || items.length === 0) {
      Logger.log('No items found for ' + groupKeys[k]);
      continue;
    }

    // Get previously seen items
    var cacheKey = 'sale_' + group.region + '_' + group.gender;
    var seenCodes = getSaleCache(cacheKey);
    Logger.log('Previously seen: ' + Object.keys(seenCodes).length + ' | Current: ' + items.length);

    // Find NEW items
    var newItems = [];
    var allCodes = {};
    for (var i = 0; i < items.length; i++) {
      allCodes[items[i].productCode] = true;
      if (!seenCodes[items[i].productCode]) {
        newItems.push(items[i]);
      }
    }

    Logger.log('New items: ' + newItems.length);

    // Update cache
    setSaleCache(cacheKey, allCodes);

    // First run — skip notifications
    if (Object.keys(seenCodes).length === 0 && newItems.length > 0) {
      Logger.log('First run for ' + groupKeys[k] + ' — caching ' + items.length + ' items silently');
      continue;
    }

        if (newItems.length === 0) continue;

    // Enrich new items with stock
    Logger.log('Checking stock for ' + newItems.length + ' new items...');
    enrichWithStock(newItems, group.region);

    // Notify each subscriber about matching new items
    for (var s = 0; s < group.subscribers.length; s++) {
      var sub = group.subscribers[s];
      var prefs = sub.salePrefs;

      var filter = {
        gender: group.gender,
        categories: prefs.categories || [],
        sizes: buildSizeFilters(prefs),
        minDiscount: 0
      };

      var matching = [];
      for (var n = 0; n < newItems.length; n++) {
        if (saleItemMatchesFilter(newItems[n], filter)) matching.push(newItems[n]);
      }

      if (matching.length === 0) continue;

      Logger.log('Sending digest + ' + matching.length + ' alerts to ' + sub.chat_id);

      // Send daily digest header
      var today = new Date();
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var dateStr = today.getDate() + ' ' + months[today.getMonth()];
      var gLabel = group.gender === 'women' ? "Women's" : "Men's";
      var digestText = '🏷 *Uniqlo ' + gLabel + ' Sale Update — ' + dateStr + '*\n\n' +
        matching.length + ' new item' + (matching.length > 1 ? 's' : '') + ' in your size';
      sendMessage(sub.chat_id, digestText);
      Utilities.sleep(300);

      // Send individual item cards
      for (var m = 0; m < matching.length; m++) {
        sendSaleAlert(sub.chat_id, matching[m], filter);
        Utilities.sleep(300);
      }
    }
  }

  Logger.log('=== SALES CHECK DONE (' + Math.round((Date.now() - startTime) / 1000) + 's) ===');
}

/* ============================
   NOTIFICATIONS
   ============================ */

function sendSaleAlert(chatId, item, filter) {
  var s = item.currencySymbol || '€';
  var text = '🏷 *NEW ON SALE*\n\n' +
    '*' + item.name + '*\n' +
    'Was: ' + s + item.basePrice.toFixed(2) + '\n' +
    '*Now: ' + s + item.salePrice.toFixed(2) + '* (-' + item.discount + '%)\n';

  var hasColorBreakdown = item.colorStock && Object.keys(item.colorStock).length > 0 && filter;
  var firstOnSaleColor = ''; // for the URL

  if (hasColorBreakdown) {
    var filterSizes = filter.sizes || [];
    var cNames = item.colorNames || {};
    var onSale = item.colorOnSale || {};

    // Build size → colors matrix, only for colors actually on sale
    var sizeColorMap = {};
    var colorCodes = Object.keys(item.colorStock);
    for (var ci = 0; ci < colorCodes.length; ci++) {
      var cc = colorCodes[ci];
      // Skip colors not on sale (if we have per-color sale data)
      if (Object.keys(onSale).length > 0 && !onSale[cc]) continue;
      if (!firstOnSaleColor) firstOnSaleColor = cc;

      var colorName = cNames[cc] || cc;
      var sizesForColor = item.colorStock[cc];
      var sizeCodes = Object.keys(sizesForColor);
      for (var si = 0; si < sizeCodes.length; si++) {
        var sc = sizeCodes[si];
        if (!sizesForColor[sc]) continue;
        var sizeName = SALE_SIZE_MAP[sc] || SIZE_NAMES[sc] || sc;
        var matchesFilter = (filterSizes.length === 0);
        if (!matchesFilter) {
          for (var f = 0; f < filterSizes.length; f++) {
            if (sc === filterSizes[f] || sizeName === filterSizes[f]) { matchesFilter = true; break; }
          }
        }
        if (matchesFilter) {
          if (!sizeColorMap[sizeName]) sizeColorMap[sizeName] = [];
          if (sizeColorMap[sizeName].indexOf(colorName) === -1) sizeColorMap[sizeName].push(colorName);
        }
      }
    }

    var sizeKeys = Object.keys(sizeColorMap);
    if (sizeKeys.length > 0) {
      text += '\n';
      for (var sk = 0; sk < sizeKeys.length; sk++) {
        text += '*' + sizeKeys[sk] + '* — ' + sizeColorMap[sizeKeys[sk]].join(', ') + '\n';
      }
    }
  } else {
    var relevant = filter ? getRelevantSizes(item, filter) : [];
    if (relevant.length > 0) {
      var names = [];
      for (var i = 0; i < relevant.length; i++) names.push(relevant[i].name);
      text += '✅ ' + names.join(', ') + '\n';
    }
  }

  // Build URL with color parameter if available
  var url = item.url || '';
  if (firstOnSaleColor) {
    // Fix price group in URL — sale colors may be in /01 not /00
    url = url.replace('/00', '/01');
    if (url.indexOf('colorDisplayCode') === -1) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'colorDisplayCode=' + firstOnSaleColor;
    }
  }

  text += '\n[View on Uniqlo](' + url + ')';

  try {
    if (item.image) {
      sendPhoto(chatId, item.image, text);
    } else {
      sendMessage(chatId, text);
    }
  } catch (e) {
    Logger.log('Sale alert failed for ' + chatId + ': ' + e);
    try { sendMessage(chatId, text); } catch (e2) {}
  }
}

function sendSaleSummary(chatId, items, gender, region) {
  var gLabel = gender === 'women' ? "Women's" : "Men's";
  var text = '🔴 *' + items.length + ' new ' + gLabel + ' items on sale!*\n\n';

  var byCat = {};
  for (var i = 0; i < items.length; i++) {
    var cat = items[i].category || 'other';
    if (!byCat[cat]) byCat[cat] = 0;
    byCat[cat]++;
  }
  var catKeys = Object.keys(byCat);
  for (var c = 0; c < catKeys.length; c++) {
    var catLabel = catKeys[c].charAt(0).toUpperCase() + catKeys[c].substring(1);
    text += '• ' + catLabel + ': ' + byCat[catKeys[c]] + '\n';
  }

  var lang = UNIQLO_LANGS[region] || 'en';
  text += '\n[Browse all sale items](https://www.uniqlo.com/' + region + '/' + lang + '/feature/sale/' + gender + ')';

  sendMessage(chatId, text);
}

/* ============================
   SALE CACHE (in Config sheet)
   ============================ */

function getSaleCache(key) {
  var raw = getConfig(key);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function setSaleCache(key, codesObj) {
  setConfig(key, JSON.stringify(codesObj));
}

/* ============================
   SUBSCRIBER MANAGEMENT
   ============================ */

function getSaleSubscribers() {
  var s = getSheet('Users'), d = s.getDataRange().getValues(), h = d[0];
  var subscribers = [];
  var saleIdx = getColumnIndex(h, 'sale_alerts');
  var salePrefsIdx = getColumnIndex(h, 'sale_prefs');
  if (saleIdx === -1) return [];

  for (var i = 1; i < d.length; i++) {
    if (d[i][saleIdx] === 'on' || d[i][saleIdx] === true || d[i][saleIdx] === 'TRUE') {
      var user = {};
      for (var j = 0; j < h.length; j++) user[h[j]] = d[i][j];

      var prefs = {};
      if (salePrefsIdx !== -1 && d[i][salePrefsIdx]) {
        try { prefs = JSON.parse(d[i][salePrefsIdx]); } catch (e) {}
      }
      user.salePrefs = prefs;
      subscribers.push(user);
    }
  }
  return subscribers;
}

function setSaleAlerts(chatId, enabled, prefs) {
  var s = getSheet('Users'), d = s.getDataRange().getValues(), h = d[0];
  var cidIdx = getColumnIndex(h, 'chat_id');
  var saleIdx = getColumnIndex(h, 'sale_alerts');
  var prefsIdx = getColumnIndex(h, 'sale_prefs');

  if (saleIdx === -1 || prefsIdx === -1) return false;

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][cidIdx]) === String(chatId)) {
      s.getRange(i + 1, saleIdx + 1).setValue(enabled ? 'on' : 'off');
      if (prefs) s.getRange(i + 1, prefsIdx + 1).setValue(JSON.stringify(prefs));
      return true;
    }
  }
  return false;
}

function getSaleAlertSettings(chatId) {
  var s = getSheet('Users'), d = s.getDataRange().getValues(), h = d[0];
  var cidIdx = getColumnIndex(h, 'chat_id');
  var saleIdx = getColumnIndex(h, 'sale_alerts');
  var prefsIdx = getColumnIndex(h, 'sale_prefs');

  if (saleIdx === -1) return { enabled: false, prefs: {} };

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][cidIdx]) === String(chatId)) {
      var enabled = d[i][saleIdx] === 'on' || d[i][saleIdx] === true || d[i][saleIdx] === 'TRUE';
      var prefs = {};
      if (prefsIdx !== -1 && d[i][prefsIdx]) {
        try { prefs = JSON.parse(d[i][prefsIdx]); } catch (e) {}
      }
      return { enabled: enabled, prefs: prefs };
    }
  }
  return { enabled: false, prefs: {} };
}