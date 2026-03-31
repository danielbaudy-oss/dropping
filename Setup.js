/* ============================
   ONE-TIME SETUP (run once)
   ============================ */

function install() {
  getSheet('Config');
  getSheet('Users');
  getSheet('Products');
  getSheet('PriceHistory');
  getSheet('Notifications');
  migrateProductsSheet();
  migrateUsersSheet();
  Logger.log('✅ Sheets created!');
  Logger.log('👉 Add bot_token to Config sheet');
  Logger.log('👉 Then run setupSchedule()');
}

function setupSchedule() {
  var triggers = ScriptApp.getProjectTriggers();
  var toRemove = ['checkAllPrices', 'checkUniqlo', 'checkArket', 'checkCos', 'checkMango', 'checkUniqloSales'];
  for (var i = 0; i < triggers.length; i++) {
    if (toRemove.indexOf(triggers[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('checkUniqlo')
    .timeBased().everyDays(1).atHour(7).create();

  ScriptApp.newTrigger('checkArket')
    .timeBased().everyDays(1).atHour(7).nearMinute(15).create();
  ScriptApp.newTrigger('checkArket')
    .timeBased().everyDays(1).atHour(13).nearMinute(15).create();
  ScriptApp.newTrigger('checkArket')
    .timeBased().everyDays(1).atHour(20).nearMinute(15).create();

  ScriptApp.newTrigger('checkCos')
    .timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  ScriptApp.newTrigger('checkCos')
    .timeBased().everyDays(1).atHour(13).nearMinute(30).create();
  ScriptApp.newTrigger('checkCos')
    .timeBased().everyDays(1).atHour(20).nearMinute(30).create();

  ScriptApp.newTrigger('checkMango')
    .timeBased().everyDays(1).atHour(7).nearMinute(45).create();
  ScriptApp.newTrigger('checkMango')
    .timeBased().everyDays(1).atHour(13).nearMinute(45).create();
  ScriptApp.newTrigger('checkMango')
    .timeBased().everyDays(1).atHour(20).nearMinute(45).create();

  Logger.log('✅ Scheduled:');
  Logger.log('   Uniqlo: 7:00 (1x daily)');
  Logger.log('   ARKET:  7:15, 13:15, 20:15 (3x daily)');
  Logger.log('   COS:    7:30, 13:30, 20:30 (3x daily)');
  Logger.log('   Mango:  7:45, 13:45, 20:45 (3x daily)');

    ScriptApp.newTrigger('checkUniqloSales')
    .timeBased().everyDays(1).atHour(8).create();

  Logger.log('   Uniqlo Sales: 8:00 (1x daily)');
}

/* ============================
   DIAGNOSTICS
   ============================ */

function removeOldWebhook() {
  var token = getConfig('bot_token');
  if (!token) { Logger.log('No token'); return; }
  var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook?drop_pending_updates=true');
  Logger.log('Webhook removed: ' + r.getContentText());
}

function healthCheck() {
  Logger.log('=== HEALTH CHECK ===');
  
  var token = getConfig('bot_token');
  if (token) {
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe');
    var result = JSON.parse(r.getContentText());
    if (result.ok) Logger.log('✅ Bot: @' + result.result.username);
    else Logger.log('❌ Invalid token');
  } else {
    Logger.log('❌ No bot_token in Config sheet');
  }
  
  if (token) {
    var wh = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo');
    var whResult = JSON.parse(wh.getContentText());
    if (whResult.result.url) {
      Logger.log('⚠️ Webhook still active: ' + whResult.result.url);
    } else {
      Logger.log('✅ No webhook (correct)');
    }
  }
  
  var sheets = ['Config', 'Users', 'Products', 'PriceHistory', 'Notifications'];
  for (var i = 0; i < sheets.length; i++) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheets[i]);
    Logger.log(sheet ? '✅ ' + sheets[i] + ': ' + Math.max(0, sheet.getLastRow() - 1) + ' rows' : '❌ ' + sheets[i] + ' MISSING');
  }
  
  var prodSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Products');
  if (prodSheet) {
    var headers = prodSheet.getRange(1, 1, 1, prodSheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('store') !== -1) Logger.log('✅ Products sheet has store column');
    else Logger.log('⚠️ Products sheet missing store column — run migrateProductsSheet()');
  }
  
  var triggers = ScriptApp.getProjectTriggers();
  var hasSchedule = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkAllPrices') hasSchedule = true;
  }
  Logger.log(hasSchedule ? '✅ Price check trigger active' : '❌ No trigger — run setupSchedule()');
  
  Logger.log('🔍 Testing Uniqlo API...');
  var p = fetchUniqloProduct('E484508-000', 'es', '00', '00');
  if (p) Logger.log('✅ Uniqlo: "' + p.name + '" — €' + p.currentPrice);
  else Logger.log('⚠️ Uniqlo API failed');
  
  Logger.log('🔍 Testing ARKET...');
  testArketFetch();
  
  Logger.log('=== DONE ===');
}

/* ============================
   ARKET DEBUG FUNCTIONS
   ============================ */

function testArketFetch() {
  var url = 'https://www.arket.com/en-gb/product/midweight-t-shirt-white-0527611001/';
  Logger.log('=== ARKET FETCH TEST ===');
  Logger.log('URL: ' + url);
  
  var parsed = parseArketUrl(url);
  Logger.log('Parsed: ' + JSON.stringify(parsed));
  
  var product = fetchArketProductFromUrl(url);
  if (product) {
    Logger.log('✅ Name: ' + product.name);
    Logger.log('✅ Price: ' + product.currencySymbol + product.currentPrice);
    Logger.log('✅ Colors: ' + product.colors.length);
    Logger.log('✅ Sizes: ' + product.sizes.length);
    for (var i = 0; i < Math.min(product.colors.length, 5); i++) {
      var c = product.colors[i];
      Logger.log('  Color: ' + c.name + ' (' + c.code + ') — ' + c.sizes.length + ' sizes, image: ' + (c.image ? 'yes' : 'no'));
    }
  } else {
    Logger.log('❌ Product fetch returned null');
  }
}

function testArketHtmlDebug() {
  Logger.log('=== ARKET HTML DEBUG ===');
  
  var url = 'https://www.arket.com/en-gb/product/midweight-t-shirt-white-0527611001/';
  var html = fetchArketHtml(url);
  
  if (!html) {
    Logger.log('❌ Could not fetch HTML');
    return;
  }
  
  Logger.log('HTML length: ' + html.length);
  Logger.log('Has __NEXT_DATA__: ' + (html.indexOf('__NEXT_DATA__') !== -1));
  Logger.log('Has JSON-LD: ' + (html.indexOf('application/ld+json') !== -1));
  Logger.log('Has og:title: ' + (html.indexOf('og:title') !== -1));
  Logger.log('Has product:price: ' + (html.indexOf('product:price') !== -1));
  
  var buildId = extractBuildId(html);
  Logger.log('Build ID from HTML: ' + (buildId || 'NOT FOUND'));
  
  // Show title
  var title = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (title) Logger.log('Page title: ' + title[1]);
  
  // Check if it's a bot challenge page
  if (html.indexOf('challenge') !== -1 || html.indexOf('captcha') !== -1 || html.length < 5000) {
    Logger.log('⚠️ Possible bot challenge page detected');
    Logger.log('First 1000 chars: ' + html.substring(0, 1000));
  }
  
  // Show relevant meta tags
  var metas = html.match(/<meta[^>]*(?:og:|product:)[^>]*>/gi);
  if (metas) {
    Logger.log('Meta tags found: ' + metas.length);
    for (var i = 0; i < Math.min(metas.length, 10); i++) Logger.log('  ' + metas[i]);
  }
}

/* ============================
   TESTING
   ============================ */

function testPriceDrop() {
  var products = getAllActiveProducts();
  if (products.length === 0) { Logger.log('No products to test'); return; }
  
  var p = products[0];
  var oldPrice = parseFloat(p.last_price);
  var fakeNewPrice = Math.round(oldPrice * 0.75 * 100) / 100;
  var lowestPrice = Math.min(parseFloat(p.lowest_price) || 9999, fakeNewPrice);
  
  Logger.log('Simulating drop for: ' + p.name + ' (store: ' + (p.store || 'uniqlo') + ')');
  Logger.log('Old: ' + oldPrice + ' → Fake new: ' + fakeNewPrice);
  
  sendDrop(p, oldPrice, fakeNewPrice, lowestPrice);
  Logger.log('Done! Check Telegram.');
}

function testPriceCheck() {
  checkAllPrices();
}
function testArketBuildId() {
  Logger.log('=== ARKET BUILD ID TEST ===');
  clearCachedBuildId();
  
  var buildId = getArketBuildId();
  if (buildId) {
    Logger.log('✅ Build ID: ' + buildId);
    
    Logger.log('Testing _next/data endpoint...');
    var pp = fetchArketNextDataJson(buildId, 'en-gb', 'midweight-t-shirt-white-0527611001');
    if (pp) {
      Logger.log('✅ _next/data returned JSON');
      try { Logger.log('  Keys: ' + Object.keys(pp).join(', ')); } catch(e) {}
      
      var found = findProductInPageProps(pp);
      if (found) {
        Logger.log('✅ Product: ' + (found.product.name || 'unnamed'));
        Logger.log('  Price: ' + (found.product.priceAsNumber || '?'));
        Logger.log('  SKU: ' + (found.product.sku || '?'));
        Logger.log('  Items: ' + ((found.product.items || []).length));
      } else {
        Logger.log('❌ No product in pageProps');
        try { Logger.log('  Preview: ' + JSON.stringify(pp).substring(0, 1500)); } catch(e) {}
      }
    } else {
      Logger.log('❌ _next/data returned null');
    }
  } else {
    Logger.log('❌ Could not get build ID');
  }
}

function testArketFullFetch() {
  var url = 'https://www.arket.com/en-gb/product/midweight-t-shirt-white-0527611001/';
  Logger.log('=== ARKET FULL FETCH TEST ===');
  
  var product = fetchArketProductFromUrl(url);
  if (product) {
    Logger.log('✅ Name: ' + product.name);
    Logger.log('✅ Price: ' + product.currencySymbol + product.currentPrice);
    Logger.log('✅ Colors: ' + product.colors.length);
    Logger.log('✅ Sizes: ' + product.sizes.length);
    Logger.log('✅ Image: ' + (product.mainImage ? 'yes' : 'no'));
    for (var i = 0; i < Math.min(product.colors.length, 5); i++) {
      var c = product.colors[i];
      Logger.log('  Color: ' + c.name + ' (' + c.code + ') — ' + c.sizes.length + ' sizes');
    }
  } else {
    Logger.log('❌ Fetch returned null — check execution log above for details');
  }
}

function testArketUAs() {
  Logger.log('=== TESTING WHICH USER AGENTS WORK ===');
  var url = 'https://www.arket.com/en-gb/';
  
  for (var i = 0; i < ARKET_USER_AGENTS.length; i++) {
    try {
      var r = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': ARKET_USER_AGENTS[i],
          'Accept': 'text/html',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });
      var code = r.getResponseCode();
      var len = r.getContentText().length;
      Logger.log('UA ' + i + ': HTTP ' + code + ', ' + len + ' chars — ' + ARKET_USER_AGENTS[i].substring(0, 60));
    } catch(e) {
      Logger.log('UA ' + i + ': ERROR — ' + e.message);
    }
  }
}
function setupCleanup() {
  ScriptApp.newTrigger('cleanupOldHistory')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
  Logger.log('✅ Cleanup scheduled every Sunday at 3am');
}
/* ============================
   TESTING PRICE DROPS
   ============================ */

