/* Headless Chromium wrapper — for sites behind Akamai (e.g. COS) */

const puppeteer = require('puppeteer-core');

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1280,720'
    ]
  });
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise;
  try { await b.close(); } catch (e) {}
  browserPromise = null;
}

/* Fetch a URL with a real browser. Returns HTML after network idle. */
async function fetchWithBrowser(url, options) {
  options = options || {};
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      options.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });
    await page.goto(url, {
      waitUntil: options.waitUntil || 'domcontentloaded',
      timeout: options.timeout || 30000
    });
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {});
    }
    if (options.extraDelay) {
      await new Promise((r) => setTimeout(r, options.extraDelay));
    }
    const html = await page.content();
    return html;
  } finally {
    await page.close();
  }
}

module.exports = { fetchWithBrowser, closeBrowser };
