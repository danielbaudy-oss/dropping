/* ============================
   ARKET STORE
   - Frontend fetches via CORS proxy (browser not blocked)
   - Backend tries direct fetch first, then proxy fallbacks
   ============================ */

var ARKET_CURRENCY_MAP = {
  'en-gb': { code: 'GBP', symbol: '£' },
  'en-dk': { code: 'DKK', symbol: 'kr' },
  'en-se': { code: 'SEK', symbol: 'kr' },
  'sv-se': { code: 'SEK', symbol: 'kr' },
  'en-no': { code: 'NOK', symbol: 'kr' },
  'de-de': { code: 'EUR', symbol: '€' },
  'de-at': { code: 'EUR', symbol: '€' },
  'de-ch': { code: 'CHF', symbol: 'CHF' },
  'en-ch': { code: 'CHF', symbol: 'CHF' },
  'fr-ch': { code: 'CHF', symbol: 'CHF' },
  'fr-fr': { code: 'EUR', symbol: '€' },
  'it-it': { code: 'EUR', symbol: '€' },
  'es-es': { code: 'EUR', symbol: '€' },
  'en-nl': { code: 'EUR', symbol: '€' },
  'pl-pl': { code: 'PLN', symbol: 'zł' },
  'en-eu': { code: 'EUR', symbol: '€' }
};

/* User agents to rotate */
var BACKEND_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'
];

/* ============================
   URL PARSING
   ============================ */

function parseArketUrl(url) {
  try {
    var m = url.match(/arket\.com\/([a-z]{2}-[a-z]{2})\/product\/([^\/?#]+)/i);
    if (!m) return null;

    var languageMarket = m[1].toLowerCase();
    var slug = m[2].replace(/\/$/, '').replace(/\.html$/, '');

    var skuMatch = slug.match(/(\d{10})$/);
    if (!skuMatch) return null;

    var fullSku = skuMatch[1];
    var productSku = fullSku.substring(0, 7);

    return {
      productCode: fullSku,
      productSku: productSku,
      slug: slug,
      languageMarket: languageMarket,
      region: languageMarket,
      colorCode: fullSku,
      priceGroup: '00',
      store: 'arket'
    };
  } catch (e) {
    Logger.log('parseArketUrl error: ' + e);
    return null;
  }
}

/* ============================
   SMART FETCHING — direct first, then proxies
   ============================ */

function hmGroupFetch(url, storeName) {
  // Strategy 1: Direct fetch from Google's servers
  var html = directFetch(url, storeName);
  if (html) return html;

  // Strategy 2: Try proxy services
  html = proxyFetch(url, storeName);
  if (html) return html;

  Logger.log(storeName + ': all fetch strategies failed for ' + url);
  return null;
}

function directFetch(url, storeName) {
  var ua = BACKEND_USER_AGENTS[Math.floor(Math.random() * BACKEND_USER_AGENTS.length)];
  try {
    Logger.log(storeName + ' direct: fetching...');
    var r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    var code = r.getResponseCode();
    Logger.log(storeName + ' direct: HTTP ' + code);
    if (code === 200) {
      var text = r.getContentText();
      if (text && text.length > 1000 && text.indexOf('Access Denied') === -1) {
        Logger.log(storeName + ' direct: got ' + text.length + ' chars ✅');
        return text;
      }
      Logger.log(storeName + ' direct: response too short or blocked (' + text.length + ' chars)');
    }
  } catch (e) {
    Logger.log(storeName + ' direct: error — ' + e);
  }
  return null;
}

function proxyFetch(url, storeName) {
  var proxies = [
    function(u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function(u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); },
    function(u) { return 'https://thingproxy.freeboard.io/fetch/' + u; },
    function(u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); }
  ];

  for (var i = 0; i < proxies.length; i++) {
    var proxyUrl = proxies[i](url);
    try {
      Logger.log(storeName + ' proxy ' + i + ': fetching...');
      var r = UrlFetchApp.fetch(proxyUrl, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': BACKEND_USER_AGENTS[Math.floor(Math.random() * BACKEND_USER_AGENTS.length)],
          'Accept': 'text/html,application/json,*/*'
        }
      });
      var code = r.getResponseCode();
      Logger.log(storeName + ' proxy ' + i + ': HTTP ' + code);
      if (code === 200) {
        var text = r.getContentText();
        if (text && text.length > 1000 && text.indexOf('Access Denied') === -1 && text.indexOf('Server-side requests are not allowed') === -1) {
          Logger.log(storeName + ' proxy ' + i + ': got ' + text.length + ' chars ✅');
          return text;
        }
        Logger.log(storeName + ' proxy ' + i + ': blocked or empty (' + text.length + ' chars)');
      }
    } catch (e) {
      Logger.log(storeName + ' proxy ' + i + ': error — ' + e);
    }
    Utilities.sleep(500);
  }
  return null;
}