// Test 1: Simulate a fake price drop on your first product
// Sends a real Telegram message but doesn't change the sheet
function testFakeDrop() {
  var products = getAllActiveProducts();
  if (products.length === 0) { Logger.log('❌ No products to test'); return; }

  var p = products[0];
  var oldPrice = parseFloat(p.last_price);
  var fakeNewPrice = Math.round(oldPrice * 0.75 * 100) / 100;
  var lowestPrice = Math.min(parseFloat(p.lowest_price) || 9999, fakeNewPrice);

  Logger.log('📧 Simulating drop for: ' + p.name + ' (' + p.store + ')');
  Logger.log('   Old: ' + oldPrice + ' → Fake new: ' + fakeNewPrice);

  sendDrop(p, oldPrice, fakeNewPrice, lowestPrice);
  Logger.log('✅ Check Telegram — message should have arrived');
}

// Test 2: Run a real price check on ONE product and log everything
function testSingleProduct() {
  var products = getAllActiveProducts();
  if (products.length === 0) { Logger.log('❌ No products'); return; }

  var p = products[0];
  var store = p.store || 'uniqlo';
  Logger.log('=== SINGLE PRODUCT TEST ===');
  Logger.log('Product: ' + p.name);
  Logger.log('Store: ' + store);
  Logger.log('Code: ' + p.product_code);
  Logger.log('Color: ' + p.color_code + ' | Size: ' + p.size_code);
  Logger.log('Current sheet price: ' + p.last_price);
  Logger.log('Lowest: ' + p.lowest_price);
  Logger.log('Target: ' + (p.target_price || 'none'));

  var pr = null;
  if (store === 'arket') {
    pr = fetchArketCurrentPrice(p.product_url);
  } else if (store === 'cos') {
    pr = fetchCosCurrentPrice(p.product_url);
  } else {
    pr = fetchCurrentPrice(p.product_code, p.region, '00');
  }

  if (!pr) {
    Logger.log('❌ Could not fetch price data');
    return;
  }

  Logger.log('✅ API returned: currentPrice=' + pr.currentPrice + ' onSale=' + pr.onSale);
  Logger.log('   Colors returned: ' + (pr.colors ? pr.colors.length : 0));

  var skuInfo = null;
  if (store === 'arket') {
    skuInfo = getArketSkuInfo(pr, p.color_code, p.size_code);
  } else if (store === 'cos') {
    skuInfo = getCosSkuInfo(pr, p.color_code, p.size_code);
  } else {
    skuInfo = getSkuInfo(pr, p.color_code, p.size_code);
  }

  if (skuInfo) {
    Logger.log('✅ SKU match: price=' + skuInfo.price + ' inStock=' + skuInfo.inStock);
  } else {
    Logger.log('⚠️ No SKU match for color=' + p.color_code + ' size=' + p.size_code);
    Logger.log('   Using product-level price: ' + pr.currentPrice);
  }

  var np = skuInfo ? skuInfo.price : pr.currentPrice;
  var op = parseFloat(p.last_price);
  var lp = Math.min(parseFloat(p.lowest_price) || 9999, np);

  Logger.log('');
  Logger.log('=== RESULT ===');
  Logger.log('Sheet price: ' + op);
  Logger.log('Live price:  ' + np);
  Logger.log('Lowest:      ' + lp);

  if (np < op) {
    Logger.log('🔴 PRICE DROPPED by ' + Math.round((1 - np / op) * 100) + '%');
    var hasTarget = p.target_price && parseFloat(p.target_price) > 0;
    var meetsTarget = !hasTarget || np <= parseFloat(p.target_price);
    Logger.log('   Meets target: ' + meetsTarget);
    Logger.log('   Would send notification: ' + (meetsTarget ? 'YES' : 'NO (above target)'));
  } else if (np > op) {
    Logger.log('🔵 Price went UP: ' + op + ' → ' + np);
  } else {
    Logger.log('⚪ Price unchanged');
  }

  Logger.log('=== DONE ===');
}

