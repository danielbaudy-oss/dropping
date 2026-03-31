var UNIQLO_LANGS = {
  'es':'en','eu':'en','uk':'en','us':'en','de':'de','fr':'fr',
  'jp':'ja','it':'it','nl':'en','be':'en','pt':'en','se':'en','dk':'en','pl':'en'
};

var UNIQLO_CLIENTS = {
  'es':'uq.es.web-spa','eu':'uq.eu.web-spa','de':'uq.de.web-spa',
  'fr':'uq.fr.web-spa','uk':'uq.gb.web-spa','us':'uq.us.web-spa',
  'jp':'uq.jp.web-spa','it':'uq.it.web-spa'
};

var SIZE_NAMES = {
  '001':'XXS','002':'XS','003':'S','004':'M','005':'L','006':'XL','007':'XXL','008':'3XL','009':'4XL',
  '024':'24','025':'25','026':'26','027':'27','028':'28','029':'29','030':'30','031':'31',
  '032':'32','033':'33','034':'34','036':'36','038':'38','040':'40','042':'42','044':'44'
};

function parseUniqloUrl(url) {
  try {
    var m = url.match(/products\/(E?\d{6}-\d{3})/i);
    var productCode = m ? m[1] : null;
    if (!productCode) { m = url.match(/(\d{6})/); if (m) productCode = 'E' + m[1] + '-000'; }
    if (!productCode) return null;
    if (!productCode.startsWith('E')) productCode = 'E' + productCode;
    if (!productCode.includes('-')) productCode += '-000';
    var cm = url.match(/colorDisplayCode[=](\w+)/i);
    var rm = url.match(/uniqlo\.com\/(\w{2})\//);
    return {
      productCode: productCode,
      colorCode: cm ? cm[1] : null,
      region: rm ? rm[1].toLowerCase() : 'es',
      priceGroup: '00'
    };
  } catch(e) { return null; }
}

/* ============================
   PARALLEL FETCH — both requests at once
   ============================ */

function fetchUniqloProduct(productCode, region, colorCode, priceGroup) {
  region = region || 'es';
  var lang = UNIQLO_LANGS[region] || 'en';
  var clientId = UNIQLO_CLIENTS[region] || 'uq.' + region + '.web-spa';
  
  var detailsUrl = 'https://www.uniqlo.com/' + region + '/' + lang + '/products/' + productCode + '/00';
  if (colorCode) detailsUrl += '?colorDisplayCode=' + colorCode;
  
  var apiUrl = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang + '/products/' + productCode +
    '/price-groups/' + (priceGroup || '00') + '/l2s?withPrices=true&withStocks=true&includePreviousPrice=false&httpFailure=true';
  
  try {
    var responses = UrlFetchApp.fetchAll([
      {
        url: detailsUrl,
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      },
      {
        url: apiUrl,
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
          'Referer': 'https://www.uniqlo.com/' + region + '/',
          'x-fr-clientid': clientId
        }
      }
    ]);
    
    var details = parseDetailsResponse(responses[0], productCode, region);
    var pd = parsePricesResponse(responses[1]);
    
    if (!details && !pd) return null;
    
    return combineProductData(productCode, region, details, pd);
  } catch(e) {
    Logger.log('fetchUniqloProduct parallel error: ' + e + ', falling back to sequential');
    return fetchUniqloProductSequential(productCode, region, colorCode, priceGroup);
  }
}

/* Sequential fallback if fetchAll fails */
function fetchUniqloProductSequential(productCode, region, colorCode, priceGroup) {
  var details = fetchProductDetails(productCode, region, colorCode);
  var pd = fetchProductPricesAndStock(productCode, region, priceGroup || '00');
  if (!details && !pd) return null;
  return combineProductData(productCode, region, details, pd);
}