/* Legacy function name used by CosStore.js */
function arketProxyFetch(url) {
  return hmGroupFetch(url, 'ARKET/COS');
}

/* ============================
   EXTRACT DATA FROM HTML
   ============================ */

function extractNextData(html) {
  try {
    var match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    var data = JSON.parse(match[1]);
    return data.props ? (data.props.pageProps || null) : (data.pageProps || null);
  } catch (e) { return null; }
}

function findProductInPageProps(pageProps) {
  if (!pageProps) return null;

  if (pageProps.blocks) {
    for (var i = 0; i < pageProps.blocks.length; i++) {
      if (pageProps.blocks[i].product) return { product: pageProps.blocks[i].product, pageProps: pageProps };
    }
  }
  if (pageProps.product) return { product: pageProps.product, pageProps: pageProps };
  if (pageProps.productData) return { product: pageProps.productData, pageProps: pageProps };

  function findDeep(obj, depth) {
    if (!obj || depth > 5 || typeof obj !== 'object') return null;
    if (obj.sku && obj.name && (obj.items || obj.priceAsNumber !== undefined)) return obj;
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var found = findDeep(obj[keys[k]], depth + 1);
      if (found) return found;
    }
    return null;
  }

  var deep = findDeep(pageProps, 0);
  if (deep) return { product: deep, pageProps: pageProps };
  return null;
}

function extractJsonLd(html) {
  try {
    var re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      try {
        var data = JSON.parse(match[1]);
        if (Array.isArray(data)) {
          for (var i = 0; i < data.length; i++) {
            if (data[i]['@type'] === 'Product') return data[i];
          }
        } else if (data['@type'] === 'Product') return data;
      } catch (e) {}
    }
    return null;
  } catch (e) { return null; }
}

function extractFromMetaTags(html, parsed) {
  var langMarket = parsed.languageMarket || 'en-gb';
  var curInfo = ARKET_CURRENCY_MAP[langMarket] || { code: 'EUR', symbol: '€' };

  var name = extractMeta(html, 'og:title');
  if (name) name = name.replace(/\s*[-|]\s*ARKET$/i, '').trim();
  else name = 'Unknown';

  var mainImage = extractMeta(html, 'og:image') || '';
  var priceStr = extractMeta(html, 'product:price:amount');
  var currentPrice = priceStr ? (parseFloat(priceStr) || 0) : 0;
  var currency = extractMeta(html, 'product:price:currency') || curInfo.code;
  curInfo = getCurrencyInfo(currency, curInfo);

  if (name === 'Unknown' || currentPrice === 0) return null;

  var sizeNames = extractSizesFromHtml(html);
  var sizes = [];
  var colorSizes = [];
  for (var s = 0; s < sizeNames.length; s++) {
    sizes.push({ code: sizeNames[s], name: sizeNames[s] });
    colorSizes.push({
      sizeCode: sizeNames[s], sizeName: sizeNames[s],
      currentPrice: currentPrice, basePrice: currentPrice,
      onSale: false, inStock: true, currency: currency, currencySymbol: curInfo.symbol
    });
  }

  var cat = detectCategory(name);

  return {
    productCode: parsed.productCode, name: name, image: mainImage, category: cat,
    currentPrice: currentPrice, originalPrice: currentPrice, onSale: false,
    currency: currency, currencySymbol: curInfo.symbol,
    colors: [{ code: parsed.productCode, name: '', hex: '', image: mainImage, sizes: colorSizes, available: true }],
    sizes: sizes, region: parsed.languageMarket, mainImage: mainImage, store: 'arket'
  };
}