// Test 3: Force a real drop by temporarily setting a high price, then checking
// WARNING: This WILL modify the sheet and send a real Telegram notification
function testRealDrop() {
  var products = getAllActiveProducts();
  if (products.length === 0) { Logger.log('❌ No products'); return; }

  var p = products[0];
  var store = p.store || 'uniqlo';
  var realPrice = parseFloat(p.last_price);

  Logger.log('=== REAL DROP TEST ===');
  Logger.log('Product: ' + p.name);

  // Fetch current live price
  var pr = null;
  if (store === 'arket') pr = fetchArketCurrentPrice(p.product_url);
  else if (store === 'cos') pr = fetchCosCurrentPrice(p.product_url);
  else pr = fetchCurrentPrice(p.product_code, p.region, '00');

  if (!pr) { Logger.log('❌ Could not fetch price'); return; }

  var livePrice = pr.currentPrice;
  var fakeHighPrice = livePrice * 1.5;

  Logger.log('Live price: ' + livePrice);
  Logger.log('Setting sheet price to fake high: ' + fakeHighPrice);

  // Set price artificially high so next check triggers a "drop"
  updateProductPriceById(p.id, fakeHighPrice, parseFloat(p.lowest_price));

  Logger.log('Now running price check for ' + store + '...');
  Logger.log('This should detect a drop from ' + fakeHighPrice + ' to ' + livePrice);

  // Run the check for just this store
  checkByStore(store);

  Logger.log('✅ Check Telegram for the notification');
  Logger.log('Sheet should now show: ' + livePrice);
  Logger.log('=== DONE ===');
}

