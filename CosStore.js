/* ============================
   COS STORE
   Same H&M Group platform as ARKET
   - Frontend fetches via CORS proxy
   - Backend price checker uses proxy
   - Stock API is public (bonus)
   ============================ */

var COS_CURRENCY_MAP = {
  'en-gb': { code: 'GBP', symbol: '£' },
  'en-us': { code: 'USD', symbol: '$' },
  'en-ca': { code: 'CAD', symbol: '$' },
  'en-au': { code: 'AUD', symbol: '$' },
  'de-de': { code: 'EUR', symbol: '€' },
  'de-at': { code: 'EUR', symbol: '€' },
  'fr-fr': { code: 'EUR', symbol: '€' },
  'it-it': { code: 'EUR', symbol: '€' },
  'es-es': { code: 'EUR', symbol: '€' },
  'sv-se': { code: 'SEK', symbol: 'kr' },
  'pl-pl': { code: 'PLN', symbol: 'zł' },
  'en-dk': { code: 'DKK', symbol: 'kr' },
  'en-no': { code: 'NOK', symbol: 'kr' },
  'en-nl': { code: 'EUR', symbol: '€' },
  'en-eu': { code: 'EUR', symbol: '€' }
};

/* ============================
   URL PARSING
   ============================ */

function parseCosUrl(url) {
  try {
    var m = url.match(/cos\.com\/([a-z]{2}-[a-z]{2})\/.*?product\/([^\/?#]+)/i);
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
      store: 'cos',
      market: languageMarket.split('-')[1]
    };
  } catch (e) {
    Logger.log('parseCosUrl error: ' + e);
    return null;
  }
}

/* ============================
   NORMALISE PRODUCT (same structure as ARKET)
   ============================ */

function normaliseCosProduct(prod, parsed, pageProps) {
  var langMarket = parsed.languageMarket || 'en-gb';
  var curInfo = COS_CURRENCY_MAP[langMarket] || { code: 'EUR', symbol: '€' };

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
    var sku = vr.sku || '';
    var colorName = vr.variantName || vr.var_pdp_color_desc || '';
    var image = '';
    if (vr.media && vr.media.standard && vr.media.standard.length > 0) {
      image = vr.media.standard[0];
    }
    var vrPrice = vr.priceAsNumber || 0;
    var vrBase = vr.priceBeforeDiscountAsNumber || vrPrice;
    var vrOnSale = (vr.discountPercent > 0) || (vrPrice < vrBase);

    var sizes = [];
    var items = vr.items || [];
    for (var s = 0; s < items.length; s++) {
      var it = items[s];
      var sizeName = it.name || '';
      sizeSet[sizeName] = true;
      sizes.push({
        sizeCode: sizeName,
        sizeName: sizeName,
        currentPrice: vrPrice,
        basePrice: vrBase,
        onSale: vrOnSale,
        inStock: it.stock !== 'no',
        currency: curInfo.code,
        currencySymbol: curInfo.symbol
      });
    }

    colorMap[sku] = {
      code: sku,
      name: colorName,
      hex: '',
      image: image,
      sizes: sizes,
      available: vr.available !== false
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
  var mainImage = '';
  if (prod.media && prod.media.standard && prod.media.standard.length > 0) {
    mainImage = prod.media.standard[0];
  }
  var cat = detectCategory(prod.name || '');

  return {
    productCode: parsed.productCode,
    name: prod.name || 'Unknown',
    image: mainImage,
    category: cat,
    currentPrice: currentPrice,
    originalPrice: originalPrice,
    onSale: currentPrice < originalPrice,
    currency: curInfo.code,
    currencySymbol: curInfo.symbol,
    colors: colors,
    sizes: sizes,
    region: parsed.languageMarket,
    mainImage: mainImage,
    store: 'cos'
  };
}

/* ============================
   BACKEND PRODUCT FETCH (via proxy)
   ============================ */

function fetchCosProductFromUrl(url) {
  var parsed = parseCosUrl(url);
  if (!parsed) return null;

  Logger.log('COS backend: fetching via proxy — ' + parsed.slug);

  // Reuse ARKET's proxy fetch (same proxy list)
  var html = arketProxyFetch(url);
  if (!html) {
    Logger.log('COS backend: proxy fetch failed');
    return null;
  }

  // Try __NEXT_DATA__ (reuse ARKET's extractor — same Next.js structure)
  var nextData = extractNextData(html);
  if (nextData) {
    var found = findProductInPageProps(nextData);
    if (found) {
      Logger.log('COS backend: product found via __NEXT_DATA__');
      return normaliseCosProduct(found.product, parsed, found.pageProps);
    }
  }

  // Try JSON-LD
  var jsonLd = extractJsonLd(html);
  if (jsonLd) {
    Logger.log('COS backend: product found via JSON-LD');
    return normaliseCosFromJsonLd(jsonLd, parsed, html);
  }

  // Try meta tags
  var meta = extractCosFromMetaTags(html, parsed);
  if (meta) {
    Logger.log('COS backend: product found via meta tags');
    return meta;
  }

  Logger.log('COS backend: all strategies failed');
  return null;
}

function normaliseCosFromJsonLd(jsonLd, parsed, html) {
  var langMarket = parsed.languageMarket || 'en-gb';
  var curInfo = COS_CURRENCY_MAP[langMarket] || { code: 'EUR', symbol: '€' };

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
    sizes: sizes, region: parsed.languageMarket, mainImage: mainImage, store: 'cos'
  };
}

function extractCosFromMetaTags(html, parsed) {
  var langMarket = parsed.languageMarket || 'en-gb';
  var curInfo = COS_CURRENCY_MAP[langMarket] || { code: 'EUR', symbol: '€' };

  var name = extractMeta(html, 'og:title');
  if (name) name = name.replace(/\s*[-|]\s*COS$/i, '').trim();
  else name = 'Unknown';

  var mainImage = extractMeta(html, 'og:image') || '';
  var priceStr = extractMeta(html, 'product:price:amount');
  var currentPrice = priceStr ? (parseFloat(priceStr) || 0) : 0;
  var currency = extractMeta(html, 'product:price:currency') || curInfo.code;
  curInfo = getCurrencyInfo(currency, curInfo);

  if (name === 'Unknown' || currentPrice === 0) return null;

  var sizeNames = extractSizesFromHtml(html);
  var sizes = [], colorSizes = [];
  for (var s = 0; s < sizeNames.length; s++) {
    sizes.push({ code: sizeNames[s], name: sizeNames[s] });
    colorSizes.push({
      sizeCode: sizeNames[s], sizeName: sizeNames[s],
      currentPrice: currentPrice, basePrice: currentPrice,
      onSale: false, inStock: true, currency: currency, currencySymbol: curInfo.symbol
    });
  }

  return {
    productCode: parsed.productCode, name: name, image: mainImage,
    category: detectCategory(name),
    currentPrice: currentPrice, originalPrice: currentPrice, onSale: false,
    currency: currency, currencySymbol: curInfo.symbol,
    colors: [{ code: parsed.productCode, name: '', hex: '', image: mainImage, sizes: colorSizes, available: true }],
    sizes: sizes, region: parsed.languageMarket, mainImage: mainImage, store: 'cos'
  };
}

/* ============================
   ACCEPT FRONTEND-PARSED DATA
   ============================ */

function apiPreviewCosFromClientData(clientProduct, url) {
  var parsed = parseCosUrl(url);
  if (!parsed) return { error: 'Invalid COS URL' };
  if (!clientProduct || !clientProduct.name) return { error: 'Invalid product data' };

  clientProduct.productCode = parsed.productCode;
  clientProduct.region = parsed.languageMarket;
  clientProduct.store = 'cos';

  return {
    ok: true,
    product: clientProduct,
    parsed: parsed,
    store: 'cos'
  };
}

/* ============================
   PRICE CHECKER — proxy + public stock API fallback
   ============================ */

function fetchCosCurrentPrice(productUrl) {
  if (!productUrl) return null;
  if (productUrl.indexOf('http') !== 0) productUrl = 'https://www.cos.com' + productUrl;

  var parsed = parseCosUrl(productUrl);
  if (!parsed) return null;

  // Try proxy fetch for full data (prices + stock)
  var html = arketProxyFetch(productUrl);
  if (html) {
    var nextData = extractNextData(html);
    if (nextData) {
      var found = findProductInPageProps(nextData);
      if (found) {
        var result = extractCosPrice(found.product);
        // Enhance with live stock from public API
        var stock = fetchCosStock(parsed.slug, parsed.market);
        if (stock) mergeStockData(result, stock);
        return result;
      }
    }

    var jsonLd = extractJsonLd(html);
    if (jsonLd) return extractPriceFromJsonLd(jsonLd);

    var meta = extractCosFromMetaTags(html, parsed);
    if (meta) return { currentPrice: meta.currentPrice, originalPrice: meta.originalPrice, onSale: meta.onSale, colors: meta.colors };
  }

  // Proxy failed — at least try stock API (public, no proxy needed)
  Logger.log('COS: proxy failed, trying stock API only');
  var stock = fetchCosStock(parsed.slug, parsed.market);
  if (stock) {
    Logger.log('COS: got stock data but no prices');
    // Return null since we can't get prices — don't update with wrong data
  }

  return null;
}

function extractCosPrice(prod) {
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
        sizeCode: items[s].name,
        inStock: items[s].stock !== 'no',
        currentPrice: vr.priceAsNumber || 0,
        basePrice: vr.priceBeforeDiscountAsNumber || vr.priceAsNumber || 0
      });
    }
    colors.push({ code: vr.sku || '', sizes: sizes });
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

