/* Uniqlo sale page monitor — finds new sale items matching user prefs */

const { UNIQLO_LANGS, UNIQLO_CLIENTS, SIZE_NAMES } = require('./uniqlo');

const SALE_CATEGORY_PATTERNS = {
  tops: /t-shirt|tee|polo|shirt|blouse|sweater|sweatshirt|hoodie|cardigan|knit|vest|tank|top|fleece|henley|jersey|jumper|airism.*crew|heattech.*crew|parka.*sweat|hemd|pullover|oberteil|strick|camiseta|camisa|sudadera|punto|maglia|maglione|felpa/i,
  bottoms: /pant|trouser|chino|jogger|short(?!s?\s*sleeve)|skirt|legging|cargo|sweatpant|hose|rock|pantalon|falda|pantaloni|gonna/i,
  jeans: /jean|denim/i,
  outerwear: /jacket|coat|parka|blazer|gilet|down|windbreaker|anorak|bomber|blouson|overcoat|puffertech|blocktech|jacke|mantel|weste|daunen|chaqueta|abrigo|chaleco|giacca|cappotto|gilet/i,
  accessories: /sock|hat|cap|scarf|stole|glove|belt|bag|underwear|boxer|brief|trunk|heattech.*inner|airism.*inner|shoe|trainer|sandal|deck\s|socke|handschuh|schal|m[uü]tze|tasche|schuh|calcet[ií]n|gorro|bufanda|guante|bolsa|zapato|calzino|cappello|sciarpa|guanto|borsa|scarpa/i
};

const SALE_SIZE_MAP = {
  '001': 'XXS', '002': 'XS', '003': 'S', '004': 'M', '005': 'L',
  '006': 'XL', '007': 'XXL', '008': '3XL', '999': 'One Size',
  '028': '28', '029': '29', '030': '30', '031': '31', '032': '32',
  '033': '33', '034': '34', '036': '36'
};

function categorizeSaleProduct(name) {
  if (!name) return 'other';
  for (const cat of Object.keys(SALE_CATEGORY_PATTERNS)) {
    if (SALE_CATEGORY_PATTERNS[cat].test(name)) return cat;
  }
  return 'other';
}

