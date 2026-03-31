function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result;

  try { migrateProductsSheet(); } catch (ex) {}
  try { migrateUsersSheet(); } catch (ex) {}

  try {
    switch (action) {
      case 'preview':
        var clientProduct = null;
        if (e.parameter.cp) {
          try { clientProduct = JSON.parse(e.parameter.cp); } catch (ex) {}
        }
        result = apiPreviewProduct(e.parameter.url, clientProduct);
        break;
      case 'add':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        result = apiAddProduct({
          chatId: e.parameter.cid,
          productCode: e.parameter.pc,
          colorCode: e.parameter.cc || '',
          colorName: e.parameter.cn || '',
          sizeCode: e.parameter.sc || '',
          targetPrice: e.parameter.tp || '',
          region: e.parameter.rg || 'es',
          store: e.parameter.store || 'uniqlo',
          productUrl: e.parameter.purl || '',
          productName: e.parameter.pname || '',
          productPrice: e.parameter.pprice || '',
          productCurrency: e.parameter.pcur || '',
          productImage: e.parameter.pimg || ''
        });
        break;
      case 'update':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        result = apiUpdateProduct({
          cid: e.parameter.cid,
          pid: e.parameter.pid,
          pc: e.parameter.pc || '',
          cc: e.parameter.cc,
          cn: e.parameter.cn,
          sc: e.parameter.sc,
          tp: e.parameter.tp,
          rg: e.parameter.rg || 'es',
          store: e.parameter.store || 'uniqlo',
          purl: e.parameter.purl || '',
          pimg: e.parameter.pimg || ''
        });
        break;
      case 'products':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        result = apiGetProducts(e.parameter.cid);
        break;
      case 'remove':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        result = apiRemoveProduct(e.parameter.pid, e.parameter.cid);
        break;
      case 'test':
        result = apiTestTelegram(e.parameter.cid);
        break;
      case 'settings':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        result = apiGetSettings(e.parameter.cid);
        break;
      case 'save':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        result = apiSaveSettings(e.parameter.cid, {
          sizeTops: e.parameter.st || '',
          sizeBottoms: e.parameter.sb || '',
          region: e.parameter.rg || ''
        });
        break;

      case 'getSaleSettings':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        result = apiGetSaleSettings(e.parameter.cid);
        break;
      case 'saveSaleSettings':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        var salePrefs = null;
        if (e.parameter.sp) {
          try { salePrefs = JSON.parse(e.parameter.sp); } catch (ex) {}
        }
        result = apiSaveSaleSettings(e.parameter.cid, e.parameter.enabled === 'true', salePrefs);
        break;

      case 'pushprices':
        if (!verifyAuth(e.parameter.cid, e.parameter.sec)) return authError();
        var priceData = null;
        if (e.parameter.pd) {
          try { priceData = JSON.parse(e.parameter.pd); } catch (ex) {}
        }
        result = apiPushPrices(e.parameter.cid, priceData);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function authError() {
  return ContentService.createTextOutput(JSON.stringify({ error: 'AUTH_FAILED' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================
   STORE DETECTION
   ============================ */

function detectStore(url) {
  if (!url) return 'uniqlo';
  if (url.indexOf('arket.com') !== -1) return 'arket';
  if (url.indexOf('cos.com') !== -1) return 'cos';
  if (url.indexOf('mango.com') !== -1) return 'mango';
  return 'uniqlo';
}

/* ============================
   API HANDLERS
   ============================ */

function apiPreviewProduct(url, clientProduct) {
  var store = detectStore(url);

  if (store === 'arket') {
    if (clientProduct && clientProduct.name) {
      return apiPreviewArketFromClientData(clientProduct, url);
    }
    var parsed = parseArketUrl(url);
    if (!parsed) return { error: 'Invalid ARKET URL' };
    var product = fetchArketProductFromUrl(url);
    if (!product) return { error: 'ARKET_CLIENT_FETCH_NEEDED' };
    return { ok: true, product: product, parsed: parsed, store: 'arket' };
  }

  if (store === 'cos') {
    if (clientProduct && clientProduct.name) {
      return apiPreviewCosFromClientData(clientProduct, url);
    }
    var parsed = parseCosUrl(url);
    if (!parsed) return { error: 'Invalid COS URL' };
    var product = fetchCosProductFromUrl(url);
    if (!product) return { error: 'COS_CLIENT_FETCH_NEEDED' };
    return { ok: true, product: product, parsed: parsed, store: 'cos' };
  }

  if (store === 'mango') {
    if (clientProduct && clientProduct.name) {
      return apiPreviewMangoFromClientData(clientProduct, url);
    }
    var parsed = parseMangoUrl(url);
    if (!parsed) return { error: 'Invalid Mango URL' };
    var product = fetchMangoProductFromUrl(url);
    if (!product) return { error: 'MANGO_CLIENT_FETCH_NEEDED' };
    return { ok: true, product: product, parsed: parsed, store: 'mango' };
  }

  var parsed = parseUniqloUrl(url);
  if (!parsed) return { error: 'Invalid product URL' };
  var product = fetchUniqloProduct(parsed.productCode, parsed.region, parsed.colorCode, parsed.priceGroup);
  if (!product) return { error: 'Product not found' };
  return { ok: true, product: product, parsed: parsed, store: 'uniqlo' };
}

function apiAddProduct(data) {
  var chatId = data.chatId;
  if (!chatId) return { error: 'Connect Telegram first' };
  var store = data.store || 'uniqlo';

  if (store === 'arket') return apiAddArketProduct(data);
  if (store === 'cos') return apiAddCosProduct(data);
  if (store === 'mango') return apiAddMangoProduct(data);

  if (isAlreadyWatching(chatId, data.productCode, data.colorCode)) return { error: 'Already watching this' };
  var product = fetchUniqloProduct(data.productCode, data.region, data.colorCode, '00');
  if (!product) return { error: 'Could not fetch product' };
  var imageUrl = getImageForColor(product, data.colorCode);
  var productUrl = buildProductUrl(data.productCode, data.region, data.colorCode, data.sizeCode);
  var id = addProduct(chatId, {
    product_code: data.productCode, color_code: data.colorCode || '', color_name: data.colorName || '',
    size_code: data.sizeCode || '', name: product.name, image_url: imageUrl || product.mainImage || '',
    product_url: productUrl, initial_price: product.currentPrice, last_price: product.currentPrice,
    lowest_price: product.currentPrice, target_price: data.targetPrice || '',
    currency: product.currency || 'EUR', region: data.region || 'es', store: 'uniqlo'
  });
  addPriceHistory(data.productCode, data.region, product.currentPrice, product.onSale);
  return { ok: true, id: id, name: product.name, price: product.currentPrice };
}

function apiAddArketProduct(data) {
  var chatId = data.chatId;
  if (isAlreadyWatching(chatId, data.productCode, data.colorCode)) return { error: 'Already watching this' };

  var url = data.productUrl || '';
  if (!url) return { error: 'Missing product URL' };

  var productName = data.productName || '';
  var productPrice = parseFloat(data.productPrice) || 0;
  var productCurrency = data.productCurrency || 'GBP';
  var productImage = data.productImage || '';

  if (productName && productPrice > 0) {
    var id = addProduct(chatId, {
      product_code: data.productCode, color_code: data.colorCode || '', color_name: data.colorName || '',
      size_code: data.sizeCode || '', name: productName, image_url: productImage,
      product_url: url, initial_price: productPrice, last_price: productPrice,
      lowest_price: productPrice, target_price: data.targetPrice || '',
      currency: productCurrency, region: data.region || 'en-gb', store: 'arket'
    });
    addPriceHistory(data.productCode, data.region, productPrice, false);
    return { ok: true, id: id, name: productName, price: productPrice };
  }

  var product = fetchArketProductFromUrl(url);
  if (!product) return { error: 'Could not fetch ARKET product' };
  var imageUrl = getArketImageForColor(product, data.colorCode);
  var id = addProduct(chatId, {
    product_code: data.productCode, color_code: data.colorCode || '', color_name: data.colorName || '',
    size_code: data.sizeCode || '', name: product.name, image_url: imageUrl || product.mainImage || '',
    product_url: url, initial_price: product.currentPrice, last_price: product.currentPrice,
    lowest_price: product.currentPrice, target_price: data.targetPrice || '',
    currency: product.currency || 'GBP', region: data.region || 'en-gb', store: 'arket'
  });
  addPriceHistory(data.productCode, data.region, product.currentPrice, product.onSale);
  return { ok: true, id: id, name: product.name, price: product.currentPrice };
}

function apiAddCosProduct(data) {
  var chatId = data.chatId;
  if (isAlreadyWatching(chatId, data.productCode, data.colorCode)) return { error: 'Already watching this' };

  var url = data.productUrl || '';
  if (!url) return { error: 'Missing product URL' };

  var productName = data.productName || '';
  var productPrice = parseFloat(data.productPrice) || 0;
  var productCurrency = data.productCurrency || 'GBP';
  var productImage = data.productImage || '';

  if (productName && productPrice > 0) {
    var id = addProduct(chatId, {
      product_code: data.productCode, color_code: data.colorCode || '', color_name: data.colorName || '',
      size_code: data.sizeCode || '', name: productName, image_url: productImage,
      product_url: url, initial_price: productPrice, last_price: productPrice,
      lowest_price: productPrice, target_price: data.targetPrice || '',
      currency: productCurrency, region: data.region || 'en-gb', store: 'cos'
    });
    addPriceHistory(data.productCode, data.region, productPrice, false);
    return { ok: true, id: id, name: productName, price: productPrice };
  }

  var product = fetchCosProductFromUrl(url);
  if (!product) return { error: 'Could not fetch COS product' };
  var imageUrl = getCosImageForColor(product, data.colorCode);
  var id = addProduct(chatId, {
    product_code: data.productCode, color_code: data.colorCode || '', color_name: data.colorName || '',
    size_code: data.sizeCode || '', name: product.name, image_url: imageUrl || product.mainImage || '',
    product_url: url, initial_price: product.currentPrice, last_price: product.currentPrice,
    lowest_price: product.currentPrice, target_price: data.targetPrice || '',
    currency: product.currency || 'GBP', region: data.region || 'en-gb', store: 'cos'
  });
  addPriceHistory(data.productCode, data.region, product.currentPrice, product.onSale);
  return { ok: true, id: id, name: product.name, price: product.currentPrice };
}

function apiAddMangoProduct(data) {
  var chatId = data.chatId;
  if (isAlreadyWatching(chatId, data.productCode, data.colorCode)) return { error: 'Already watching this' };

  var url = data.productUrl || '';
  if (!url) return { error: 'Missing product URL' };

  var productName = data.productName || '';
  var productPrice = parseFloat(data.productPrice) || 0;
  var productCurrency = data.productCurrency || 'EUR';
  var productImage = data.productImage || '';

  if (productName && productPrice > 0) {
    var id = addProduct(chatId, {
      product_code: data.productCode, color_code: data.colorCode || '', color_name: data.colorName || '',
      size_code: data.sizeCode || '', name: productName, image_url: productImage,
      product_url: url, initial_price: productPrice, last_price: productPrice,
      lowest_price: productPrice, target_price: data.targetPrice || '',
      currency: productCurrency, region: data.region || 'es-es', store: 'mango'
    });
    addPriceHistory(data.productCode, data.region, productPrice, false);
    return { ok: true, id: id, name: productName, price: productPrice };
  }

  var product = fetchMangoProductFromUrl(url);
  if (!product) return { error: 'Could not fetch Mango product' };
  var imageUrl = getMangoImageForColor(product, data.colorCode);
  var id = addProduct(chatId, {
    product_code: data.productCode, color_code: data.colorCode || '', color_name: data.colorName || '',
    size_code: data.sizeCode || '', name: product.name, image_url: imageUrl || product.mainImage || '',
    product_url: url, initial_price: product.currentPrice, last_price: product.currentPrice,
    lowest_price: product.currentPrice, target_price: data.targetPrice || '',
    currency: product.currency || 'EUR', region: data.region || 'es-es', store: 'mango'
  });
  addPriceHistory(data.productCode, data.region, product.currentPrice, product.onSale);
  return { ok: true, id: id, name: product.name, price: product.currentPrice };
}

function apiUpdateProduct(params) {
  if (!params.cid || !params.pid) return { error: 'Missing data' };
  var store = params.store || 'uniqlo';
  var imageUrl = '';
  var productUrl = '';

  if (store === 'arket' || store === 'cos' || store === 'mango') {
    imageUrl = params.pimg || '';
    productUrl = params.purl || '';
  } else {
    var product = null;
    if (params.pc) product = fetchUniqloProduct(params.pc, params.rg || 'es', params.cc, '00');
    if (product && params.cc) imageUrl = getImageForColor(product, params.cc);
    if (params.pc) productUrl = buildProductUrl(params.pc, params.rg || 'es', params.cc, params.sc);
  }

  var data = {};
  if (params.cc !== undefined) data.color_code = params.cc;
  if (params.cn !== undefined) data.color_name = params.cn;
  if (params.sc !== undefined) data.size_code = params.sc;
  if (params.tp !== undefined) data.target_price = params.tp;
  if (imageUrl) data.image_url = imageUrl;
  if (productUrl) data.product_url = productUrl;

  var ok = updateProduct(params.pid, params.cid, data);
  return ok ? { ok: true } : { error: 'Product not found' };
}

function apiGetProducts(chatId) {
  if (!chatId) return [];
  return getUserProducts(chatId);
}

function apiRemoveProduct(pid, chatId) {
  if (!pid || !chatId) return { error: 'Missing data' };
  var ok = removeProductById(pid, chatId);
  return ok ? { ok: true } : { error: 'Product not found' };
}

function apiTestTelegram(chatId) {
  if (!chatId) return { error: 'Enter your Chat ID' };
  ensureUser(chatId, '', '');
  var r = sendMessage(chatId, '✅ *dropping* connected!\n\nYou will receive price drop alerts here.');
  if (r && r.ok) {
    var secret = getUserSecret(chatId);
    return { ok: true, secret: secret };
  }
  return { error: 'Could not send message. Check your Chat ID and make sure you messaged the bot first.' };
}

function apiGetSettings(chatId) {
  if (!chatId) return {};
  var u = getUser(chatId);
  return u || {};
}

function apiSaveSettings(chatId, data) {
  if (!chatId) return { error: 'Not connected' };
  if (data.sizeTops) updateUser(chatId, 'size_tops', data.sizeTops);
  if (data.sizeBottoms) updateUser(chatId, 'size_bottoms', data.sizeBottoms);
  if (data.region) updateUser(chatId, 'region', data.region);
  return { ok: true };
}
/* ============================
   SALE ALERT API HANDLERS
   ============================ */

function apiGetSaleSettings(chatId) {
  if (!chatId) return { error: 'Not connected' };
  return getSaleAlertSettings(chatId);
}

function apiSaveSaleSettings(chatId, enabled, prefs) {
  if (!chatId) return { error: 'Not connected' };
  var ok = setSaleAlerts(chatId, enabled, prefs || {});
  return ok ? { ok: true } : { error: 'User not found' };
}
function apiPushPrices(chatId, priceData) {
  if (!chatId || !priceData || !Array.isArray(priceData)) return { error: 'Invalid data' };

  var products = getUserProducts(chatId);
  var updates = [];
  var drops = [];

  for (var i = 0; i < priceData.length; i++) {
    var pd = priceData[i];
    if (!pd.productCode || !pd.price || pd.price <= 0) continue;

    for (var j = 0; j < products.length; j++) {
      var p = products[j];
      if (p.product_code !== pd.productCode) continue;

      var op = parseFloat(p.last_price) || 0;
      var np = parseFloat(pd.price);
      var lp = Math.min(parseFloat(p.lowest_price) || 9999, np);

      updates.push({ id: p.id, price: np, lowest: lp, lastChecked: new Date().toISOString() });

      if (np < op && np > 0) {
        var hasTarget = p.target_price && parseFloat(p.target_price) > 0;
        var meetsTarget = !hasTarget || np <= parseFloat(p.target_price);
        if (meetsTarget) {
          drops.push({ watcher: p, oldPrice: op, newPrice: np, lowest: lp });
        }
      }
    }
  }

  if (updates.length > 0) {
    batchUpdatePrices(updates);
  }

  for (var d = 0; d < drops.length; d++) {
    try {
      sendDrop(drops[d].watcher, drops[d].oldPrice, drops[d].newPrice, drops[d].lowest);
    } catch (e) {
      Logger.log('Push notification failed: ' + e);
    }
  }

  return { ok: true, updated: updates.length, drops: drops.length };
}