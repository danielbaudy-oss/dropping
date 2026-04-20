/* Edge Function: fetch-uniqlo
   Fetches Uniqlo product data (prices + stocks) from the server side,
   bypassing CORS blocks in the browser.

   Body: { productCode, region, priceGroup? }
   Returns: normalised product object with colors, sizes, prices */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const LANGS: Record<string, string> = {
  es: 'en', eu: 'en', uk: 'en', us: 'en', de: 'de', fr: 'fr',
  jp: 'ja', it: 'it', nl: 'en', be: 'en', pt: 'en', se: 'en', dk: 'en', pl: 'en'
};

const CLIENTS: Record<string, string> = {
  es: 'uq.es.web-spa', eu: 'uq.eu.web-spa', de: 'uq.de.web-spa',
  fr: 'uq.fr.web-spa', uk: 'uq.gb.web-spa', us: 'uq.us.web-spa',
  jp: 'uq.jp.web-spa', it: 'uq.it.web-spa'
};

const SIZE_NAMES: Record<string, string> = {
  '001': 'XXS', '002': 'XS', '003': 'S', '004': 'M', '005': 'L',
  '006': 'XL', '007': 'XXL', '008': '3XL', '009': '4XL',
  '024': '24', '025': '25', '026': '26', '027': '27', '028': '28',
  '029': '29', '030': '30', '031': '31', '032': '32', '033': '33',
  '034': '34', '036': '36', '038': '38', '040': '40', '042': '42', '044': '44'
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

async function fetchJson(url: string, region: string): Promise<any> {
  const clientId = CLIENTS[region] || `uq.${region}.web-spa`;
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
  } catch {
    return null;
  }
}

function parsePricesResponse(data: any): any {
  const l2s = data.result.l2s || [];
  const prices = data.result.prices || {};
  const stocks = data.result.stocks || {};

  const colorMap: Record<string, any> = {};
  const sizeMap: Record<string, any> = {};

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
  const sizes = Object.values(sizeMap).sort((a: any, b: any) => a.code.localeCompare(b.code));

  const all: number[] = [];
  let hi = 0;
  for (const id of Object.keys(prices)) {
    const p = prices[id];
    const c = (p.promo && p.promo.value) ? p.promo.value : (p.base ? p.base.value : 0);
    if (c > 0) all.push(c);
    if (p.base && p.base.value > hi) hi = p.base.value;
  }
  const lo = all.length > 0 ? Math.min(...all) : 0;

  return { colors, sizes, currentPrice: lo, originalPrice: hi, onSale: lo < hi };
}

async function parseDetails(productCode: string, region: string): Promise<any> {
  const lang = LANGS[region] || 'en';
  const url = `https://www.uniqlo.com/${region}/${lang}/products/${productCode}/00`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
    if (!res.ok) return null;
    const html = await res.text();

    let name = 'Unknown';
    const t = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
    if (t) name = t[1].replace(/\s*\|\s*UNIQLO\s*\w*$/i, '').trim();

    let image = '';
    const im = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"[^>]*>/i);
    if (im) image = im[1];

    const cn = productCode.replace('E', '').replace('-000', '');
    const colorImages: Record<string, string> = {};
    const re = new RegExp(`eugoods_(\\w{2})_${cn}_3x4\\.jpg`, 'g');
    let mm;
    while ((mm = re.exec(html)) !== null) {
      if (!colorImages[mm[1]]) {
        colorImages[mm[1]] = `https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/${cn}/item/eugoods_${mm[1]}_${cn}_3x4.jpg`;
      }
    }

    const colorNames: Record<string, string> = {};
    const cnRegex = /goods_(\w{2})_\d+_chip\.jpg[^>]*?alt="([^"]+)"/gi;
    let cnm;
    while ((cnm = cnRegex.exec(html)) !== null) colorNames[cnm[1]] = cnm[2];

    return { name, image, colorImages, colorNames };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({}, 200);

  let body: { productCode?: string; region?: string; priceGroup?: string };
  try {
    body = req.method === 'POST' ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const productCode = String(body.productCode || '').trim();
  const region = String(body.region || 'es').trim();
  const priceGroup = String(body.priceGroup || '00').trim();

  if (!productCode) return json({ error: 'productCode required' }, 400);

  const lang = LANGS[region] || 'en';
  const apiUrl = `https://www.uniqlo.com/${region}/api/commerce/v5/${lang}/products/${productCode}/price-groups/${priceGroup}/l2s?withPrices=true&withStocks=true&includePreviousPrice=false&httpFailure=true`;

  const [data, details] = await Promise.all([
    fetchJson(apiUrl, region),
    parseDetails(productCode, region)
  ]);

  if (!data || data.status !== 'ok' || !data.result) {
    return json({ error: 'Product not found' }, 404);
  }

  const pd = parsePricesResponse(data);

  // Attach images + names from the details page
  const ci = (details && details.colorImages) || {};
  const cn = productCode.replace('E', '').replace('-000', '');
  const cnames = (details && details.colorNames) || {};

  for (const c of pd.colors) {
    c.image = ci[c.code] || `https://image.uniqlo.com/UQ/ST3/eu/imagesgoods/${cn}/item/eugoods_${c.code}_${cn}_3x4.jpg`;
    c.name = cnames[c.code] || c.name || '';
  }

  const cur = pd.colors[0]?.sizes[0]?.currency || 'EUR';
  const sym = pd.colors[0]?.sizes[0]?.currencySymbol || '€';

  return json({
    productCode,
    name: details ? details.name : 'Unknown',
    image: details ? details.image : (pd.colors[0]?.image || ''),
    mainImage: details ? details.image : (pd.colors[0]?.image || ''),
    category: 'tops',
    currentPrice: pd.currentPrice,
    originalPrice: pd.originalPrice,
    onSale: pd.onSale,
    currency: cur,
    currencySymbol: sym,
    colors: pd.colors,
    sizes: pd.sizes,
    region,
    store: 'uniqlo'
  });
});