function extractMeta(html, property) {
  var re1 = new RegExp('<meta[^>]*property="' + property + '"[^>]*content="([^"]*)"', 'i');
  var re2 = new RegExp('<meta[^>]*content="([^"]*)"[^>]*property="' + property + '"', 'i');
  var m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

function extractSizesFromHtml(html) {
  var sizes = [], seen = {}, m;
  var re1 = /data-size[=]["']([^"']+)["']/gi;
  while ((m = re1.exec(html)) !== null) { if (!seen[m[1]]) { seen[m[1]] = true; sizes.push(m[1]); } }
  if (sizes.length > 0) return sizes;
  var re2 = /(?:>|\b)(XXS|XS|S|M|L|XL|XXL|3XL|ONE SIZE)(?:<|\b)/g;
  while ((m = re2.exec(html)) !== null) { if (!seen[m[1]]) { seen[m[1]] = true; sizes.push(m[1]); } }
  if (sizes.length > 0) return sizes;
  return ['XS', 'S', 'M', 'L', 'XL'];
}

function detectCategory(name) {
  return (name || '').toLowerCase().match(/pant|jean|trouser|short|chino|skirt|jogger/) ? 'bottoms' : 'tops';
}

function getCurrencyInfo(code, fallback) {
  var map = { 'GBP': '£', 'EUR': '€', 'USD': '$', 'SEK': 'kr', 'DKK': 'kr', 'NOK': 'kr', 'CHF': 'CHF', 'PLN': 'zł', 'CAD': '$', 'AUD': '$' };
  return { code: code, symbol: map[code] || (fallback ? fallback.symbol : '€') };
}

/* ============================
   NORMALISE PRODUCT
   ============================ */

function normaliseArketProduct(prod, parsed, pageProps) {
  var langMarket = parsed.languageMarket || 'en-gb';
  var curInfo = ARKET_CURRENCY_MAP[langMarket] || { code: 'EUR', symbol: '€' };

  if (pageProps && pageProps.localizationContext && pageProps.localizationContext.currency) {
    curInfo = getCurrencyInfo(pageProps.localizationContext.currency, curInfo);
  }

  var allVariants = [prod];
  var relatedVariants = (prod.relatedProducts || []).filter(function (rp) {
    return rp.relation === 'variant';
  });
  allVariants = allVariants.concat(relatedVariants);

  var colorMap = {}, sizeSet = {};

  for (var v = 0; v < allVariants.length; v++) {
    var vr = allVariants[v];
    var sku = vr.sku || vr.var_number_key || '';
    var colorName = vr.variantName || vr.var_pdp_color_desc || '';
    var colorHex = (vr.var_color && vr.var_color.hex) || (vr.var_colour_details_desc) || '';
    var image = (vr.media && vr.media.standard && vr.media.standard[0]) || '';
    var vrPrice = vr.priceAsNumber || 0;
    var vrBase = vr.priceBeforeDiscountAsNumber || vrPrice;
    var vrOnSale = vr.discountPercent > 0 || vrPrice < vrBase;

    var sizes = [];
    var items = vr.items || [];
    for (var s = 0; s < items.length; s++) {
      var it = items[s];
      var sizeName = it.name || '';
      sizeSet[sizeName] = true;
      sizes.push({
        sizeCode: sizeName, sizeName: sizeName,
        currentPrice: vrPrice, basePrice: vrBase,
        onSale: vrOnSale, inStock: it.stock !== 'no',
        currency: curInfo.code, currencySymbol: curInfo.symbol
      });
    }

    colorMap[sku] = {
      code: sku, name: colorName, hex: colorHex,
      image: image, sizes: sizes, available: vr.available !== false
    };
  }

  var colors = Object.keys(colorMap).map(function (k) { return colorMap[k]; });
  colors.sort(function (a, b) {
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;
    return 0;
  });

  var sizes = Object.keys(sizeSet).map(function (k) { return { code: k, name: k }; });
  var currentPrice = prod.priceAsNumber || 0;
  var originalPrice = prod.priceBeforeDiscountAsNumber || currentPrice;
  var mainImage = (prod.media && prod.media.standard && prod.media.standard[0]) || '';
  var cat = detectCategory(prod.name || '');

  return {
    productCode: parsed.productCode, name: prod.name || 'Unknown',
    image: mainImage, category: cat,
    currentPrice: currentPrice, originalPrice: originalPrice,
    onSale: currentPrice < originalPrice,
    currency: curInfo.code, currencySymbol: curInfo.symbol,
    colors: colors, sizes: sizes,
    region: parsed.languageMarket, mainImage: mainImage, store: 'arket'
  };
}

/* ============================
   BACKEND PRODUCT FETCH
   ============================ */

function fetchArketProductFromUrl(url) {
  var parsed = parseArketUrl(url);
  if (!parsed) return null;

  Logger.log('ARKET backend: fetching — ' + parsed.slug);

  var html = hmGroupFetch(url, 'ARKET');
  if (!html) {
    Logger.log('ARKET backend: fetch failed');
    return null;
  }

  var nextData = extractNextData(html);
  if (nextData) {
    var found = findProductInPageProps(nextData);
    if (found) {
      Logger.log('ARKET backend: product found via __NEXT_DATA__');
      return normaliseArketProduct(found.product, parsed, found.pageProps);
    }
  }

  var jsonLd = extractJsonLd(html);
  if (jsonLd) {
    Logger.log('ARKET backend: product found via JSON-LD');
    return normaliseFromJsonLd(jsonLd, parsed, html);
  }

  var meta = extractFromMetaTags(html, parsed);
  if (meta) {
    Logger.log('ARKET backend: product found via meta tags');
    return meta;
  }

  Logger.log('ARKET backend: all parse strategies failed');
  return null;
}

function normaliseFromJsonLd(jsonLd, parsed, html) {
  var langMarket = parsed.languageMarket || 'en-gb';
  var curInfo = ARKET_CURRENCY_MAP[langMarket] || { code: 'EUR', symbol: '€' };

  var name = jsonLd.name || 'Unknown';
  var mainImage = '';
  if (jsonLd.image) mainImage = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;

  var currentPrice = 0, originalPrice = 0, currency = curInfo.code;
  var offers = jsonLd.offers;
  if (offers) {
    if (Array.isArray(offers)) {
      for (var i = 0; i < offers.length; i++) {
        var op = parseFloat(offers[i].price) || 0;
        if (op > 0 && (currentPrice === 0 || op < currentPrice)) currentPrice = op;
        if (op > originalPrice) originalPrice = op;
        if (offers[i].priceCurrency) currency = offers[i].priceCurrency;
      }
    } else {
      currentPrice = parseFloat(offers.price) || 0;
      originalPrice = currentPrice;
      if (offers.priceCurrency) currency = offers.priceCurrency;
    }
  }
  if (originalPrice === 0) originalPrice = currentPrice;
  curInfo = getCurrencyInfo(currency, curInfo);

  var sizeNames = extractSizesFromHtml(html);
  var sizes = [], colorSizes = [];
  for (var s = 0; s < sizeNames.length; s++) {
    sizes.push({ code: sizeNames[s], name: sizeNames[s] });
    colorSizes.push({
      sizeCode: sizeNames[s], sizeName: sizeNames[s],
      currentPrice: currentPrice, basePrice: originalPrice,
      onSale: currentPrice < originalPrice, inStock: true,
      currency: currency, currencySymbol: curInfo.symbol
    });
  }

  return {
    productCode: parsed.productCode, name: name, image: mainImage,
    category: detectCategory(name),
    currentPrice: currentPrice, originalPrice: originalPrice,
    onSale: currentPrice < originalPrice,
    currency: currency, currencySymbol: curInfo.symbol,
    colors: [{ code: parsed.productCode, name: '', hex: '', image: mainImage, sizes: colorSizes, available: true }],
    sizes: sizes, region: parsed.languageMarket, mainImage: mainImage, store: 'arket'
  };
}

/* ============================
   ACCEPT FRONTEND-PARSED DATA
   ============================ */

function apiPreviewArketFromClientData(clientProduct, url) {
  var parsed = parseArketUrl(url);
  if (!parsed) return { error: 'Invalid ARKET URL' };
  if (!clientProduct || !clientProduct.name) return { error: 'Invalid product data' };

  clientProduct.productCode = parsed.productCode;
  clientProduct.region = parsed.languageMarket;
  clientProduct.store = 'arket';

  return {
    ok: true,
    product: clientProduct,
    parsed: parsed,
    store: 'arket'
  };
}

/* ============================
   PRICE CHECKER
   ============================ */

function fetchArketCurrentPrice(productUrl) {
  if (!productUrl) return null;
  if (productUrl.indexOf('http') !== 0) productUrl = 'https://www.arket.com' + productUrl;

  var parsed = parseArketUrl(productUrl);
  if (!parsed) return null;

  var html = hmGroupFetch(productUrl, 'ARKET');
  if (!html) return null;

  var nextData = extractNextData(html);
  if (nextData) {
    var found = findProductInPageProps(nextData);
    if (found) return extractPriceFromRawProduct(found.product);
  }

  var jsonLd = extractJsonLd(html);
  if (jsonLd) return extractPriceFromJsonLd(jsonLd);

  var meta = extractFromMetaTags(html, parsed);
  if (meta) return { currentPrice: meta.currentPrice, originalPrice: meta.originalPrice, onSale: meta.onSale, colors: meta.colors };

  return null;
}

function extractPriceFromRawProduct(prod) {
  var allVariants = [prod].concat(
    (prod.relatedProducts || []).filter(function (rp) { return rp.relation === 'variant'; })
  );

  var colors = [];
  for (var v = 0; v < allVariants.length; v++) {
    var vr = allVariants[v];
    var sizes = [];
    var items = vr.items || [];
    for (var s = 0; s < items.length; s++) {
      sizes.push({
        sizeCode: items[s].name, inStock: items[s].stock !== 'no',
        currentPrice: vr.priceAsNumber || 0,
        basePrice: vr.priceBeforeDiscountAsNumber || vr.priceAsNumber || 0
      });
    }
    colors.push({ code: vr.sku || vr.var_number_key || '', sizes: sizes });
  }

  var lo = prod.priceAsNumber || 0, hi = prod.priceBeforeDiscountAsNumber || lo;
  for (var c = 0; c < allVariants.length; c++) {
    var p = allVariants[c].priceAsNumber || 0;
    if (p > 0 && p < lo) lo = p;
    var bp = allVariants[c].priceBeforeDiscountAsNumber || 0;
    if (bp > hi) hi = bp;
  }
  return { currentPrice: lo, originalPrice: hi, onSale: lo < hi, colors: colors };
}

function extractPriceFromJsonLd(jsonLd) {
  var currentPrice = 0;
  var offers = jsonLd.offers;
  if (offers) {
    if (Array.isArray(offers)) offers = offers[0];
    currentPrice = parseFloat(offers.price) || 0;
  }
  return { currentPrice: currentPrice, originalPrice: currentPrice, onSale: false, colors: [] };
}

/* ============================
   UTILITIES
   ============================ */

function fetchArketProduct(productCode, region, colorCode) { return null; }

function buildArketProductUrl(parsed) {
  return 'https://www.arket.com/' + (parsed.languageMarket || 'en-gb') + '/product/' + parsed.slug + '/';
}

function getArketImageForColor(product, colorCode) {
  if (!product || !product.colors || !colorCode) return product ? product.mainImage : '';
  for (var i = 0; i < product.colors.length; i++) {
    if (product.colors[i].code === colorCode && product.colors[i].image) return product.colors[i].image;
  }
  return product.mainImage || '';
}

function getArketSkuInfo(priceResult, colorCode, sizeCode) {
  if (!priceResult || !priceResult.colors) return null;
  for (var c = 0; c < priceResult.colors.length; c++) {
    var col = priceResult.colors[c];
    if (col.code === String(colorCode)) {
      for (var s = 0; s < col.sizes.length; s++) {
        if (col.sizes[s].sizeCode === String(sizeCode))
          return { price: col.sizes[s].currentPrice, inStock: col.sizes[s].inStock };
      }
    }
  }
  return null;
}