function parseDetailsResponse(response, productCode, region) {
  try {
    if (response.getResponseCode() !== 200) return null;
    var html = response.getContentText();
    
    var name = 'Unknown';
    var t = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
    if (t) name = t[1].replace(/\s*\|\s*UNIQLO\s*\w*$/i, '').trim();
    
    var image = '';
    var im = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i);
    if (im) image = im[1];
    
    var cn = productCode.replace('E', '').replace('-000', '');
    var colorImages = {};
    var re = new RegExp('eugoods_(\\w{2})_' + cn + '_3x4\\.jpg', 'g'), mm;
    while ((mm = re.exec(html)) !== null) {
      if (!colorImages[mm[1]]) {
        colorImages[mm[1]] = 'https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/' + cn + '/item/eugoods_' + mm[1] + '_' + cn + '_3x4.jpg';
      }
    }
    
    var colorNames = {};
    var cnRegex = /goods_(\w{2})_\d+_chip\.jpg[^>]*?alt="([^"]+)"/gi;
    var cnm;
    while ((cnm = cnRegex.exec(html)) !== null) { colorNames[cnm[1]] = cnm[2]; }
    var cnRegex2 = /colorDisplayCode=(\w{2})[^>]*>([^<]{2,30})</g;
    while ((cnm = cnRegex2.exec(html)) !== null) { if (!colorNames[cnm[1]]) colorNames[cnm[1]] = cnm[2].trim(); }
    
    var cat = 'tops';
    if (name.toLowerCase().match(/pant|jean|trouser|short|chino|skirt|jogger/)) cat = 'bottoms';
    
    return { name: name, image: image, colorImages: colorImages, colorNames: colorNames, category: cat };
  } catch(e) { return null; }
}

function parsePricesResponse(response) {
  try {
    if (response.getResponseCode() !== 200) return null;
    var data = JSON.parse(response.getContentText());
    if (data.status !== 'ok') return null;
    
    var l2s = data.result.l2s || [], prices = data.result.prices || {}, stocks = data.result.stocks || {};
    var colorMap = {}, sizeMap = {};
    
    for (var i = 0; i < l2s.length; i++) {
      var it = l2s[i], cc = it.color.displayCode, sc = it.size.displayCode, id = it.l2Id;
      if (!colorMap[cc]) colorMap[cc] = { code: cc, name: '', image: '', sizes: [] };
      if (!sizeMap[sc]) sizeMap[sc] = { code: sc, name: SIZE_NAMES[sc] || sc };
      var pi = prices[id] || {}, si = stocks[id] || {};
      var base = (pi.base && pi.base.value) || 0, promo = (pi.promo && pi.promo.value) || null;
      colorMap[cc].sizes.push({
        sizeCode: sc, sizeName: SIZE_NAMES[sc] || sc,
        currentPrice: promo || base, basePrice: base,
        onSale: promo !== null && promo < base,
        inStock: si.statusCode !== 'STOCK_OUT',
        currency: (pi.base && pi.base.currency) ? pi.base.currency.code : 'EUR',
        currencySymbol: (pi.base && pi.base.currency) ? pi.base.currency.symbol : '€'
      });
    }
    
    var colors = Object.keys(colorMap).map(function(k) { return colorMap[k]; });
    var sizes = Object.keys(sizeMap).map(function(k) { return sizeMap[k]; });
    sizes.sort(function(a, b) { return a.code.localeCompare(b.code); });
    
    var all = [], hi = 0;
    Object.keys(prices).forEach(function(id) {
      var p = prices[id];
      var c = (p.promo && p.promo.value) ? p.promo.value : (p.base ? p.base.value : 0);
      if (c > 0) all.push(c);
      if (p.base && p.base.value > hi) hi = p.base.value;
    });
    var lo = all.length > 0 ? Math.min.apply(null, all) : 0;
    
    return { colors: colors, sizes: sizes, currentPrice: lo, originalPrice: hi, onSale: lo < hi };
  } catch(e) { return null; }
}

