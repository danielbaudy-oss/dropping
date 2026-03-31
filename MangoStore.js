/* ============================
   MANGO STORE
   - Pure SPA — no server-rendered data
   - 3 API endpoints: product, prices, stock
   - All behind Akamai — proxy pattern like ARKET/COS
   ============================ */

var MANGO_API_BASE = 'https://online-orchestrator.mango.com';
var MANGO_ASSETS = 'https://shop.mango.com';

var MANGO_CURRENCY_MAP = {
  'ES': { code: 'EUR', symbol: '€' },
  'DE': { code: 'EUR', symbol: '€' },
  'FR': { code: 'EUR', symbol: '€' },
  'IT': { code: 'EUR', symbol: '€' },
  'PT': { code: 'EUR', symbol: '€' },
  'NL': { code: 'EUR', symbol: '€' },
  'BE': { code: 'EUR', symbol: '€' },
  'AT': { code: 'EUR', symbol: '€' },
  'GB': { code: 'GBP', symbol: '£' },
  'US': { code: 'USD', symbol: '$' },
  'SE': { code: 'SEK', symbol: 'kr' },
  'DK': { code: 'DKK', symbol: 'kr' },
  'NO': { code: 'NOK', symbol: 'kr' },
  'PL': { code: 'PLN', symbol: 'zł' },
  'CH': { code: 'CHF', symbol: 'CHF' }
};

/* ============================
   URL PARSING
   ============================ */

function parseMangoUrl(url) {
  try {
    // https://shop.mango.com/es/es/p/hombre/polos/manga-corta/polo-pique-slim-fit_27076711?c=01
    var m = url.match(/shop\.mango\.com\/([a-z]{2})\/([a-z]{2})\/.*?_(\d{8,})(?:\?|$)/i);
    if (!m) {
      // Try alternate format
      m = url.match(/shop\.mango\.com\/([a-z]{2})\/([a-z]{2})\/.*?(\d{8,})/i);
    }
    if (!m) return null;

    var countryIso = m[1].toUpperCase();
    var langIso = m[2];
    var productId = m[3];

    // Extract color from ?c= parameter
    var colorMatch = url.match(/[?&]c=([^&]+)/i);
    var colorCode = colorMatch ? colorMatch[1] : '';

    // Extract slug for URL reconstruction
    var slugMatch = url.match(/\/p\/(.+?)(?:\?|$)/);
    var slug = slugMatch ? slugMatch[1] : '';

    return {
      productCode: productId,
      productId: productId,
      slug: slug,
      countryIso: countryIso,
      langIso: langIso,
      languageMarket: langIso + '-' + countryIso.toLowerCase(),
      region: langIso + '-' + countryIso.toLowerCase(),
      colorCode: colorCode,
      priceGroup: '00',
      store: 'mango'
    };
  } catch (e) {
    Logger.log('parseMangoUrl error: ' + e);
    return null;
  }
}

/* ============================
   API FETCHING (via proxy for backend)
   ============================ */