function cleanColorName(name) {
  if (!name) return '';
  const cleaned = name.replace(/^\d+\s+/, '');
  return cleaned.charAt(0).toUpperCase() + cleaned.substring(1).toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function normaliseSaleApiItems(apiItems, region, lang, gender) {
  const items = [];
  for (const r of apiItems) {
    const pc = r.productId || '';
    if (!pc) continue;
    const name = r.name || '';

    let basePrice = 0;
    let promoPrice = 0;
    let currency = 'EUR';
    let symbol = '€';
    if (r.prices) {
      if (r.prices.base) {
        basePrice = r.prices.base.value || 0;
        if (r.prices.base.currency) {
          currency = r.prices.base.currency.code || currency;
          symbol = r.prices.base.currency.symbol || symbol;
        }
      }
      if (r.prices.promo) promoPrice = r.prices.promo.value || 0;
    }
    if (!promoPrice) promoPrice = basePrice;
    if (!basePrice) basePrice = promoPrice;

    const onSale = promoPrice > 0 && promoPrice < basePrice;
    if (!onSale) continue;
    const discount = basePrice > 0 ? Math.round((1 - promoPrice / basePrice) * 100) : 0;

    let image = '';
    const repColor = r.representativeColorDisplayCode || '';
    if (r.images && r.images.main) {
      if (repColor && r.images.main[repColor]) {
        image = r.images.main[repColor].image || '';
      } else {
        const imgKeys = Object.keys(r.images.main);
        if (imgKeys.length > 0 && r.images.main[imgKeys[0]]) {
          image = r.images.main[imgKeys[0]].image || '';
        }
      }
    }

    const sizes = (r.sizes || []).map((sz) => ({
      code: sz.displayCode || '',
      name: sz.name || SALE_SIZE_MAP[sz.displayCode] || sz.displayCode || '',
      inStock: true
    }));

    const colors = (r.colors || []).map((c) => ({
      code: c.displayCode || '',
      name: c.name || ''
    }));

    items.push({
      productCode: pc,
      name,
      basePrice,
      salePrice: promoPrice,
      discount,
      currency,
      currencySymbol: symbol,
      image,
      sizes,
      colors,
      category: categorizeSaleProduct(name),
      gender,
      genderCategory: (r.genderCategory || '').toUpperCase(),
      region,
      url: `https://www.uniqlo.com/${region}/${lang || 'en'}/products/${pc}/00`
    });
  }
  return items;
}

async function fetchSalePageProducts(region, gender) {
  const lang = UNIQLO_LANGS[region] || 'en';
  let allItems = [];
  let offset = 0;
  const limit = 100;
  let total = 999;

  console.log(`Sale: fetching ${region}/${gender} via API`);

  while (offset < total) {
    const apiUrl = `https://www.uniqlo.com/${region}/api/commerce/v5/${lang}/products?flagCodes=discount&offset=${offset}&limit=${limit}&imageRatio=3x4&httpFailure=true`;
    const data = await fetchJson(apiUrl, region);
    if (!data || data.status !== 'ok' || !data.result) break;

    total = (data.result.pagination && data.result.pagination.total) || 0;
    const items = data.result.items || [];
    if (items.length === 0) break;
    allItems = allItems.concat(items);
    offset += items.length;
    console.log(`Sale API: fetched ${allItems.length}/${total}`);
    if (offset < total) await sleep(500);
  }

  if (allItems.length === 0) return [];

  const genderUpper = gender === 'men' ? 'MEN' : 'WOMEN';
  const filtered = allItems.filter((i) => {
    const gc = (i.genderCategory || '').toUpperCase();
    return gc === genderUpper || gc === 'UNISEX';
  });

  console.log(`Sale: ${filtered.length} items for ${gender} (from ${allItems.length} total)`);
  return normaliseSaleApiItems(filtered, region, lang, gender);
}

/* Fetch per-color per-size stock + identify which colors are actually on sale.
   Checks both price groups 00 and 01 because sale colors often live in 01. */
async function enrichWithStock(items, region) {
  if (!items || items.length === 0) return items;
  const lang = UNIQLO_LANGS[region] || 'en';

  for (const item of items) {
    const sizeStock = {};
    const colorStock = {};
    const colorNames = {};
    const colorOnSale = {};

    // Names from listing API first
    if (item.colors) {
      for (const c of item.colors) {
        if (c.code && c.name) colorNames[c.code] = cleanColorName(c.name);
      }
    }

    for (const pg of ['00', '01']) {
      const apiUrl = `https://www.uniqlo.com/${region}/api/commerce/v5/${lang}/products/${item.productCode}/price-groups/${pg}/l2s?withPrices=true&withStocks=true&httpFailure=true`;
      const data = await fetchJson(apiUrl, region);
      if (!data || data.status !== 'ok' || !data.result) continue;

      const stocks = data.result.stocks || {};
      const prices = data.result.prices || {};
      const l2s = data.result.l2s || [];

      for (const l2 of l2s) {
        const sc = l2.size ? l2.size.displayCode : '';
        const cc = l2.color ? l2.color.displayCode : '';
        const st = stocks[l2.l2Id];
        const pr = prices[l2.l2Id];
        const inStock = st ? st.statusCode !== 'STOCK_OUT' : false;

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
          const base = (pr.base && pr.base.value) || 0;
          const promo = (pr.promo && pr.promo.value) || 0;
          if (promo > 0 && promo < base) colorOnSale[cc] = true;
        }
      }
    }

    for (const s of item.sizes) {
      if (sizeStock[s.code] !== undefined) s.inStock = sizeStock[s.code];
    }
    item.colorStock = colorStock;
    item.colorNames = colorNames;
    item.colorOnSale = colorOnSale;
    await sleep(150);
  }
  return items;
}

function buildSizeFilters(prefs) {
  const sizes = [];
  const seen = {};
  for (const f of ['size_tops', 'size_bottoms', 'size_jeans']) {
    const val = prefs[f];
    if (!val) continue;
    const arr = Array.isArray(val) ? val : [val];
    for (const v of arr) {
      if (v && !seen[v]) {
        seen[v] = true;
        sizes.push(v);
      }
    }
  }
  return sizes;
}

function saleItemMatchesFilter(item, filter) {
  if (filter.gender && filter.gender !== 'both') {
    if (item.gender !== filter.gender) return false;
  }

  const hasOnlyOneSize =
    !item.sizes ||
    item.sizes.length === 0 ||
    (item.sizes.length === 1 && (item.sizes[0].name === 'One Size' || item.sizes[0].code === '999'));
  const skipSizeFilter = (item.category === 'accessories' && hasOnlyOneSize) || hasOnlyOneSize;

  if (!skipSizeFilter && filter.sizes && filter.sizes.length > 0 && item.sizes && item.sizes.length > 0) {
    let matched = false;
    for (const sz of item.sizes) {
      if (sz.name === 'One Size' || sz.code === '999') {
        matched = true;
        break;
      }
      if (!sz.inStock) continue;
      for (const fs of filter.sizes) {
        if (sz.code === fs || sz.name === fs || SALE_SIZE_MAP[sz.code] === fs || SIZE_NAMES[sz.code] === fs) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) return false;
  }
  return true;
}

module.exports = {
  SALE_SIZE_MAP,
  categorizeSaleProduct,
  cleanColorName,
  fetchSalePageProducts,
  enrichWithStock,
  buildSizeFilters,
  saleItemMatchesFilter
};