// Test 4: Verify all products can be fetched (dry run, no changes)
function testAllFetches() {
  var all = getAllActiveProducts();
  Logger.log('=== FETCH TEST: ' + all.length + ' products ===');

  var groups = {};
  for (var i = 0; i < all.length; i++) {
    var p = all[i];
    var store = p.store || 'uniqlo';
    var k = store + '_' + p.product_code + '_' + p.region;
    if (!groups[k]) groups[k] = { pc: p.product_code, region: p.region, store: store, productUrl: p.product_url, name: p.name };
  }

  var keys = Object.keys(groups);
  var ok = 0, fail = 0;

  for (var i = 0; i < keys.length; i++) {
    var g = groups[keys[i]];
    Utilities.sleep(1000);

    var pr = null;
    try {
      if (g.store === 'arket') pr = fetchArketCurrentPrice(g.productUrl);
      else if (g.store === 'cos') pr = fetchCosCurrentPrice(g.productUrl);
      else pr = fetchCurrentPrice(g.pc, g.region, '00');
    } catch (e) {
      Logger.log('❌ ' + g.store + ' | ' + g.name + ' | ERROR: ' + e);
      fail++;
      continue;
    }

    if (pr && pr.currentPrice > 0) {
      Logger.log('✅ ' + g.store + ' | ' + g.name + ' | ' + pr.currentPrice);
      ok++;
    } else {
      Logger.log('❌ ' + g.store + ' | ' + g.name + ' | no price data');
      fail++;
    }
  }

  Logger.log('=== RESULT: ' + ok + ' ok, ' + fail + ' failed out of ' + keys.length + ' ===');
}
function debugFailedProducts() {
  var all = getAllActiveProducts();
  
  for (var i = 0; i < all.length; i++) {
    var p = all[i];
    var store = p.store || 'uniqlo';
    Logger.log('');
    Logger.log('=== ' + p.name + ' (' + store + ') ===');
    Logger.log('Code: ' + p.product_code);
    Logger.log('Region: ' + p.region);
    Logger.log('URL: ' + p.product_url);
    
    if (store === 'uniqlo') {
      // Test the API directly
      var lang = UNIQLO_LANGS[p.region] || 'en';
      var apiUrl = 'https://www.uniqlo.com/' + p.region + '/api/commerce/v5/' + lang + '/products/' + p.product_code +
        '/price-groups/00/l2s?withPrices=true&withStocks=true&includePreviousPrice=false&httpFailure=true';
      Logger.log('API URL: ' + apiUrl);
      
      try {
        var r = UrlFetchApp.fetch(apiUrl, {
          muteHttpExceptions: true,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
            'x-fr-clientid': UNIQLO_CLIENTS[p.region] || 'uq.' + p.region + '.web-spa'
          }
        });
        Logger.log('HTTP: ' + r.getResponseCode());
        var text = r.getContentText();
        Logger.log('Response length: ' + text.length);
        if (text.length < 500) Logger.log('Response: ' + text);
        else {
          try {
            var data = JSON.parse(text);
            Logger.log('Status: ' + data.status);
            if (data.status !== 'ok') Logger.log('Error: ' + JSON.stringify(data).substring(0, 500));
          } catch(e) { Logger.log('Not JSON'); }
        }
      } catch(e) {
        Logger.log('Fetch error: ' + e);
      }
      
    } else {
      // Test proxy responses for ARKET/COS
      var url = p.product_url;
      if (url && url.indexOf('http') !== 0) {
        url = 'https://www.' + store + '.com' + url;
      }
      Logger.log('Full URL: ' + url);
      
      var proxies = [
        ['allorigins', 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)],
        ['corsproxy', 'https://corsproxy.io/?' + encodeURIComponent(url)],
        ['codetabs', 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url)]
      ];
      
      for (var j = 0; j < proxies.length; j++) {
        try {
          var r = UrlFetchApp.fetch(proxies[j][1], {
            muteHttpExceptions: true,
            followRedirects: true,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/json,*/*'
            }
          });
          var code = r.getResponseCode();
          var text = r.getContentText();
          Logger.log(proxies[j][0] + ': HTTP ' + code + ', ' + text.length + ' chars');
          
          // Show what we actually got back
          if (text.length < 1000) {
            Logger.log('  Content: ' + text.substring(0, 500));
          } else {
            Logger.log('  Has __NEXT_DATA__: ' + (text.indexOf('__NEXT_DATA__') !== -1));
            Logger.log('  Has og:title: ' + (text.indexOf('og:title') !== -1));
            Logger.log('  Has ld+json: ' + (text.indexOf('ld+json') !== -1));
            var title = text.match(/<title[^>]*>([^<]*)<\/title>/i);
            if (title) Logger.log('  Page title: ' + title[1]);
          }
        } catch(e) {
          Logger.log(proxies[j][0] + ': ERROR — ' + e.message);
        }
        Utilities.sleep(500);
      }
    }
  }
}
function debugUniqloProduct() {
  var all = getAllActiveProducts();
  for (var i = 0; i < all.length; i++) {
    var p = all[i];
    if (p.store && p.store !== 'uniqlo') continue;
    
    Logger.log('=== ' + p.name + ' ===');
    Logger.log('Code: ' + p.product_code + ' Region: ' + p.region);
    
    var pr = fetchProductPricesAndStock(p.product_code, p.region, '00');
    if (!pr) {
      Logger.log('❌ parsePricesResponse returned null');
      
      // Fetch raw to see what we got
      var lang = UNIQLO_LANGS[p.region] || 'en';
      var clientId = UNIQLO_CLIENTS[p.region] || 'uq.' + p.region + '.web-spa';
      var url = 'https://www.uniqlo.com/' + p.region + '/api/commerce/v5/' + lang + '/products/' + p.product_code +
        '/price-groups/00/l2s?withPrices=true&withStocks=true&includePreviousPrice=false&httpFailure=true';
      var r = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'x-fr-clientid': clientId }
      });
      var data = JSON.parse(r.getContentText());
      Logger.log('Status: ' + data.status);
      Logger.log('l2s count: ' + (data.result && data.result.l2s ? data.result.l2s.length : 'none'));
      Logger.log('prices keys: ' + (data.result && data.result.prices ? Object.keys(data.result.prices).length : 'none'));
      if (data.result && data.result.l2s && data.result.l2s.length > 0) {
        Logger.log('First l2s: ' + JSON.stringify(data.result.l2s[0]));
        var firstId = data.result.l2s[0].l2Id;
        if (data.result.prices[firstId]) {
          Logger.log('First price: ' + JSON.stringify(data.result.prices[firstId]));
        } else {
          Logger.log('No price for l2Id: ' + firstId);
          Logger.log('Available price keys: ' + Object.keys(data.result.prices).slice(0, 5).join(', '));
        }
      }
    } else {
      Logger.log('✅ Price: ' + pr.currentPrice + ' | Colors: ' + pr.colors.length + ' | OnSale: ' + pr.onSale);
      
      // Test SKU lookup
      var skuInfo = getSkuInfo(pr, p.color_code, p.size_code);
      if (skuInfo) {
        Logger.log('✅ SKU: price=' + skuInfo.price + ' inStock=' + skuInfo.inStock);
      } else {
        Logger.log('❌ SKU not found for color=' + p.color_code + ' size=' + p.size_code);
        Logger.log('Available colors: ' + pr.colors.map(function(c) { return c.code; }).join(', '));
        if (pr.colors.length > 0) {
          Logger.log('First color sizes: ' + pr.colors[0].sizes.map(function(s) { return s.sizeCode; }).join(', '));
        }
      }
    }
    Logger.log('');
  }
}
function testArketApis() {
  // Test if ARKET has public APIs like COS
  var slug = 'merino-polo-jumper-dark-blue-0764938001';
  var tests = [
    'https://www.arket.com/api/products/' + slug + '/stock?market=es',
    'https://www.arket.com/api/products/' + slug + '/stock?market=gb',
    'https://www.arket.com/es-es/api/products/' + slug + '/stock?market=es',
    'https://www.arket.com/en-gb/api/products/' + slug + '/stock?market=gb'
  ];
  
  for (var i = 0; i < tests.length; i++) {
    try {
      var r = UrlFetchApp.fetch(tests[i], {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      });
      Logger.log('URL: ' + tests[i]);
      Logger.log('HTTP: ' + r.getResponseCode() + ' | Length: ' + r.getContentText().length);
      if (r.getResponseCode() === 200) {
        Logger.log('Response: ' + r.getContentText().substring(0, 500));
      }
    } catch(e) {
      Logger.log('URL: ' + tests[i]);
      Logger.log('Error: ' + e);
    }
    Logger.log('');
  }
  
  // Also test the datafile that COS/ARKET use for product data
  var datafileTests = [
    'https://www.arket.com/api/productpage/datafile_es-es.json',
    'https://www.arket.com/api/productpage/datafile_en-gb.json',
    'https://www.arket.com/api/products/merino-polo-jumper-dark-blue-0764938001',
    'https://www.arket.com/api/product/0764938001'
  ];
  
  for (var i = 0; i < datafileTests.length; i++) {
    try {
      var r = UrlFetchApp.fetch(datafileTests[i], {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        }
      });
      Logger.log('URL: ' + datafileTests[i]);
      Logger.log('HTTP: ' + r.getResponseCode() + ' | Length: ' + r.getContentText().length);
      if (r.getResponseCode() === 200 && r.getContentText().length > 100) {
        Logger.log('Preview: ' + r.getContentText().substring(0, 300));
      }
    } catch(e) {
      Logger.log('URL: ' + datafileTests[i]);
      Logger.log('Error: ' + e);
    }
    Logger.log('');
  }
}
function testCFProxy() {
  var PROXY = 'https://hmgroup-proxy.danielbaudy.workers.dev';
  var urls = [
    'https://www.arket.com/es-es/product/merino-polo-jumper-dark-blue-0764938001/',
    'https://www.cos.com/en-gb/product/textured-panel-cotton-polo-shirt-dark-brown-1319177003'
  ];
  
  for (var i = 0; i < urls.length; i++) {
    var proxyUrl = PROXY + '?url=' + encodeURIComponent(urls[i]);
    try {
      var r = UrlFetchApp.fetch(proxyUrl, { muteHttpExceptions: true });
      var code = r.getResponseCode();
      var text = r.getContentText();
      Logger.log('URL: ' + urls[i]);
      Logger.log('HTTP: ' + code + ' | Length: ' + text.length);
      if (code === 200 && text.length > 1000) {
        Logger.log('Has __NEXT_DATA__: ' + (text.indexOf('__NEXT_DATA__') !== -1));
        Logger.log('Has og:title: ' + (text.indexOf('og:title') !== -1));
        var title = text.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (title) Logger.log('Title: ' + title[1]);
        Logger.log('✅ WORKS!');
      } else {
        Logger.log('Content: ' + text.substring(0, 300));
      }
    } catch(e) {
      Logger.log('Error: ' + e);
    }
    Logger.log('');
  }
}
function testMangoAPI() {
  var productId = '27076711';
  var tests = [
    'https://online-orchestrator.mango.com/v3/prices/products?channelId=shop&countryIso=ES&productId=' + productId,
    'https://online-orchestrator.mango.com/v3/products?channelId=shop&countryIso=ES&languageIso=es&productId=' + productId
  ];
  
  for (var i = 0; i < tests.length; i++) {
    try {
      var r = UrlFetchApp.fetch(tests[i], {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'Origin': 'https://shop.mango.com',
          'Referer': 'https://shop.mango.com/'
        }
      });
      Logger.log('URL: ' + tests[i].substring(tests[i].lastIndexOf('/v3/')));
      Logger.log('HTTP: ' + r.getResponseCode());
      var text = r.getContentText();
      Logger.log('Length: ' + text.length);
      Logger.log('Preview: ' + text.substring(0, 800));
    } catch(e) {
      Logger.log('Error: ' + e);
    }
    Logger.log('');
  }
}
function testMangoEverything() {
  var productId = '27076711';
  var colorCode = '01';
  
  var tests = [
    // Original API (known blocked)
    ['Price API', 'https://online-orchestrator.mango.com/v3/prices/products?channelId=shop&countryIso=ES&productId=' + productId],
    
    // Product detail API
    ['Product API', 'https://online-orchestrator.mango.com/v3/products?channelId=shop&countryIso=ES&languageIso=es&productId=' + productId],
    
    // Try without Origin header — maybe CORS is the issue, not Akamai
    ['Price API no-origin', 'NO_ORIGIN:https://online-orchestrator.mango.com/v3/prices/products?channelId=shop&countryIso=ES&productId=' + productId],
    
    // Different orchestrator paths
    ['Orchestrator v2', 'https://online-orchestrator.mango.com/v2/products?channelId=shop&countryIso=ES&productId=' + productId],
    ['Orchestrator stock', 'https://online-orchestrator.mango.com/v3/stock/products?channelId=shop&countryIso=ES&productId=' + productId],
    
    // Mobile API (apps often use different domains)
    ['Mobile API', 'https://mobileapi.mango.com/v3/products?channelId=app&countryIso=ES&productId=' + productId],
    ['Mobile API 2', 'https://api.mango.com/v3/products?channelId=app&countryIso=ES&productId=' + productId],
    
    // Different subdomains
    ['Services', 'https://services.mango.com/v3/prices/products?channelId=shop&countryIso=ES&productId=' + productId],
    ['Catalog', 'https://catalog.mango.com/products/' + productId],
    
    // Product page HTML (might have __NEXT_DATA__ or JSON-LD)
    ['Product HTML', 'https://shop.mango.com/es/es/p/hombre/polos/manga-corta/polo-pique-slim-fit_' + productId],
    
    // Different country — maybe some aren't behind Akamai
    ['Product HTML GB', 'https://shop.mango.com/gb/en/p/men/polo-shirts/short-sleeve/slim-fit-pique-polo-shirt_' + productId],
    
    // Mango outlet
    ['Outlet', 'https://www.mangooutlet.com/es/es/'],
    
    // Sitemap (might list products with prices)
    ['Sitemap', 'https://shop.mango.com/sitemap.xml'],
    ['Sitemap 2', 'https://shop.mango.com/sitemap_index.xml'],
    ['Robots', 'https://shop.mango.com/robots.txt'],
    
    // RSS/feed
    ['Feed', 'https://shop.mango.com/feed'],
    ['Feed 2', 'https://shop.mango.com/es/es/feed.xml'],
    
    // Product data via garments endpoint (saw this in your network tab)
    ['Garments', 'https://shop.mango.com/services/garments/' + productId],
    ['Garments 2', 'https://shop.mango.com/services/garments/' + productId + '?countryId=ES'],
    
    // Google cache / AMP
    ['AMP', 'https://shop.mango.com/es/es/amp/p/hombre/polos/manga-corta/polo-pique-slim-fit_' + productId],
    
    // Try the _next/data pattern (Next.js)
    ['Next data', 'https://shop.mango.com/_next/data/products/' + productId + '.json'],
    
    // Open Graph / embed endpoint
    ['OEmbed', 'https://shop.mango.com/oembed?url=https://shop.mango.com/es/es/p/hombre/polos/manga-corta/polo-pique-slim-fit_' + productId],
    
    // Try plain fetch with minimal headers
    ['Minimal headers', 'MINIMAL:https://online-orchestrator.mango.com/v3/prices/products?channelId=shop&countryIso=ES&productId=' + productId]
  ];
  
  for (var i = 0; i < tests.length; i++) {
    var label = tests[i][0];
    var url = tests[i][1];
    var headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/json,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    };
    
    // Special header modes
    if (url.indexOf('NO_ORIGIN:') === 0) {
      url = url.replace('NO_ORIGIN:', '');
      // No origin/referer
    } else if (url.indexOf('MINIMAL:') === 0) {
      url = url.replace('MINIMAL:', '');
      headers = { 'Accept': 'application/json' };
    } else if (url.indexOf('online-orchestrator') !== -1 || url.indexOf('services') !== -1) {
      headers['Origin'] = 'https://shop.mango.com';
      headers['Referer'] = 'https://shop.mango.com/';
    }
    
    try {
      var r = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: headers
      });
      var code = r.getResponseCode();
      var text = r.getContentText();
      var len = text.length;
      var isAkamai = text.indexOf('Access Denied') !== -1 && text.indexOf('Reference') !== -1;
      var isJSON = false;
      try { JSON.parse(text); isJSON = true; } catch(e) {}
      
      var info = '';
      if (isAkamai) info = '❌ AKAMAI';
      else if (code === 200 && isJSON && len > 10) info = '✅ JSON!';
      else if (code === 200 && len > 5000) {
        var hasPrice = text.indexOf('"price"') !== -1 || text.indexOf('product:price') !== -1;
        var hasNextData = text.indexOf('__NEXT_DATA__') !== -1;
        var hasJsonLd = text.indexOf('application/ld+json') !== -1;
        var hasOg = text.indexOf('og:title') !== -1;
        if (hasPrice || hasNextData || hasJsonLd || hasOg) info = '✅ HAS PRODUCT DATA';
        else info = '⚠️ HTML but no product data';
        if (hasNextData) info += ' [NEXT_DATA]';
        if (hasJsonLd) info += ' [JSON-LD]';
        if (hasOg) info += ' [OG]';
        if (hasPrice) info += ' [PRICE]';
      }
      else info = '⚠️';
      
      Logger.log(label + ': HTTP ' + code + ' | ' + len + ' chars | ' + info);
      
      // Show useful content
      if (code === 200 && isJSON && len > 10 && len < 5000) {
        Logger.log('  Response: ' + text.substring(0, 500));
      }
      if (code === 200 && !isAkamai && len > 5000 && len < 50000) {
        var title = text.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (title) Logger.log('  Title: ' + title[1].substring(0, 100));
      }
      
    } catch(e) {
      Logger.log(label + ': ERROR — ' + e.message);
    }
    }
    }
  /* ============================
   UNIQLO SALES TESTS
   ============================ */

// Test 1: Can we fetch the sale page?
function testSaleFetch() {
  Logger.log('=== SALE PAGE FETCH TEST ===');
  
  var regions = ['es', 'uk', 'de'];
  var genders = ['men', 'women'];
  
  for (var r = 0; r < regions.length; r++) {
    for (var g = 0; g < genders.length; g++) {
      var items = fetchSalePageProducts(regions[r], genders[g]);
      Logger.log(regions[r] + '/' + genders[g] + ': ' + items.length + ' items');
      if (items.length > 0) {
        var it = items[0];
        Logger.log('  First: ' + it.name);
        Logger.log('  Price: ' + it.currencySymbol + it.salePrice + ' (was ' + it.currencySymbol + it.basePrice + ', -' + it.discount + '%)');
        Logger.log('  Code: ' + it.productCode);
        Logger.log('  Category: ' + it.category);
        Logger.log('  Sizes: ' + (it.sizes ? it.sizes.length : 0));
        Logger.log('  Image: ' + (it.image ? 'yes' : 'no'));
        if (it.sizes && it.sizes.length > 0) {
          Logger.log('  Size samples: ' + it.sizes.slice(0, 5).map(function(s) { return s.name + (s.inStock ? '' : ' [OOS]'); }).join(', '));
        }
      }
      Utilities.sleep(1500);
    }
  }
  Logger.log('=== DONE ===');
}

// Test 2: Does filtering work?
function testSaleFilter() {
  Logger.log('=== SALE FILTER TEST ===');
  
  var items = fetchSalePageProducts('es', 'men');
  if (items.length === 0) { Logger.log('❌ No items fetched'); return; }
  Logger.log('Total items: ' + items.length);
  
  // Count by category
  var byCat = {};
  for (var i = 0; i < items.length; i++) {
    var cat = items[i].category;
    if (!byCat[cat]) byCat[cat] = 0;
    byCat[cat]++;
  }
  Logger.log('By category: ' + JSON.stringify(byCat));
  
  // Test filter: tops in M
  var filter1 = { gender: 'men', categories: ['tops'], sizes: ['M'], minDiscount: 0 };
  var match1 = items.filter(function(it) { return saleItemMatchesFilter(it, filter1); });
  Logger.log('Tops in M: ' + match1.length + ' matches');
  if (match1.length > 0) Logger.log('  e.g. ' + match1[0].name);
  
  // Test filter: jeans in 32
  var filter2 = { gender: 'men', categories: ['jeans'], sizes: ['32'], minDiscount: 0 };
  var match2 = items.filter(function(it) { return saleItemMatchesFilter(it, filter2); });
  Logger.log('Jeans in 32: ' + match2.length + ' matches');
  if (match2.length > 0) Logger.log('  e.g. ' + match2[0].name);
  
  // Test filter: all categories, L + 32
  var filter3 = { gender: 'men', categories: ['all'], sizes: ['L', '32'], minDiscount: 0 };
  var match3 = items.filter(function(it) { return saleItemMatchesFilter(it, filter3); });
  Logger.log('All cats, L + 32: ' + match3.length + ' matches');
  
  // Test filter: accessories (should skip size filter)
  var filter4 = { gender: 'men', categories: ['accessories'], sizes: ['M'], minDiscount: 0 };
  var match4 = items.filter(function(it) { return saleItemMatchesFilter(it, filter4); });
  Logger.log('Accessories (size M set): ' + match4.length + ' matches');
  
  Logger.log('=== DONE ===');
}

// Test 3: Does the cache + new item detection work?
function testSaleCache() {
  Logger.log('=== SALE CACHE TEST ===');
  
  var items = fetchSalePageProducts('es', 'men');
  if (items.length === 0) { Logger.log('❌ No items fetched'); return; }
  Logger.log('Fetched: ' + items.length + ' items');
  
  var cacheKey = 'sale_test_es_men';
  
  // Clear test cache
  setConfig(cacheKey, '');
  
  // First run — empty cache
  var seenCodes = getSaleCache(cacheKey);
  Logger.log('Cache empty: ' + Object.keys(seenCodes).length + ' items');
  
  var allCodes = {};
  var newItems = [];
  for (var i = 0; i < items.length; i++) {
    allCodes[items[i].productCode] = true;
    if (!seenCodes[items[i].productCode]) newItems.push(items[i]);
  }
  Logger.log('First run — all ' + newItems.length + ' would be "new" (but skipped on first run)');
  
  // Save cache
  setSaleCache(cacheKey, allCodes);
  Logger.log('Cached ' + Object.keys(allCodes).length + ' items');
  
  // Second run — should find 0 new items
  var seenCodes2 = getSaleCache(cacheKey);
  var newItems2 = [];
  for (var i = 0; i < items.length; i++) {
    if (!seenCodes2[items[i].productCode]) newItems2.push(items[i]);
  }
  Logger.log('Second run — ' + newItems2.length + ' new items (should be 0)');
  
  // Simulate a new item by removing one from cache
  var codes2 = JSON.parse(JSON.stringify(allCodes));
  var firstCode = Object.keys(codes2)[0];
  delete codes2[firstCode];
  setSaleCache(cacheKey, codes2);
  Logger.log('Removed ' + firstCode + ' from cache to simulate new item');
  
  var seenCodes3 = getSaleCache(cacheKey);
  var newItems3 = [];
  for (var i = 0; i < items.length; i++) {
    if (!seenCodes3[items[i].productCode]) newItems3.push(items[i]);
  }
  Logger.log('Third run — ' + newItems3.length + ' new items (should be 1)');
  if (newItems3.length > 0) Logger.log('  Detected: ' + newItems3[0].name + ' (' + newItems3[0].productCode + ')');
  
  // Cleanup test cache
  setConfig(cacheKey, '');
  Logger.log('Test cache cleaned up');
  Logger.log('=== DONE ===');
}

// Test 4: Send a fake sale alert to yourself
function testSaleAlert() {
  Logger.log('=== SALE ALERT TEST ===');
  
  var items = fetchSalePageProducts('es', 'men');
  if (items.length === 0) { Logger.log('❌ No items fetched'); return; }
  
  // Find first item with a discount
  var testItem = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].discount > 0 && items[i].name) { testItem = items[i]; break; }
  }
  if (!testItem) testItem = items[0];
  
  Logger.log('Sending test alert for: ' + testItem.name);
  Logger.log('Price: ' + testItem.currencySymbol + testItem.salePrice + ' (was ' + testItem.currencySymbol + testItem.basePrice + ')');
  Logger.log('Image: ' + testItem.image);
  
  // Get first subscriber or first user
  var subscribers = getSaleSubscribers();
  var chatId = null;
  if (subscribers.length > 0) {
    chatId = subscribers[0].chat_id;
    Logger.log('Sending to subscriber: ' + chatId);
  } else {
    var users = getSheet('Users').getDataRange().getValues();
    if (users.length > 1) {
      chatId = users[1][0];
      Logger.log('No subscribers — sending to first user: ' + chatId);
    }
  }
  
  if (!chatId) { Logger.log('❌ No users found'); return; }
  
  sendSaleAlert(chatId, testItem);
  Logger.log('✅ Check Telegram for the alert');
  Logger.log('=== DONE ===');
}

// Test 5: Full end-to-end (checks subscribers, fetches, filters, notifies)
function testSaleFullRun() {
  Logger.log('=== FULL SALE RUN TEST ===');
  
  var subscribers = getSaleSubscribers();
  Logger.log('Subscribers: ' + subscribers.length);
  
  if (subscribers.length === 0) {
    Logger.log('❌ No subscribers. Enable sale alerts in Settings first.');
    Logger.log('   Or manually set sale_alerts to "on" in Users sheet');
    return;
  }
  
  for (var i = 0; i < subscribers.length; i++) {
    var s = subscribers[i];
    Logger.log('');
    Logger.log('Subscriber: ' + s.chat_id);
    Logger.log('  Prefs: ' + JSON.stringify(s.salePrefs));
  }
  
  Logger.log('');
  Logger.log('Running checkUniqloSales()...');
  Logger.log('(First run will cache silently — run twice to test alerts)');
  Logger.log('');
  
  checkUniqloSales();
  
  Logger.log('=== DONE ===');
}

// Test 6: Force a notification by clearing cache then running
function testSaleForceAlert() {
  Logger.log('=== FORCE SALE ALERT TEST ===');
  
  var subscribers = getSaleSubscribers();
  if (subscribers.length === 0) {
    Logger.log('❌ No subscribers');
    return;
  }
  
  // Get the region/gender from first subscriber
  var prefs = subscribers[0].salePrefs || {};
  var region = prefs.region || subscribers[0].region || 'es';
  var genders = [];
  if (!prefs.gender || prefs.gender === 'both') genders = ['men', 'women'];
  else genders = [prefs.gender];
  
  // First: populate cache with current items
  Logger.log('Step 1: Populating cache...');
  for (var g = 0; g < genders.length; g++) {
    var items = fetchSalePageProducts(region, genders[g]);
    var cacheKey = 'sale_' + region + '_' + genders[g];
    var allCodes = {};
    for (var i = 0; i < items.length; i++) allCodes[items[i].productCode] = true;
    
    // Remove 3 items from cache to simulate "new" items
    var keys = Object.keys(allCodes);
    var removed = [];
    for (var r = 0; r < Math.min(3, keys.length); r++) {
      removed.push(keys[r]);
      delete allCodes[keys[r]];
    }
    setSaleCache(cacheKey, allCodes);
    Logger.log('  ' + region + '/' + genders[g] + ': cached ' + Object.keys(allCodes).length + ', removed ' + removed.length + ' to simulate new');
    Utilities.sleep(1000);
  }
  
  // Now run the checker — should detect the removed items as "new"
  Logger.log('');
  Logger.log('Step 2: Running checker (should detect ~3 new items per gender)...');
  Logger.log('');
  
  checkUniqloSales();
  
  Logger.log('');
  Logger.log('✅ Check Telegram for alerts');
  Logger.log('=== DONE ===');
}
function testSaleDebugRaw() {
  Logger.log('=== RAW SALE API DEBUG ===');
  
  var region = 'es';
  var lang = 'en';
  var clientId = UNIQLO_CLIENTS[region] || 'uq.' + region + '.web-spa';
  
  // Test 1: What does the HTML page contain?
  Logger.log('--- HTML PAGE ---');
  var htmlUrl = 'https://www.uniqlo.com/' + region + '/' + lang + '/feature/sale/men';
  var r1 = UrlFetchApp.fetch(htmlUrl, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' }
  });
  var html = r1.getContentText();
  Logger.log('HTML length: ' + html.length);
  Logger.log('Has __NEXT_DATA__: ' + (html.indexOf('__NEXT_DATA__') !== -1));
  
  // Extract __NEXT_DATA__ to see structure
  var ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (ndMatch) {
    var nd = JSON.parse(ndMatch[1]);
    var pp = nd.props ? (nd.props.pageProps || {}) : {};
    Logger.log('pageProps keys: ' + Object.keys(pp).join(', '));
    
    // Look for product arrays
    function findArrays(obj, path, depth) {
      if (!obj || depth > 4 || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        if (obj.length > 0) Logger.log('  Array at ' + path + ': ' + obj.length + ' items, first type: ' + typeof obj[0]);
        if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
          Logger.log('    First item keys: ' + Object.keys(obj[0]).slice(0, 15).join(', '));
          if (obj[0].prices) Logger.log('    prices: ' + JSON.stringify(obj[0].prices).substring(0, 300));
          if (obj[0].priceAsNumber !== undefined) Logger.log('    priceAsNumber: ' + obj[0].priceAsNumber);
          if (obj[0].price) Logger.log('    price: ' + JSON.stringify(obj[0].price).substring(0, 200));
        }
        return;
      }
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) findArrays(obj[keys[k]], path + '.' + keys[k], depth + 1);
    }
    findArrays(pp, 'pp', 0);
  }
  
  // Test 2: Try different API URLs for men vs women
  Logger.log('');
  Logger.log('--- API ENDPOINTS ---');
  
  var apiTests = [
    ['sale/men', '/feature/sale/men'],
    ['sale/women', '/feature/sale/women'],
    ['sale-men', '/feature/sale-men'],
    ['sale-women', '/feature/sale-women'],
    ['men/sale', '/feature/men/sale'],
    ['women/sale', '/feature/women/sale']
  ];
  
  for (var i = 0; i < apiTests.length; i++) {
    var testUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang + '/products?path=' + apiTests[i][1] + '&offset=0&limit=5&httpFailure=true';
    try {
      var r = UrlFetchApp.fetch(testUrl, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'x-fr-clientid': clientId }
      });
      var code = r.getResponseCode();
      var text = r.getContentText();
      var isOk = false;
      try { var d = JSON.parse(text); isOk = d.status === 'ok'; } catch(e) {}
      Logger.log(apiTests[i][0] + ': HTTP ' + code + ' | ok=' + isOk + ' | ' + text.length + ' chars');
      if (isOk) {
        var data = JSON.parse(text);
        var items = data.result ? (data.result.items || data.result.products || []) : [];
        Logger.log('  Items: ' + items.length);
        if (items.length > 0) {
          Logger.log('  First: ' + JSON.stringify(items[0]).substring(0, 500));
        }
        // Check total count
        if (data.result && data.result.pagination) Logger.log('  Pagination: ' + JSON.stringify(data.result.pagination));
        if (data.result && data.result.total) Logger.log('  Total: ' + data.result.total);
      }
    } catch(e) { Logger.log(apiTests[i][0] + ': ERROR ' + e); }
    Utilities.sleep(500);
  }
  
  // Test 3: Look at actual product structure from working endpoint
  Logger.log('');
  Logger.log('--- PRODUCT STRUCTURE ---');
  var workingUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang + '/products?path=feature/sale/men&offset=0&limit=3&httpFailure=true';
  try {
    var r3 = UrlFetchApp.fetch(workingUrl, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'x-fr-clientid': clientId }
    });
    var data3 = JSON.parse(r3.getContentText());
    if (data3.status === 'ok' && data3.result) {
      Logger.log('Result keys: ' + Object.keys(data3.result).join(', '));
      
      // Find where products live
      var rk = Object.keys(data3.result);
      for (var k = 0; k < rk.length; k++) {
        var val = data3.result[rk[k]];
        if (Array.isArray(val) && val.length > 0) {
          Logger.log('Array "' + rk[k] + '": ' + val.length + ' items');
          Logger.log('  Item keys: ' + Object.keys(val[0]).join(', '));
          Logger.log('  Full first item: ' + JSON.stringify(val[0]).substring(0, 1500));
        } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          Logger.log('Object "' + rk[k] + '": keys=' + Object.keys(val).slice(0, 10).join(', '));
        } else {
          Logger.log(rk[k] + ': ' + String(val).substring(0, 100));
        }
      }
    }
  } catch(e) { Logger.log('ERROR: ' + e); }
  
  // Test 4: Check UK URL patterns
  Logger.log('');
  Logger.log('--- UK PATTERNS ---');
  var ukTests = [
    'https://www.uniqlo.com/uk/en/feature/sale/men',
    'https://www.uniqlo.com/uk/en/feature/sale/men/',
    'https://www.uniqlo.com/uk/en/feature/limited-offers/men',
    'https://www.uniqlo.com/uk/en/spl/sale/men'
  ];
  for (var u = 0; u < ukTests.length; u++) {
    try {
      var ru = UrlFetchApp.fetch(ukTests[u], {
        muteHttpExceptions: true, followRedirects: true,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
      });
      var uc = ru.getResponseCode();
      var ut = ru.getContentText();
      var finalUrl = '';
      try { finalUrl = ru.getAllHeaders()['Location'] || ''; } catch(e) {}
      Logger.log('UK ' + ukTests[u].split('.com')[1] + ': HTTP ' + uc + ' | ' + ut.length + ' chars' + (finalUrl ? ' → ' + finalUrl : ''));
      if (uc === 200 && ut.length > 5000) {
        var title = ut.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (title) Logger.log('  Title: ' + title[1]);
      }
    } catch(e) { Logger.log('UK ERROR: ' + e); }
  }
  
  Logger.log('=== DONE ===');
}
function testSaleUkDebug() {
  Logger.log('=== UK SALE API DEBUG ===');
  
  var ids = fetchSalePageIds('uk', 'men');
  Logger.log('IDs from HTML: ' + ids.length);
  if (ids.length === 0) return;
  
  Logger.log('First 5: ' + ids.slice(0, 5).join(', '));
  
  var lang = 'en';
  var clientId = UNIQLO_CLIENTS['uk'] || 'uq.uk.web-spa';
  var batch = ids.slice(0, 3);
  
  // Test 1: Our current format
  var url1 = 'https://www.uniqlo.com/uk/api/commerce/v5/' + lang +
    '/products?productIds=' + batch.join('%2C') +
    '&priceGroups=' + batch.map(function(){return '00';}).join('%2C') +
    '&imageRatio=3x4&httpFailure=true';
  Logger.log('URL1: ' + url1);
  
  try {
    var r1 = UrlFetchApp.fetch(url1, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.uniqlo.com/uk/',
        'x-fr-clientid': clientId
      }
    });
    Logger.log('Test1: HTTP ' + r1.getResponseCode() + ' | ' + r1.getContentText().length + ' chars');
    var d1 = JSON.parse(r1.getContentText());
    Logger.log('  Status: ' + d1.status);
    if (d1.result) Logger.log('  Items: ' + (d1.result.items ? d1.result.items.length : 'none'));
    if (d1.result && d1.result.items && d1.result.items.length === 0) {
      Logger.log('  Full response: ' + r1.getContentText().substring(0, 500));
    }
  } catch(e) { Logger.log('Test1 ERROR: ' + e); }
  
  // Test 2: Commas not encoded
  var url2 = 'https://www.uniqlo.com/uk/api/commerce/v5/' + lang +
    '/products?productIds=' + batch.join(',') +
    '&priceGroups=' + batch.map(function(){return '00';}).join(',') +
    '&imageRatio=3x4&httpFailure=true';
  Logger.log('URL2 (plain commas): ' + url2);
  
  try {
    var r2 = UrlFetchApp.fetch(url2, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.uniqlo.com/uk/',
        'x-fr-clientid': clientId
      }
    });
    Logger.log('Test2: HTTP ' + r2.getResponseCode() + ' | ' + r2.getContentText().length + ' chars');
    var d2 = JSON.parse(r2.getContentText());
    Logger.log('  Status: ' + d2.status);
    if (d2.result) Logger.log('  Items: ' + (d2.result.items ? d2.result.items.length : 'none'));
    if (d2.result && d2.result.items && d2.result.items.length > 0) {
      Logger.log('  ✅ PLAIN COMMAS WORK!');
      Logger.log('  First: ' + d2.result.items[0].name);
    }
  } catch(e) { Logger.log('Test2 ERROR: ' + e); }
  
  // Test 3: Single product (no comma issue)
  var url3 = 'https://www.uniqlo.com/uk/api/commerce/v5/' + lang +
    '/products?productIds=' + batch[0] +
    '&priceGroups=00&imageRatio=3x4&httpFailure=true';
  Logger.log('URL3 (single ID): ' + url3);
  
  try {
    var r3 = UrlFetchApp.fetch(url3, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.uniqlo.com/uk/',
        'x-fr-clientid': clientId
      }
    });
    Logger.log('Test3: HTTP ' + r3.getResponseCode() + ' | ' + r3.getContentText().length + ' chars');
    var d3 = JSON.parse(r3.getContentText());
    Logger.log('  Status: ' + d3.status);
    if (d3.result) Logger.log('  Items: ' + (d3.result.items ? d3.result.items.length : 'none'));
    if (d3.result && d3.result.items && d3.result.items.length > 0) {
      Logger.log('  ✅ Single ID works: ' + d3.result.items[0].name);
    }
  } catch(e) { Logger.log('Test3 ERROR: ' + e); }
  
  // Test 4: Different client ID
  var url4 = url2; // plain commas
  var altClients = ['uq.uk.web-spa', 'uq.gb.web-spa', 'uq.eu.web-spa'];
  for (var c = 0; c < altClients.length; c++) {
    try {
      var r4 = UrlFetchApp.fetch(url4, {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'Referer': 'https://www.uniqlo.com/uk/',
          'x-fr-clientid': altClients[c]
        }
      });
      var d4 = JSON.parse(r4.getContentText());
      var count = (d4.result && d4.result.items) ? d4.result.items.length : 0;
      Logger.log('ClientId ' + altClients[c] + ': ' + count + ' items');
    } catch(e) {}
  }
  
  // Test 5: No client ID at all
  try {
    var r5 = UrlFetchApp.fetch(url2, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    var d5 = JSON.parse(r5.getContentText());
    var count5 = (d5.result && d5.result.items) ? d5.result.items.length : 0;
    Logger.log('No clientId: ' + count5 + ' items');
  } catch(e) { Logger.log('No clientId ERROR: ' + e); }
  
  Logger.log('=== DONE ===');
}
function testSalePagination() {
  Logger.log('=== PAGINATION TEST ===');
  
  var region = 'es';
  var lang = 'en';
  var clientId = UNIQLO_CLIENTS[region] || 'uq.' + region + '.web-spa';
  
  // Get first batch of IDs from HTML
  var firstIds = fetchSalePageIds(region, 'men');
  Logger.log('IDs from HTML: ' + firstIds.length);
  
  // Fetch those via API to see total
  var batch = firstIds.slice(0, 16);
  var apiUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang +
    '/products?productIds=' + batch.join('%2C') +
    '&priceGroups=' + batch.map(function(){return '00';}).join('%2C') +
    '&imageRatio=3x4&httpFailure=true';
  
  var r = UrlFetchApp.fetch(apiUrl, {
    muteHttpExceptions: true,
    headers: {
      'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
      'Referer': 'https://www.uniqlo.com/' + region + '/',
      'x-fr-clientid': clientId
    }
  });
  var d = JSON.parse(r.getContentText());
  if (d.result && d.result.aggregations && d.result.aggregations.flags) {
    Logger.log('Flags: ' + JSON.stringify(d.result.aggregations.flags));
  }
  
  // Try flagCodes=discount with various parameters
  Logger.log('');
  Logger.log('--- DISCOUNT FLAG SEARCHES ---');
  
  var tests = [
    'flagCodes=discount&offset=0&limit=20',
    'flagCodes=discount&offset=0&limit=100',
    'flagCodes=discount&offset=0&limit=20&tree=men',
    'flagCodes=discount&offset=0&limit=20&genders=37268',
    'flagCodes=discount&offset=0&limit=20&gender=men',
    'flagCodes=discount&offset=0&limit=20&plds=men',
    'onSale=true&offset=0&limit=20',
    'flags=discount&offset=0&limit=20',
    'representative.sales=true&offset=0&limit=20',
    'q=&flagCodes=discount&offset=0&limit=20',
    'q=&flags=discount&offset=0&limit=20'
  ];
  
  for (var i = 0; i < tests.length; i++) {
    var url = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang +
      '/products?' + tests[i] + '&httpFailure=true';
    try {
      var r2 = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
          'Referer': 'https://www.uniqlo.com/' + region + '/',
          'x-fr-clientid': clientId
        }
      });
      var d2 = JSON.parse(r2.getContentText());
      var total = 0, count = 0;
      if (d2.result && d2.result.pagination) {
        total = d2.result.pagination.total || 0;
        count = d2.result.pagination.count || 0;
      }
      var marker = total > 0 ? '✅' : '—';
      Logger.log(marker + ' ' + tests[i].substring(0, 60) + ' → total=' + total + ' count=' + count);
      if (total > 0 && d2.result.items && d2.result.items.length > 0) {
        Logger.log('    First: ' + d2.result.items[0].name + ' | ' + d2.result.items[0].productId);
        if (d2.result.items[0].prices && d2.result.items[0].prices.promo) {
          Logger.log('    Price: ' + d2.result.items[0].prices.promo.value + ' (was ' + d2.result.items[0].prices.base.value + ')');
        }
      }
    } catch(e) { Logger.log('✗ ' + tests[i].substring(0, 40) + ' ERROR: ' + e.message); }
    Utilities.sleep(300);
  }
  
  // Try the search endpoint instead
  Logger.log('');
  Logger.log('--- SEARCH ENDPOINT ---');
  
  var searchTests = [
    '/search?flagCodes=discount&offset=0&limit=20',
    '/search?q=&flagCodes=discount&offset=0&limit=20',
    '/search?q=sale&offset=0&limit=20'
  ];
  
  for (var i = 0; i < searchTests.length; i++) {
    var url = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang + searchTests[i] + '&httpFailure=true';
    try {
      var r3 = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
          'x-fr-clientid': clientId
        }
      });
      var d3 = JSON.parse(r3.getContentText());
      var total = (d3.result && d3.result.pagination) ? d3.result.pagination.total : 0;
      Logger.log((total > 0 ? '✅' : '—') + ' ' + searchTests[i] + ' → total=' + total);
    } catch(e) { Logger.log('✗ ' + searchTests[i] + ' ERROR'); }
    Utilities.sleep(300);
  }
  
  // Try to find how the page loads subsequent batches
  Logger.log('');
  Logger.log('--- HTML SCRIPT ANALYSIS ---');
  
  var htmlUrl = 'https://www.uniqlo.com/' + region + '/' + lang + '/feature/sale/men';
  var r4 = UrlFetchApp.fetch(htmlUrl, {
    muteHttpExceptions: true, followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
  });
  var html = r4.getContentText();
  
  // Look for product ID arrays or pagination config
  var patterns = [
    /productIds['":\s]*\[([^\]]{20,})\]/g,
    /["']productIds["'][:\s]*["']([^"']{20,})["']/g,
    /allProductIds['":\s]*\[([^\]]{20,})\]/g,
    /totalProducts['":\s]*(\d+)/g,
    /pageSize['":\s]*(\d+)/g,
    /PRODUCT_IDS['":\s]*\[([^\]]{20,})\]/g
  ];
  
  for (var p = 0; p < patterns.length; p++) {
    var m;
    while ((m = patterns[p].exec(html)) !== null) {
      Logger.log('Found: ' + m[0].substring(0, 200));
    }
  }
  
  // Count total E-codes in different script blocks
  var scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (var s = 0; s < scripts.length; s++) {
    var ids = {};
    var re = /E\d{6}-\d{3}/g;
    var m;
    while ((m = re.exec(scripts[s])) !== null) ids[m[0]] = true;
    var count = Object.keys(ids).length;
    if (count > 5) {
      Logger.log('Script block ' + s + ': ' + count + ' product IDs | length=' + scripts[s].length);
    }
  }
  
  Logger.log('=== DONE ===');
}