/* ============================
   PUBLIC STOCK API (no proxy needed!)
   ============================ */

function fetchCosStock(slug, market) {
  if (!slug || !market) return null;
  var url = 'https://www.cos.com/api/products/' + slug + '/stock?market=' + market;

  try {
    var r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (r.getResponseCode() !== 200) return null;
    var data = JSON.parse(r.getContentText());
    if (!data.data) return null;
    return data.data;
  } catch (e) {
    Logger.log('COS stock API error: ' + e);
    return null;
  }
}

function mergeStockData(priceResult, stockData) {
  if (!priceResult || !priceResult.colors || !stockData) return;

  // Build stock lookup from API: sku → stock status
  var stockLookup = {};
  var keys = Object.keys(stockData);
  for (var i = 0; i < keys.length; i++) {
    var entry = stockData[keys[i]];
    if (entry && entry.product && entry.product.items) {
      var items = entry.product.items;
      for (var j = 0; j < items.length; j++) {
        stockLookup[items[j].name] = items[j].stock === 'yes';
      }
    }
    break; // All entries have same items, just need first
  }

  // Merge into price result
  for (var c = 0; c < priceResult.colors.length; c++) {
    var col = priceResult.colors[c];
    for (var s = 0; s < col.sizes.length; s++) {
      var sizeCode = col.sizes[s].sizeCode;
      if (stockLookup[sizeCode] !== undefined) {
        col.sizes[s].inStock = stockLookup[sizeCode];
      }
    }
  }
}

/* ============================
   UTILITIES
   ============================ */

function getCosImageForColor(product, colorCode) {
  if (!product || !product.colors || !colorCode) return product ? product.mainImage : '';
  for (var i = 0; i < product.colors.length; i++) {
    if (product.colors[i].code === colorCode && product.colors[i].image) return product.colors[i].image;
  }
  return product.mainImage || '';
}

function getCosSkuInfo(priceResult, colorCode, sizeCode) {
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