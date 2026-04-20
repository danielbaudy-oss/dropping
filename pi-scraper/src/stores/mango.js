/* Mango scraper — uses the online-orchestrator API.
   With residential IP, direct requests should work. */

const MANGO_API_BASE = 'https://online-orchestrator.mango.com';

const MANGO_CURRENCY_MAP = {
  ES: { code: 'EUR', symbol: '€' },
  DE: { code: 'EUR', symbol: '€' },
  FR: { code: 'EUR', symbol: '€' },
  IT: { code: 'EUR', symbol: '€' },
  PT: { code: 'EUR', symbol: '€' },
  NL: { code: 'EUR', symbol: '€' },
  BE: { code: 'EUR', symbol: '€' },
  AT: { code: 'EUR', symbol: '€' },
  GB: { code: 'GBP', symbol: '£' },
  US: { code: 'USD', symbol: '$' },
  SE: { code: 'SEK', symbol: 'kr' },
  DK: { code: 'DKK', symbol: 'kr' },
  NO: { code: 'NOK', symbol: 'kr' },
  PL: { code: 'PLN', symbol: 'zł' },
  CH: { code: 'CHF', symbol: 'CHF' }
};

function parseMangoUrl(url) {
  let m = url.match(/shop\.mango\.com\/([a-z]{2})\/([a-z]{2})\/.*?_(\d{8,})(?:\?|$)/i);
  if (!m) m = url.match(/shop\.mango\.com\/([a-z]{2})\/([a-z]{2})\/.*?(\d{8,})/i);
  if (!m) return null;

  const countryIso = m[1].toUpperCase();
  const langIso = m[2];
  const productId = m[3];
  const colorMatch = url.match(/[?&]c=([^&]+)/i);
  const slugMatch = url.match(/\/p\/(.+?)(?:\?|$)/);
  return {
    productCode: productId,
    productId,
    slug: slugMatch ? slugMatch[1] : '',
    countryIso,
    langIso,
    languageMarket: `${langIso}-${countryIso.toLowerCase()}`,
    region: `${langIso}-${countryIso.toLowerCase()}`,
    colorCode: colorMatch ? colorMatch[1] : '',
    store: 'mango'
  };
}

async function fetchMangoApi(apiUrl) {
  try {
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
        Origin: 'https://shop.mango.com',
        Referer: 'https://shop.mango.com/'
      }
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.includes('Access Denied')) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function buildPriceApiUrl(productId, countryIso) {
  return `${MANGO_API_BASE}/v3/prices/products?channelId=shop&countryIso=${countryIso}&productId=${productId}`;
}

function buildStockApiUrl(productId, countryIso) {
  return `${MANGO_API_BASE}/v3/stock/products?countryIso=${countryIso}&channelId=shop&productId=${productId}`;
}

async function fetchMangoCurrentPrice(productUrl) {
  if (!productUrl) return null;
  if (!productUrl.startsWith('http')) productUrl = `https://shop.mango.com${productUrl}`;
  const parsed = parseMangoUrl(productUrl);
  if (!parsed) return null;

  const priceData = await fetchMangoApi(buildPriceApiUrl(parsed.productId, parsed.countryIso));
  if (!priceData) return null;

  const stockData = await fetchMangoApi(buildStockApiUrl(parsed.productId, parsed.countryIso));

  const colors = [];
  const allPrices = [];
  const priceKeys = Object.keys(priceData);

  for (const colorId of priceKeys) {
    const colorPrice = priceData[colorId].price || 0;
    const colorBase = priceData[colorId].crossedOutPrice || colorPrice;
    if (colorPrice > 0) allPrices.push(colorPrice);

    const sizes = [];
    if (stockData && stockData.colors && stockData.colors[colorId]) {
      const stockSizes = stockData.colors[colorId].sizes || {};
      for (const sizeKey of Object.keys(stockSizes)) {
        sizes.push({
          sizeCode: sizeKey,
          currentPrice: colorPrice,
          basePrice: colorBase,
          inStock: stockSizes[sizeKey].available !== false
        });
      }
    }
    colors.push({ code: colorId, sizes });
  }

  const lo = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  let hi = lo;
  for (const k of priceKeys) {
    const bp = priceData[k].crossedOutPrice || priceData[k].price || 0;
    if (bp > hi) hi = bp;
  }

  return { currentPrice: lo, originalPrice: hi, onSale: lo < hi, colors };
}

function getMangoSkuInfo(priceResult, colorCode, sizeCode) {
  if (!priceResult || !priceResult.colors) return null;
  for (const col of priceResult.colors) {
    if (col.code === String(colorCode)) {
      for (const sz of col.sizes) {
        if (sz.sizeCode === String(sizeCode)) {
          return { price: sz.currentPrice, inStock: sz.inStock };
        }
      }
      if (col.sizes.length > 0) {
        return { price: col.sizes[0].currentPrice, inStock: true };
      }
    }
  }
  return null;
}

module.exports = {
  MANGO_CURRENCY_MAP,
  parseMangoUrl,
  fetchMangoCurrentPrice,
  getMangoSkuInfo
};