function combineProductData(productCode, region, details, pd) {
  var cur = 'EUR', sym = '€';
  if (pd && pd.colors.length > 0 && pd.colors[0].sizes.length > 0) {
    cur = pd.colors[0].sizes[0].currency || 'EUR';
    sym = pd.colors[0].sizes[0].currencySymbol || '€';
  }
  
  var ci = (details && details.colorImages) || {};
  var cn = productCode.replace('E', '').replace('-000', '');
  var cnames = (details && details.colorNames) || {};
  
  if (pd) {
    for (var i = 0; i < pd.colors.length; i++) {
      var c = pd.colors[i];
      c.image = ci[c.code] || ('https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/' + cn + '/item/eugoods_' + c.code + '_' + cn + '_3x4.jpg');
      c.name = cnames[c.code] || '';
    }
  }
  
  return {
    productCode: productCode, name: details ? details.name : 'Unknown',
    image: details ? details.image : '', category: details ? details.category : 'tops',
    currentPrice: pd ? pd.currentPrice : 0, originalPrice: pd ? pd.originalPrice : 0,
    onSale: pd ? pd.onSale : false, currency: cur, currencySymbol: sym,
    colors: pd ? pd.colors : [], sizes: pd ? pd.sizes : [],
    region: region, mainImage: details ? details.image : ''
  };
}

/* ============================
   STANDALONE FUNCTIONS (used by price checker)
   ============================ */

function fetchProductDetails(productCode, region, colorCode) {
  var lang = UNIQLO_LANGS[region] || 'en';
  var url = 'https://www.uniqlo.com/' + region + '/' + lang + '/products/' + productCode + '/00';
  if (colorCode) url += '?colorDisplayCode=' + colorCode;
  try {
    var r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    return parseDetailsResponse(r, productCode, region);
  } catch(e) { return null; }
}

function fetchProductPricesAndStock(productCode, region, priceGroup) {
  var lang = UNIQLO_LANGS[region] || 'en';
  var clientId = UNIQLO_CLIENTS[region] || 'uq.' + region + '.web-spa';
  var url = 'https://www.uniqlo.com/' + region + '/api/commerce/v5/' + lang + '/products/' + productCode +
    '/price-groups/' + (priceGroup || '00') + '/l2s?withPrices=true&withStocks=true&includePreviousPrice=false&httpFailure=true';
  try {
    var r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json',
        'Referer': 'https://www.uniqlo.com/' + region + '/',
        'x-fr-clientid': clientId
      }
    });
    return parsePricesResponse(r);
  } catch(e) { return null; }
}

function fetchCurrentPrice(productCode, region, priceGroup) {
  var p = fetchProductPricesAndStock(productCode, region, priceGroup);
  return p ? { currentPrice: p.currentPrice, originalPrice: p.originalPrice, onSale: p.onSale, colors: p.colors } : null;
}

function getImageForColor(product, colorCode) {
  if (!colorCode || !product) return product ? product.mainImage : '';
  if (product.colors) {
    for (var i = 0; i < product.colors.length; i++) {
      if (product.colors[i].code === colorCode && product.colors[i].image) return product.colors[i].image;
    }
  }
  var cn = (product.productCode || '').replace('E', '').replace('-000', '');
  return cn ? 'https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/' + cn + '/item/eugoods_' + colorCode + '_' + cn + '_3x4.jpg' : '';
}

function getColorName(p, c) { return c || ''; }
function getSizeName(s) { return SIZE_NAMES[s] || s || ''; }

function buildProductUrl(pc, region, cc, sc) {
  var u = 'https://www.uniqlo.com/' + (region || 'es') + '/' + (UNIQLO_LANGS[region] || 'en') + '/products/' + pc + '/00';
  var p = [];
  if (cc) p.push('colorDisplayCode=' + cc);
  if (sc) p.push('sizeDisplayCode=' + sc);
  return p.length > 0 ? u + '?' + p.join('&') : u;
}

function getSkuInfo(priceResult, colorCode, sizeCode) {
  if (!priceResult || !priceResult.colors) return null;
  for (var c = 0; c < priceResult.colors.length; c++) {
    var col = priceResult.colors[c];
    if (col.code === String(colorCode)) {
      for (var s = 0; s < col.sizes.length; s++) {
        if (col.sizes[s].sizeCode === String(sizeCode)) {
          return { price: col.sizes[s].currentPrice, inStock: col.sizes[s].inStock };
        }
      }
    }
  }
  return null;
}