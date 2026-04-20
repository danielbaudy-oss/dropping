/* Uniqlo scraper — uses the public commerce API.
   Residential IP means we don't need proxies. */

const UNIQLO_LANGS = {
  es: 'en', eu: 'en', uk: 'en', us: 'en', de: 'de', fr: 'fr',
  jp: 'ja', it: 'it', nl: 'en', be: 'en', pt: 'en', se: 'en', dk: 'en', pl: 'en'
};

const UNIQLO_CLIENTS = {
  es: 'uq.es.web-spa', eu: 'uq.eu.web-spa', de: 'uq.de.web-spa',
  fr: 'uq.fr.web-spa', uk: 'uq.gb.web-spa', us: 'uq.us.web-spa',
  jp: 'uq.jp.web-spa', it: 'uq.it.web-spa'
};

const SIZE_NAMES = {
  '001': 'XXS', '002': 'XS', '003': 'S', '004': 'M', '005': 'L',
  '006': 'XL', '007': 'XXL', '008': '3XL', '009': '4XL',
  '024': '24', '025': '25', '026': '26', '027': '27', '028': '28',
  '029': '29', '030': '30', '031': '31', '032': '32', '033': '33',
  '034': '34', '036': '36', '038': '38', '040': '40', '042': '42', '044': '44'
};

function getSizeName(code) {
  return SIZE_NAMES[code] || code || '';
}

async function fetchJson(url, region) {
  const clientId = UNIQLO_CLIENTS[region] || `uq.${region}.web-spa`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      Referer: `https://www.uniqlo.com/${region}/`,
      'x-fr-clientid': clientId
    }
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchPricesAndStock(productCode, region, priceGroup) {
  const lang = UNIQLO_LANGS[region] || 'en';
  const url = `https://www.uniqlo.com/${region}/api/commerce/v5/${lang}/products/${productCode}/price-groups/${priceGroup || '00'}/l2s?withPrices=true&withStocks=true&includePreviousPrice=false&httpFailure=true`;
  const data = await fetchJson(url, region);
  if (!data || data.status !== 'ok' || !data.result) return null;
  return parsePricesResponse(data);
}

function parsePricesResponse(data) {
  const l2s = data.result.l2s || [];
  const prices = data.result.prices || {};
  const stocks = data.result.stocks || {};

  const colorMap = {};
  const sizeMap = {};

  for (const it of l2s) {
    const cc = it.color.displayCode;
    const sc = it.size.displayCode;
    const id = it.l2Id;
    if (!colorMap[cc]) colorMap[cc] = { code: cc, name: '', image: '', sizes: [] };
    if (!sizeMap[sc]) sizeMap[sc] = { code: sc, name: SIZE_NAMES[sc] || sc };
    const pi = prices[id] || {};
    const si = stocks[id] || {};
    const base = (pi.base && pi.base.value) || 0;
    const promo = (pi.promo && pi.promo.value) || null;
    colorMap[cc].sizes.push({
      sizeCode: sc,
      sizeName: SIZE_NAMES[sc] || sc,
      currentPrice: promo || base,
      basePrice: base,
      onSale: promo !== null && promo < base,
      inStock: si.statusCode !== 'STOCK_OUT',
      currency: (pi.base && pi.base.currency) ? pi.base.currency.code : 'EUR',
      currencySymbol: (pi.base && pi.base.currency) ? pi.base.currency.symbol : '€'
    });
  }

  const colors = Object.values(colorMap);
  const sizes = Object.values(sizeMap).sort((a, b) => a.code.localeCompare(b.code));

  const all = [];
  let hi = 0;
  for (const id of Object.keys(prices)) {
    const p = prices[id];
    const c = (p.promo && p.promo.value) ? p.promo.value : (p.base ? p.base.value : 0);
    if (c > 0) all.push(c);
    if (p.base && p.base.value > hi) hi = p.base.value;
  }
  const lo = all.length > 0 ? Math.min(...all) : 0;

  return {
    colors,
    sizes,
    currentPrice: lo,
    originalPrice: hi,
    onSale: lo < hi
  };
}

async function fetchCurrentPrice(productCode, region, priceGroup) {
  const p = await fetchPricesAndStock(productCode, region, priceGroup);
  return p
    ? {
        currentPrice: p.currentPrice,
        originalPrice: p.originalPrice,
        onSale: p.onSale,
        colors: p.colors
      }
    : null;
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

function buildProductUrl(pc, region, cc, sc) {
  const lang = UNIQLO_LANGS[region] || 'en';
  let u = `https://www.uniqlo.com/${region || 'es'}/${lang}/products/${pc}/00`;
  const params = [];
  if (cc) params.push(`colorDisplayCode=${cc}`);
  if (sc) params.push(`sizeDisplayCode=${sc}`);
  return params.length > 0 ? `${u}?${params.join('&')}` : u;
}

module.exports = {
  UNIQLO_LANGS,
  UNIQLO_CLIENTS,
  SIZE_NAMES,
  fetchCurrentPrice,
  fetchPricesAndStock,
  getSkuInfo,
  getSizeName,
  buildProductUrl
};