function fetchMangoApiViaProxy(apiUrl) {
  // Try direct first (will likely fail — Akamai)
  try {
    var r = UrlFetchApp.fetch(apiUrl, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Origin': 'https://shop.mango.com',
        'Referer': 'https://shop.mango.com/'
      }
    });
    if (r.getResponseCode() === 200) {
      var text = r.getContentText();
      if (text.length > 5 && text.indexOf('Access Denied') === -1) {
        return JSON.parse(text);
      }
    }
  } catch (e) {}

  // Try proxies
  var proxies = [
    function(u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function(u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); },
    function(u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); }
  ];

  for (var i = 0; i < proxies.length; i++) {
    try {
      var proxyUrl = proxies[i](apiUrl);
      var r2 = UrlFetchApp.fetch(proxyUrl, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json,*/*'
        }
      });
      if (r2.getResponseCode() === 200) {
        var text2 = r2.getContentText();
        if (text2.length > 5 && text2.indexOf('Access Denied') === -1 && text2.indexOf('Server-side requests') === -1) {
          return JSON.parse(text2);
        }
      }
    } catch (e) {}
    Utilities.sleep(300);
  }

  return null;
}

function buildMangoProductApiUrl(productId, countryIso, langIso) {
  return MANGO_API_BASE + '/v4/products?channelId=shop&countryIso=' + countryIso + '&languageIso=' + langIso + '&productId=' + productId;
}

function buildMangoPriceApiUrl(productId, countryIso) {
  return MANGO_API_BASE + '/v3/prices/products?channelId=shop&countryIso=' + countryIso + '&productId=' + productId;
}

function buildMangoStockApiUrl(productId, countryIso) {
  return MANGO_API_BASE + '/v3/stock/products?countryIso=' + countryIso + '&channelId=shop&productId=' + productId;
}

/* ============================
   NORMALISE PRODUCT
   ============================ */

function normaliseMangoProduct(productData, priceData, stockData, parsed) {
  var countryIso = parsed.countryIso || 'ES';
  var curInfo = MANGO_CURRENCY_MAP[countryIso] || { code: 'EUR', symbol: '€' };

  var name = productData.name || 'Unknown';
  var productId = productData.reference || parsed.productId;

  var colorMap = {};
  var sizeSet = {};
  var allPrices = [];

  var prodColors = productData.colors || [];
  for (var c = 0; c < prodColors.length; c++) {
    var pc = prodColors[c];
    var colorId = pc.id || '';
    var colorName = pc.label || '';

    // Get image
    var image = '';
    if (pc.looks) {
      var lookKeys = Object.keys(pc.looks);
      if (lookKeys.length > 0) {
        var firstLook = pc.looks[lookKeys[0]];
        if (firstLook.images) {
          var imgKeys = Object.keys(firstLook.images);
          if (imgKeys.length > 0 && firstLook.images[imgKeys[0]].img) {
            image = MANGO_ASSETS + firstLook.images[imgKeys[0]].img;
          }
        }
      }
    }

    // Get price for this color
    var colorPrice = 0;
    var colorBasePrice = 0;
    var onSale = false;
    if (priceData && priceData[colorId]) {
      colorPrice = priceData[colorId].price || 0;
      colorBasePrice = priceData[colorId].crossedOutPrice || colorPrice;
      onSale = priceData[colorId].starPrice === true || colorBasePrice > colorPrice;
    }
    if (colorPrice > 0) allPrices.push(colorPrice);

    // Get stock for this color
    var stockForColor = {};
    if (stockData && stockData.colors && stockData.colors[colorId]) {
      stockForColor = stockData.colors[colorId].sizes || {};
    }

    // Build sizes
    var sizes = [];
    var prodSizes = pc.sizes || [];
    for (var s = 0; s < prodSizes.length; s++) {
      var ps = prodSizes[s];
      var sizeId = ps.id || '';
      var sizeName = ps.label || ps.shortDescription || sizeId;
      sizeSet[sizeName] = true;

      var inStock = true;
      if (stockForColor[sizeId]) {
        inStock = stockForColor[sizeId].available !== false;
      }

      sizes.push({
        sizeCode: sizeName,
        sizeName: sizeName,
        sizeId: sizeId,
        currentPrice: colorPrice,
        basePrice: colorBasePrice,
        onSale: onSale,
        inStock: inStock,
        currency: curInfo.code,
        currencySymbol: curInfo.symbol
      });
    }

    colorMap[colorId] = {
      code: colorId,
      name: colorName,
      hex: pc.rgb || '',
      image: image,
      sizes: sizes,
      available: sizes.some(function(sz) { return sz.inStock; })
    };
  }

  var colors = Object.keys(colorMap).map(function(k) { return colorMap[k]; });
  colors.sort(function(a, b) {
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;
    return 0;
  });

  var sizes = Object.keys(sizeSet).map(function(k) { return { code: k, name: k }; });
  var currentPrice = allPrices.length > 0 ? Math.min.apply(null, allPrices) : 0;
  var originalPrice = currentPrice;
  if (priceData) {
    var keys = Object.keys(priceData);
    for (var p = 0; p < keys.length; p++) {
      var cp = priceData[keys[p]].crossedOutPrice || priceData[keys[p]].price || 0;
      if (cp > originalPrice) originalPrice = cp;
    }
  }

  var mainImage = colors.length > 0 ? colors[0].image : '';
  var cat = detectCategory(name);

  return {
    productCode: productId,
    name: name,
    image: mainImage,
    category: cat,
    currentPrice: currentPrice,
    originalPrice: originalPrice,
    onSale: currentPrice < originalPrice,
    currency: curInfo.code,
    currencySymbol: curInfo.symbol,
    colors: colors,
    sizes: sizes,
    region: parsed.region,
    mainImage: mainImage,
    store: 'mango'
  };
}

/* ============================
   BACKEND PRODUCT FETCH
   ============================ */

function fetchMangoProductFromUrl(url) {
  var parsed = parseMangoUrl(url);
  if (!parsed) return null;

  Logger.log('MANGO backend: fetching — ' + parsed.productId);

  var productData = fetchMangoApiViaProxy(buildMangoProductApiUrl(parsed.productId, parsed.countryIso, parsed.langIso));
  if (!productData) {
    Logger.log('MANGO backend: product API failed');
    return null;
  }

  var priceData = fetchMangoApiViaProxy(buildMangoPriceApiUrl(parsed.productId, parsed.countryIso));
  var stockData = fetchMangoApiViaProxy(buildMangoStockApiUrl(parsed.productId, parsed.countryIso));

  Logger.log('MANGO backend: product=' + (productData ? 'yes' : 'no') + ' prices=' + (priceData ? 'yes' : 'no') + ' stock=' + (stockData ? 'yes' : 'no'));

  return normaliseMangoProduct(productData, priceData, stockData, parsed);
}

/* ============================
   ACCEPT FRONTEND-PARSED DATA
   ============================ */

function apiPreviewMangoFromClientData(clientProduct, url) {
  var parsed = parseMangoUrl(url);
  if (!parsed) return { error: 'Invalid Mango URL' };
  if (!clientProduct || !clientProduct.name) return { error: 'Invalid product data' };

  clientProduct.productCode = parsed.productCode;
  clientProduct.region = parsed.region;
  clientProduct.store = 'mango';

  return {
    ok: true,
    product: clientProduct,
    parsed: parsed,
    store: 'mango'
  };
}

/* ============================
   PRICE CHECKER
   ============================ */

function fetchMangoCurrentPrice(productUrl) {
  if (!productUrl) return null;
  if (productUrl.indexOf('http') !== 0) productUrl = 'https://shop.mango.com' + productUrl;

  var parsed = parseMangoUrl(productUrl);
  if (!parsed) return null;

  Logger.log('MANGO price check: ' + parsed.productId + ' (' + parsed.countryIso + ')');

  // Fetch prices (smallest payload — most likely to succeed through proxy)
  var priceData = fetchMangoApiViaProxy(buildMangoPriceApiUrl(parsed.productId, parsed.countryIso));
  if (!priceData) {
    Logger.log('MANGO: price API failed');
    return null;
  }

  // Fetch stock
  var stockData = fetchMangoApiViaProxy(buildMangoStockApiUrl(parsed.productId, parsed.countryIso));

  // Build result
  var colors = [];
  var allPrices = [];
  var priceKeys = Object.keys(priceData);

  for (var i = 0; i < priceKeys.length; i++) {
    var colorId = priceKeys[i];
    var colorPrice = priceData[colorId].price || 0;
    var colorBase = priceData[colorId].crossedOutPrice || colorPrice;
    if (colorPrice > 0) allPrices.push(colorPrice);

    var sizes = [];
    if (stockData && stockData.colors && stockData.colors[colorId]) {
      var stockSizes = stockData.colors[colorId].sizes || {};
      var sizeKeys = Object.keys(stockSizes);
      for (var s = 0; s < sizeKeys.length; s++) {
        sizes.push({
          sizeCode: sizeKeys[s],
          currentPrice: colorPrice,
          basePrice: colorBase,
          inStock: stockSizes[sizeKeys[s]].available !== false
        });
      }
    }

    colors.push({ code: colorId, sizes: sizes });
  }

  var lo = allPrices.length > 0 ? Math.min.apply(null, allPrices) : 0;
  var hi = lo;
  for (var j = 0; j < priceKeys.length; j++) {
    var bp = priceData[priceKeys[j]].crossedOutPrice || priceData[priceKeys[j]].price || 0;
    if (bp > hi) hi = bp;
  }

  return { currentPrice: lo, originalPrice: hi, onSale: lo < hi, colors: colors };
}

/* ============================
   UTILITIES
   ============================ */

function getMangoImageForColor(product, colorCode) {
  if (!product || !product.colors || !colorCode) return product ? product.mainImage : '';
  for (var i = 0; i < product.colors.length; i++) {
    if (product.colors[i].code === colorCode && product.colors[i].image) return product.colors[i].image;
  }
  return product.mainImage || '';
}

function getMangoSkuInfo(priceResult, colorCode, sizeCode) {
  if (!priceResult || !priceResult.colors) return null;
  for (var c = 0; c < priceResult.colors.length; c++) {
    var col = priceResult.colors[c];
    if (col.code === String(colorCode)) {
      // Mango sizes in stock API use numeric IDs, but we store label names
      // Try exact match first, then any size with matching price
      for (var s = 0; s < col.sizes.length; s++) {
        if (col.sizes[s].sizeCode === String(sizeCode)) {
          return { price: col.sizes[s].currentPrice, inStock: col.sizes[s].inStock };
        }
      }
      // If size code is a label (S, M, L), we can't match to numeric ID from price checker
      // Return the color-level price instead
      if (col.sizes.length > 0) {
        return { price: col.sizes[0].currentPrice, inStock: true };
      }
    }
  }
  return null;
}

function buildMangoProductUrl(parsed) {
  return 'https://shop.mango.com/' + parsed.countryIso.toLowerCase() + '/' + parsed.langIso + '/p/' + parsed.slug;
}