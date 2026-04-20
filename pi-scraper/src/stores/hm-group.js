/* ARKET + COS — both on the H&M Group Next.js platform.
   With residential IP we just fetch directly. */

const { getCurrencyInfo } = require('../currency');

const ARKET_CURRENCY_MAP = {
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

const COS_CURRENCY_MAP = {
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

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': pickUA(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.length < 1000 || text.includes('Access Denied')) return null;
  return text;
}

/* ============================
   URL PARSING
   ============================ */

function parseArketUrl(url) {
  const m = url.match(/arket\.com\/([a-z]{2}-[a-z]{2})\/product\/([^\/?#]+)/i);
  if (!m) return null;
  const languageMarket = m[1].toLowerCase();
  const slug = m[2].replace(/\/$/, '').replace(/\.html$/, '');
  const skuMatch = slug.match(/(\d{10})$/);
  if (!skuMatch) return null;
  return {
    productCode: skuMatch[1],
    slug,
    languageMarket,
    region: languageMarket,
    colorCode: skuMatch[1],
    store: 'arket'
  };
}

function parseCosUrl(url) {
  const m = url.match(/cos\.com\/([a-z]{2}-[a-z]{2})\/.*?product\/([^\/?#]+)/i);
  if (!m) return null;
  const languageMarket = m[1].toLowerCase();
  const slug = m[2].replace(/\/$/, '').replace(/\.html$/, '');
  const skuMatch = slug.match(/(\d{10})$/);
  if (!skuMatch) return null;
  return {
    productCode: skuMatch[1],
    slug,
    languageMarket,
    region: languageMarket,
    colorCode: skuMatch[1],
    market: languageMarket.split('-')[1],
    store: 'cos'
  };
}

/* ============================
   HTML PARSERS
   ============================ */

function extractNextData(html) {
  try {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    return data.props ? (data.props.pageProps || null) : (data.pageProps || null);
  } catch (e) {
    return null;
  }
}

function findProductInPageProps(pageProps) {
  if (!pageProps) return null;
  if (pageProps.blocks) {
    for (const b of pageProps.blocks) {
      if (b.product) return { product: b.product, pageProps };
    }
  }
  if (pageProps.product) return { product: pageProps.product, pageProps };
  if (pageProps.productData) return { product: pageProps.productData, pageProps };

  function findDeep(obj, depth) {
    if (!obj || depth > 5 || typeof obj !== 'object') return null;
    if (obj.sku && obj.name && (obj.items || obj.priceAsNumber !== undefined)) return obj;
    for (const k of Object.keys(obj)) {
      const found = findDeep(obj[k], depth + 1);
      if (found) return found;
    }
    return null;
  }
  const deep = findDeep(pageProps, 0);
  return deep ? { product: deep, pageProps } : null;
}

/* ============================
   PRICE EXTRACTION
   ============================ */

function extractPriceFromRawProduct(prod) {
  const allVariants = [prod, ...(prod.relatedProducts || []).filter((rp) => rp.relation === 'variant')];

  const colors = [];
  for (const vr of allVariants) {
    const sizes = [];
    for (const it of vr.items || []) {
      sizes.push({
        sizeCode: it.name,
        inStock: it.stock !== 'no',
        currentPrice: vr.priceAsNumber || 0,
        basePrice: vr.priceBeforeDiscountAsNumber || vr.priceAsNumber || 0
      });
    }
    colors.push({ code: vr.sku || vr.var_number_key || '', sizes });
  }

  let lo = prod.priceAsNumber || 0;
  let hi = prod.priceBeforeDiscountAsNumber || lo;
  for (const v of allVariants) {
    const p = v.priceAsNumber || 0;
    if (p > 0 && p < lo) lo = p;
    const bp = v.priceBeforeDiscountAsNumber || 0;
    if (bp > hi) hi = bp;
  }
  return { currentPrice: lo, originalPrice: hi, onSale: lo < hi, colors };
}

async function fetchArketCurrentPrice(productUrl) {
  if (!productUrl) return null;
  if (!productUrl.startsWith('http')) productUrl = `https://www.arket.com${productUrl}`;
  const parsed = parseArketUrl(productUrl);
  if (!parsed) return null;
  const html = await fetchHtml(productUrl);
  if (!html) return null;
  const nextData = extractNextData(html);
  if (nextData) {
    const found = findProductInPageProps(nextData);
    if (found) return extractPriceFromRawProduct(found.product);
  }
  return null;
}

async function fetchCosCurrentPrice(productUrl) {
  if (!productUrl) return null;
  if (!productUrl.startsWith('http')) productUrl = `https://www.cos.com${productUrl}`;
  const parsed = parseCosUrl(productUrl);
  if (!parsed) return null;
  const html = await fetchHtml(productUrl);
  if (!html) return null;
  const nextData = extractNextData(html);
  if (nextData) {
    const found = findProductInPageProps(nextData);
    if (found) {
      const result = extractPriceFromRawProduct(found.product);
      // Enhance with public stock API
      const stock = await fetchCosStock(parsed.slug, parsed.market);
      if (stock) mergeStockData(result, stock);
      return result;
    }
  }
  return null;
}

async function fetchCosStock(slug, market) {
  if (!slug || !market) return null;
  const url = `https://www.cos.com/api/products/${slug}/stock?market=${market}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': pickUA(),
        Accept: 'application/json'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data || null;
  } catch (e) {
    return null;
  }
}

function mergeStockData(priceResult, stockData) {
  if (!priceResult || !priceResult.colors || !stockData) return;
  const stockLookup = {};
  for (const key of Object.keys(stockData)) {
    const entry = stockData[key];
    if (entry && entry.product && entry.product.items) {
      for (const item of entry.product.items) {
        stockLookup[item.name] = item.stock === 'yes';
      }
    }
    break;
  }
  for (const col of priceResult.colors) {
    for (const sz of col.sizes) {
      if (stockLookup[sz.sizeCode] !== undefined) {
        sz.inStock = stockLookup[sz.sizeCode];
      }
    }
  }
}

function getArketSkuInfo(priceResult, colorCode, sizeCode) {
  return getSkuInfo(priceResult, colorCode, sizeCode);
}

function getCosSkuInfo(priceResult, colorCode, sizeCode) {
  return getSkuInfo(priceResult, colorCode, sizeCode);
}

function getSkuInfo(priceResult, colorCode, sizeCode) {
  if (!priceResult || !priceResult.colors) return null;
  for (const col of priceResult.colors) {
    if (col.code === String(colorCode)) {
      for (const sz of col.sizes) {
        if (sz.sizeCode === String(sizeCode)) {
          return { price: sz.currentPrice, inStock: sz.inStock };
        }
      }
    }
  }
  return null;
}

module.exports = {
  ARKET_CURRENCY_MAP,
  COS_CURRENCY_MAP,
  parseArketUrl,
  parseCosUrl,
  fetchArketCurrentPrice,
  fetchCosCurrentPrice,
  getArketSkuInfo,
  getCosSkuInfo
};
